<?php
/**
 * Публичная запись на мероприятия «НЕ СПАТЬ МОСКВА» (страница zapis.html).
 * Без входа: список ближайших открытых мероприятий, одно мероприятие по коду
 * из ссылки и запись по имени и телефону.
 *
 * Защита формы, слои независимы: POST только с наших доменов (Origin/Referer);
 * ловушка-поле company; подписанный токен страницы — не раньше 3 с и не позже
 * 6 ч после выдачи, один раз; лимиты 8 записей с адреса за 10 мин и 300 на всех
 * за час. Ботам на ловушке отвечаем «ок», чтобы не подсказывать.
 */

declare(strict_types=1);

require __DIR__ . '/lib/db.php';

const PUB_ORIGINS = ['nespatmoskva.ru', 'dontsleepmoscow.ru', 'xn--80aafk0alelgtej4k.xn--p1ai', '127.0.0.1', 'localhost'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function pout(array $d, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

function pfail(string $msg, int $code = 400, string $why = ''): never
{
    pout(['ok' => false, 'error' => $msg] + ($why ? ['why' => $why] : []), $code);
}

/** То, что видит посетитель: без внутренних полей. */
function pub_event(array $e): array
{
    $taken = crm_taken((int)$e['id']);
    $cap = (int)$e['capacity'];
    $past = crm_event_past($e);
    $state = $e['status'] === 'cancelled' ? 'cancelled' : ($past ? 'past' : ($e['status'] === 'closed' ? 'closed'
        : ($cap > 0 && $taken >= $cap ? 'full' : 'open')));
    return [
        'code' => $e['code'], 'title' => $e['title'], 'kind' => CRM_KINDS[$e['kind']] ?? '', 'date' => $e['date'],
        'time_start' => $e['time_start'], 'time_end' => $e['time_end'], 'place' => $e['place'],
        'address' => $e['address'], 'map_url' => $e['map_url'], 'description' => $e['description'],
        'capacity' => $cap, 'left' => $cap > 0 ? max(0, $cap - $taken) : null, 'state' => $state,
    ];
}

function pub_origin_ok(): bool
{
    foreach (['HTTP_ORIGIN', 'HTTP_REFERER'] as $h) {
        $host = parse_url((string)($_SERVER[$h] ?? ''), PHP_URL_HOST);
        if ($host) {
            return in_array(strtolower($host), PUB_ORIGINS, true);
        }
    }
    return false;
}

function pub_token(): string
{
    $ts = (string)time();
    $nonce = bin2hex(random_bytes(8));
    return $ts . '.' . $nonce . '.' . substr(hash_hmac('sha256', $ts . '.' . $nonce, crm_secret()), 0, 32);
}

/** null — токен годится (и уже погашен); иначе код причины. */
function pub_token_check(string $t): ?string
{
    if (!preg_match('/^(\d{10})\.([0-9a-f]{16})\.([0-9a-f]{32})$/', $t, $m)) {
        return 'token';
    }
    if (!hash_equals(substr(hash_hmac('sha256', $m[1] . '.' . $m[2], crm_secret()), 0, 32), $m[3])) {
        return 'token';
    }
    $age = time() - (int)$m[1];
    if ($age < 3) {
        return 'too_fast';
    }
    if ($age > 6 * 3600) {
        return 'token_old';
    }
    $db = crm_db();
    $db->prepare('DELETE FROM used_tokens WHERE ts < ?')->execute([time() - 7 * 3600]);
    $st = $db->prepare('INSERT OR IGNORE INTO used_tokens(nonce, ts) VALUES(?, ?)');
    $st->execute([$m[2], time()]);
    return $st->rowCount() ? null : 'token_used';
}

$a = (string)($_GET['a'] ?? '');
try {
    $db = crm_db();

    if ($a === 'events') {
        $list = [];
        foreach ($db->query("SELECT * FROM events WHERE status = 'open' AND date >= date('now', '-1 day') ORDER BY date, time_start") as $e) {
            if (!crm_event_past($e)) {
                $list[] = pub_event($e);
            }
        }
        pout(['ok' => true, 'events' => array_slice($list, 0, 30)]);
    }
    if ($a === 'event') {
        $st = $db->prepare('SELECT * FROM events WHERE code = ?');
        $st->execute([substr((string)($_GET['e'] ?? ''), 0, 16)]);
        $e = $st->fetch();
        $e ? pout(['ok' => true, 'event' => pub_event($e)]) : pfail('Мероприятие не найдено', 404);
    }
    if ($a === 'token') {
        pout(['ok' => true, 'token' => pub_token()]);
    }
    if ($a === 'register' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        if (!pub_origin_ok()) {
            pfail('forbidden', 403);
        }
        $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
        if (trim((string)($in['company'] ?? '')) !== '') {
            pout(['ok' => true]); // ловушка для ботов
        }
        $why = pub_token_check((string)($in['token'] ?? ''));
        if ($why !== null) {
            pfail('Обновите страницу и попробуйте ещё раз', 400, $why);
        }
        $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
        $now = time();
        $db->prepare('DELETE FROM pub_hits WHERE ts < ?')->execute([$now - 3600]);
        $st = $db->prepare('SELECT COUNT(*) FROM pub_hits WHERE ip = ? AND ts > ?');
        $st->execute([$ip, $now - 600]);
        $mine = (int)$st->fetchColumn();
        $all = (int)$db->query('SELECT COUNT(*) FROM pub_hits')->fetchColumn();
        if ($mine >= 8 || $all >= 300) {
            pfail('Слишком много записей подряд. Попробуйте через несколько минут.', 429);
        }
        $db->prepare('INSERT INTO pub_hits(ip, ts) VALUES(?, ?)')->execute([$ip, $now]);

        $name = mb_substr(preg_replace('/\s+/u', ' ', trim((string)($in['name'] ?? ''))) ?? '', 0, 80);
        $phone = crm_phone((string)($in['phone'] ?? ''));
        if (!preg_match('/\p{L}/u', $name) || preg_match('~https?://|www\.~i', $name)) {
            pfail('Напишите, как вас зовут');
        }
        if (!$phone || preg_match('/^7(\d)\1{9}$/', $phone)) {
            pfail('Проверьте номер телефона');
        }
        if (empty($in['consent'])) {
            pfail('Нужно согласие на обработку данных');
        }
        $st = $db->prepare('SELECT * FROM events WHERE code = ?');
        $st->execute([substr((string)($in['e'] ?? ''), 0, 16)]);
        $e = $st->fetch();
        if (!$e) {
            pfail('Мероприятие не найдено', 404);
        }
        $pe = pub_event($e);
        $db->beginTransaction();
        $pid = crm_person($phone, $name, 'site');
        $st = $db->prepare('SELECT * FROM regs WHERE event_id = ? AND person_id = ?');
        $st->execute([$e['id'], $pid]);
        $r = $st->fetch();
        if ($r && $r['status'] === 'reg') {
            $db->commit();
            pout(['ok' => true, 'already' => true, 'event' => $pe]);
        }
        if ($pe['state'] !== 'open') {
            $db->rollBack();
            pfail(['past' => 'Это мероприятие уже прошло', 'closed' => 'Запись на это мероприятие закрыта',
                'full' => 'Мест больше нет', 'cancelled' => 'Мероприятие отменено'][$pe['state']], 409, $pe['state']);
        }
        if ($r) {
            $db->prepare("UPDATE regs SET status = 'reg', source = 'site', created_at = ? WHERE id = ?")->execute([$now, $r['id']]);
        } else {
            $db->prepare("INSERT INTO regs(event_id, person_id, status, source, created_at) VALUES(?, ?, 'reg', 'site', ?)")
                ->execute([$e['id'], $pid, $now]);
        }
        crm_log(null, 'reg_site', (int)$e['id'], $pid, $name);
        $db->commit();
        pout(['ok' => true, 'event' => pub_event($e)]);
    }
    pfail('unknown_action', 404);
} catch (Throwable $ex) {
    error_log('CRM pub: ' . $ex->getMessage());
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    pfail('Ошибка сервера, попробуйте ещё раз', 500);
}
