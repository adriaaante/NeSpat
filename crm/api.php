<?php
/**
 * API CRM «НЕ СПАТЬ МОСКВА»: один адрес, действие в ?a=…, ответ — JSON.
 * Изменения — только POST с заголовком X-Requested-With: crm (вместе с
 * SameSite=Strict это защита от подделки запросов с чужих сайтов).
 * Каждое действие пишется в журнал (log) с автором и временем.
 * Публичная запись на мероприятия — отдельный pub.php, без входа.
 */

declare(strict_types=1);

require __DIR__ . '/lib/auth.php';

/** sha256 одноразового ключа первичной настройки (сам ключ в репозиторий не попадает). */
const CRM_BOOTSTRAP_HASH = '526d8a66b577045f972d6f8fcc74b4157332439792413ebab6ded535ed350a4c';
/** Адрес просмотра сертификатов — ссылка из CRM ведёт на боевой сайт. */
const CRM_CERT_VIEW = 'https://nespatmoskva.ru/certificate.html';
const CRM_SITE = 'https://nespatmoskva.ru';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function out(array $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $msg, int $code = 400): never
{
    out(['ok' => false, 'error' => $msg], $code);
}

$a = (string)($_GET['a'] ?? '');
$isPost = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
$in = [];
if ($isPost) {
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'crm') {
        fail('forbidden', 403);
    }
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
}
$str = static fn(string $k, int $max = 2000): string => mb_substr(trim((string)($in[$k] ?? '')), 0, $max);
$int = static fn(string $k): int => (int)($in[$k] ?? 0);

try {
    $db = crm_db();

    // --- без входа ---------------------------------------------------------
    if ($a === 'ping') {
        $n = (int)$db->query('SELECT COUNT(*) FROM users WHERE active = 1')->fetchColumn();
        out(['ok' => true, 'users' => $n > 0, 'store' => str_starts_with(crm_data_dir(), __DIR__) ? 'fallback' : 'outside']);
    }
    if ($a === 'bootstrap' && $isPost) {
        // первый Инженер — только пока пользователей нет, по одноразовому ключу
        if (!hash_equals(CRM_BOOTSTRAP_HASH, hash('sha256', $str('key', 200)))) {
            fail('forbidden', 403);
        }
        if ((int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
            fail('already_set_up', 409);
        }
        $pin = crm_new_pin();
        $db->prepare("INSERT INTO users(name, role, pin_hash, created_at) VALUES(?, 'dev', ?, ?)")
            ->execute([$str('name', 60) ?: 'Инженер', crm_pin_hash($pin), time()]);
        out(['ok' => true, 'pin' => $pin]);
    }
    if ($a === 'login' && $isPost) {
        try {
            $u = crm_login($str('pin', 6));
        } catch (RuntimeException $e) {
            fail($e->getMessage(), 401);
        }
        out(['ok' => true, 'user' => public_user($u)]);
    }

    // --- дальше только с входом --------------------------------------------
    $me = crm_current_user();
    if (!$me) {
        fail('auth', 401);
    }
    $meId = (int)$me['id'];
    // временный PIN: пока не сменён, доступны только смена PIN, профиль и выход
    if ((int)$me['must_change'] === 1 && !in_array($a, ['me', 'my_pin', 'logout'], true)) {
        fail('must_change', 403);
    }
    $need = static function (string $what) use ($me): void {
        if (!crm_can($me, $what)) {
            fail('Нет доступа для вашей роли', 403);
        }
    };

    switch ($a) {
        case 'logout':
            crm_logout();
            out(['ok' => true]);

        case 'me':
            $can = [];
            foreach (['events', 'regs', 'people', 'certs', 'team', 'stats', 'event_delete', 'export'] as $w) {
                $can[$w] = crm_can($me, $w);
            }
            $ranks = [];
            foreach (CRM_RANKS as $id => [$name, $need_]) {
                $ranks[$id] = ['name' => $name, 'visits' => $need_];
            }
            out(['ok' => true, 'user' => public_user($me), 'can' => $can, 'dict' => [
                'roles' => CRM_ROLES, 'kinds' => CRM_KINDS, 'ranks' => $ranks,
                'site' => CRM_SITE, 'cert_view' => CRM_CERT_VIEW,
            ]]);

        case 'my_pin':
            $new = $str('pin', 6);
            if (crm_pin_weak($new)) {
                fail('PIN — 6 цифр, не одинаковые и не подряд');
            }
            if (crm_pin_taken($new, $meId)) {
                fail('Такой PIN уже занят, выберите другой');
            }
            $db->prepare('UPDATE users SET pin_hash = ?, must_change = 0 WHERE id = ?')->execute([crm_pin_hash($new), $meId]);
            crm_log($meId, 'my_pin');
            out(['ok' => true]);

        case 'tour_done':
            $db->prepare('UPDATE users SET tour_done = 1 WHERE id = ?')->execute([$meId]);
            out(['ok' => true]);

        // ---- мероприятия ----
        case 'events':
            $need('events');
            out(['ok' => true, 'events' => events_list($db, (string)($_GET['scope'] ?? 'upcoming'))]);

        case 'event':
            $need('events');
            out(['ok' => true] + event_full($db, (int)($_GET['id'] ?? 0)));

        case 'event_save':
            $need('event_edit');
            $id = $int('id');
            $f = [
                'title' => $str('title', 120), 'kind' => $str('kind', 20), 'date' => $str('date', 10),
                'time_start' => $str('time_start', 5), 'time_end' => $str('time_end', 5),
                'place' => $str('place', 120), 'address' => $str('address', 200), 'map_url' => $str('map_url', 500),
                'capacity' => max(0, min(10000, $int('capacity'))), 'description' => $str('description', 2000),
            ];
            if ($f['title'] === '' || $f['place'] === '') {
                fail('Укажите название и место');
            }
            if (!isset(CRM_KINDS[$f['kind']])) {
                fail('Выберите вид мероприятия');
            }
            if (!DateTime::createFromFormat('!Y-m-d', $f['date'])) {
                fail('Выберите дату');
            }
            foreach (['time_start', 'time_end'] as $t) {
                if ($f[$t] !== '' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $f[$t])) {
                    fail('Время — в виде ЧЧ:ММ');
                }
            }
            if ($f['time_start'] === '') {
                fail('Укажите время начала');
            }
            if ($f['time_end'] !== '' && $f['time_end'] <= $f['time_start']) {
                fail('Время окончания должно быть позже начала');
            }
            if ($f['map_url'] !== '' && !preg_match('~^https?://~i', $f['map_url'])) {
                fail('Ссылка на карту должна начинаться с https://');
            }
            $f['time_end'] = $f['time_end'] ?: null;
            $now = time();
            if ($id) {
                event_row($db, $id);
                $sets = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($f)));
                $db->prepare("UPDATE events SET $sets, updated_at = :now WHERE id = :id")->execute($f + ['now' => $now, 'id' => $id]);
                crm_log($meId, 'event_edit', $id, null, $f['title']);
            } else {
                $f['code'] = new_code($db);
                $cols = implode(', ', array_keys($f));
                $vals = ':' . implode(', :', array_keys($f));
                $db->prepare("INSERT INTO events($cols, created_by, created_at, updated_at) VALUES($vals, :by, :now, :now)")
                    ->execute($f + ['by' => $meId, 'now' => $now]);
                $id = (int)$db->lastInsertId();
                crm_log($meId, 'event_new', $id, null, $f['title']);
            }
            out(['ok' => true, 'id' => $id]);

        case 'event_status':
            $need('event_edit');
            $e = event_row($db, $int('id'));
            $s = $str('status', 10);
            if (!in_array($s, ['open', 'closed', 'cancelled'], true) || $s === $e['status']) {
                fail('Неверный статус');
            }
            $db->prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?')->execute([$s, time(), $e['id']]);
            crm_log($meId, 'event_status', (int)$e['id'], null, '', ['from' => $e['status'], 'to' => $s]);
            out(['ok' => true]);

        case 'event_delete':
            $need('event_delete');
            $e = event_row($db, $int('id'));
            if (crm_taken((int)$e['id']) > 0 || event_came($db, (int)$e['id']) > 0) {
                fail('На мероприятие уже записались — отмените его вместо удаления');
            }
            $db->prepare('DELETE FROM regs WHERE event_id = ?')->execute([$e['id']]);
            $db->prepare('DELETE FROM events WHERE id = ?')->execute([$e['id']]);
            crm_log($meId, 'event_delete', null, null, $e['title'] . ' · ' . $e['date']);
            out(['ok' => true]);

        // ---- записи и отметки ----
        case 'reg_add':
            $need('regs');
            $e = event_row($db, $int('event_id'));
            $phone = crm_phone($str('phone', 40));
            if (!$phone) {
                fail('Телефон не похож на российский номер');
            }
            $name = $str('name', 80);
            $came = !empty($in['came']);
            $db->beginTransaction();
            $pid = crm_person($phone, $name, 'crm');
            $st = $db->prepare('SELECT * FROM regs WHERE event_id = ? AND person_id = ?');
            $st->execute([$e['id'], $pid]);
            $r = $st->fetch();
            $now = time();
            if ($r) {
                $db->prepare("UPDATE regs SET status = 'reg', came = MAX(came, ?), came_at = COALESCE(came_at, ?), came_by = COALESCE(came_by, ?) WHERE id = ?")
                    ->execute([$came ? 1 : 0, $came ? $now : null, $came ? $meId : null, $r['id']]);
            } else {
                $db->prepare("INSERT INTO regs(event_id, person_id, status, came, source, created_at, came_at, came_by) VALUES(?,?,'reg',?,'crm',?,?,?)")
                    ->execute([$e['id'], $pid, $came ? 1 : 0, $now, $came ? $now : null, $came ? $meId : null]);
            }
            crm_log($meId, $came ? 'reg_walkin' : 'reg_add', (int)$e['id'], $pid);
            $db->commit();
            out(['ok' => true, 'existing' => (bool)$r]);

        case 'reg_came':
            $need('regs');
            $r = reg_row($db, $int('id'));
            $came = !empty($in['came']) ? 1 : 0;
            if ($came === (int)$r['came']) {
                out(['ok' => true]);
            }
            $db->prepare("UPDATE regs SET came = ?, came_at = ?, came_by = ?, status = 'reg' WHERE id = ?")
                ->execute([$came, $came ? time() : null, $came ? $meId : null, $r['id']]);
            crm_log($meId, $came ? 'came' : 'came_undo', (int)$r['event_id'], (int)$r['person_id']);
            out(['ok' => true]);

        case 'reg_cancel':
            $need('regs');
            $r = reg_row($db, $int('id'));
            $back = !empty($in['restore']);
            $db->prepare('UPDATE regs SET status = ?, came = CASE WHEN ? THEN came ELSE 0 END WHERE id = ?')
                ->execute([$back ? 'reg' : 'cancel', $back ? 1 : 0, $r['id']]);
            crm_log($meId, $back ? 'reg_restore' : 'reg_cancel', (int)$r['event_id'], (int)$r['person_id']);
            out(['ok' => true]);

        // ---- участники ----
        case 'people':
            $need('people');
            out(['ok' => true, 'people' => people_list($db, trim((string)($_GET['q'] ?? '')), (string)($_GET['f'] ?? 'all'))]);

        case 'person':
            $need('people');
            out(['ok' => true] + person_full($db, (int)($_GET['id'] ?? 0)));

        case 'person_find':
            // подсказка при добавлении на мероприятие: по телефону или имени
            $need('regs');
            $q = trim((string)($_GET['q'] ?? ''));
            if (mb_strlen($q) < 2) {
                out(['ok' => true, 'people' => []]);
            }
            $digits = preg_replace('/\D+/', '', $q);
            $st = $db->prepare('SELECT id, name, phone, rank FROM people WHERE name LIKE ? OR (? <> \'\' AND phone LIKE ?) ORDER BY name LIMIT 8');
            $st->execute(['%' . $q . '%', $digits, '%' . $digits . '%']);
            out(['ok' => true, 'people' => $st->fetchAll()]);

        case 'person_add':
            // участник без мероприятия: например, чтобы сразу выдать сертификат
            $need('people');
            $phone = crm_phone($str('phone', 40));
            $name = $str('name', 80);
            if (!$phone) {
                fail('Телефон не похож на российский номер');
            }
            $st = $db->prepare('SELECT id FROM people WHERE phone = ?');
            $st->execute([$phone]);
            $existed = (bool)$st->fetchColumn();
            if (!$existed && $name === '') {
                fail('Укажите имя нового участника');
            }
            $pid = crm_person($phone, $name, 'crm');
            if (!$existed) {
                crm_log($meId, 'person_add', null, $pid, $name);
            }
            out(['ok' => true, 'existed' => $existed, 'person' => person_full($db, $pid)['person']]);

        case 'certs':
            $need('certs');
            $q = trim((string)($_GET['q'] ?? ''));
            $digits = preg_replace('/\D+/', '', $q);
            $st = $db->prepare("SELECT c.id, c.rank, c.date, c.number, c.url, c.note, c.created_at, p.id AS person_id, p.name, p.phone, u.name AS user_name
                FROM certs c JOIN people p ON p.id = c.person_id LEFT JOIN users u ON u.id = c.issued_by
                WHERE ? = '' OR p.name LIKE ? OR c.number LIKE ? OR (? <> '' AND p.phone LIKE ?)
                ORDER BY c.id DESC LIMIT 1000");
            $st->execute([$q, '%' . $q . '%', '%' . $q . '%', $digits, '%' . $digits . '%']);
            out(['ok' => true, 'certs' => $st->fetchAll()]);

        case 'person_save':
            $need('people');
            $p = person_row($db, $int('id'));
            $name = $str('name', 80);
            $phone = crm_phone($str('phone', 40));
            if ($name === '' || !$phone) {
                fail('Нужны имя и телефон');
            }
            $st = $db->prepare('SELECT id FROM people WHERE phone = ? AND id <> ?');
            $st->execute([$phone, $p['id']]);
            if ($st->fetchColumn()) {
                fail('Этот телефон уже у другого участника');
            }
            $db->prepare('UPDATE people SET name = ?, phone = ?, note = ?, updated_at = ? WHERE id = ?')
                ->execute([$name, $phone, $str('note', 1000), time(), $p['id']]);
            crm_log($meId, 'person_edit', null, (int)$p['id'], $name);
            out(['ok' => true]);

        // ---- сертификаты ----
        case 'cert_save':
            $need('certs');
            $p = person_row($db, $int('person_id'));
            $rank = $int('rank');
            $date = $str('date', 10);
            $number = $str('number', 40);
            $url = $str('url', 2000);
            if (!isset(CRM_RANKS[$rank]) || !DateTime::createFromFormat('!Y-m-d', $date)) {
                fail('Выберите звание и дату');
            }
            if (!preg_match('/^NSM-\d-\d{4}-[0-9A-Z]{6}$/', $number) || !str_starts_with($url, CRM_CERT_VIEW . '#')) {
                fail('Сертификат не собрался — обновите страницу');
            }
            $st = $db->prepare('SELECT id FROM certs WHERE person_id = ? AND number = ?');
            $st->execute([$p['id'], $number]);
            if (!$st->fetchColumn()) {
                $db->prepare('INSERT INTO certs(person_id, rank, date, number, url, note, issued_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
                    ->execute([$p['id'], $rank, $date, $number, $url, $str('note', 300), $meId, time()]);
                crm_log($meId, 'cert', null, (int)$p['id'], CRM_RANKS[$rank][0], ['number' => $number]);
            }
            $db->prepare('UPDATE people SET rank = MAX(rank, ?), updated_at = ? WHERE id = ?')->execute([$rank, time(), $p['id']]);
            out(['ok' => true]);

        // ---- команда ----
        case 'users':
            $need('team');
            $rows = $db->query('SELECT id, name, role, active, created_at, last_login FROM users WHERE active = 1 ORDER BY role, name')->fetchAll();
            foreach ($rows as &$r) {
                $r['can_manage'] = crm_can_manage($me, $r['role']) && (int)$r['id'] !== $meId;
            }
            out(['ok' => true, 'users' => $rows]);

        case 'user_create':
            $need('team');
            $role = $str('role', 10);
            $name = $str('name', 60);
            if (!isset(CRM_ROLES[$role]) || $name === '') {
                fail('Укажите имя и роль');
            }
            if (!crm_can_manage($me, $role)) {
                fail('Нет прав создавать эту роль', 403);
            }
            try {
                $pin = crm_pick_pin($str('pin', 6));
            } catch (InvalidArgumentException $e) {
                fail($e->getMessage());
            }
            $db->prepare('INSERT INTO users(name, role, pin_hash, created_at, created_by) VALUES(?,?,?,?,?)')
                ->execute([$name, $role, crm_pin_hash($pin), time(), $meId]);
            $id = (int)$db->lastInsertId();
            crm_log($meId, 'user_create', null, null, $name, ['user' => $id, 'role' => $role]);
            out(['ok' => true, 'id' => $id, 'pin' => $pin]);

        case 'user_pin_reset':
        case 'user_delete':
            $need('team');
            $st = $db->prepare('SELECT * FROM users WHERE id = ? AND active = 1');
            $st->execute([$int('id')]);
            $u = $st->fetch();
            if (!$u || (int)$u['id'] === $meId || !crm_can_manage($me, $u['role'])) {
                fail('Нет прав на этого человека', 403);
            }
            $db->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$u['id']]);
            if ($a === 'user_delete') {
                $db->prepare('UPDATE users SET active = 0 WHERE id = ?')->execute([$u['id']]);
                crm_log($meId, 'user_delete', null, null, $u['name'], ['user' => (int)$u['id']]);
                out(['ok' => true]);
            }
            try {
                $pin = crm_pick_pin($str('pin', 6), (int)$u['id']);
            } catch (InvalidArgumentException $e) {
                fail($e->getMessage());
            }
            $db->prepare('UPDATE users SET pin_hash = ?, must_change = 1 WHERE id = ?')->execute([crm_pin_hash($pin), $u['id']]);
            crm_log($meId, 'user_pin_reset', null, null, $u['name'], ['user' => (int)$u['id']]);
            out(['ok' => true, 'pin' => $pin]);

        case 'stats':
            $need('stats');
            out(['ok' => true] + stats($db, max(0, min(3650, (int)($_GET['days'] ?? 30)))));

        case 'csv':
            $need('export');
            send_csv($db, (string)($_GET['what'] ?? 'people'), (int)($_GET['id'] ?? 0));
    }
    fail('unknown_action', 404);
} catch (Throwable $e) {
    error_log('CRM: ' . $e->getMessage());
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    fail('Ошибка сервера, попробуйте ещё раз', 500);
}

// ---------------------------------------------------------------------------

function public_user(array $u): array
{
    return ['id' => (int)$u['id'], 'name' => $u['name'], 'role' => $u['role'],
        'must_change' => (int)$u['must_change'] === 1, 'tour_done' => (int)($u['tour_done'] ?? 0) === 1];
}

function new_code(PDO $db): string
{
    $abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    do {
        $c = '';
        for ($i = 0; $i < 7; $i++) {
            $c .= $abc[random_int(0, strlen($abc) - 1)];
        }
        $st = $db->prepare('SELECT 1 FROM events WHERE code = ?');
        $st->execute([$c]);
    } while ($st->fetchColumn());
    return $c;
}

function event_row(PDO $db, int $id): array
{
    $st = $db->prepare('SELECT * FROM events WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: fail('Мероприятие не найдено', 404);
}

function reg_row(PDO $db, int $id): array
{
    $st = $db->prepare('SELECT * FROM regs WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: fail('Запись не найдена', 404);
}

function person_row(PDO $db, int $id): array
{
    $st = $db->prepare('SELECT * FROM people WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: fail('Участник не найден', 404);
}

function event_came(PDO $db, int $id): int
{
    $st = $db->prepare('SELECT COUNT(*) FROM regs WHERE event_id = ? AND came = 1');
    $st->execute([$id]);
    return (int)$st->fetchColumn();
}

function event_public_url(array $e): string
{
    return CRM_SITE . '/zapis.html?e=' . $e['code'];
}

function events_list(PDO $db, string $scope): array
{
    $rows = $db->query("SELECT e.*,
        (SELECT COUNT(*) FROM regs r WHERE r.event_id = e.id AND r.status = 'reg') AS taken,
        (SELECT COUNT(*) FROM regs r WHERE r.event_id = e.id AND r.came = 1) AS came
        FROM events e ORDER BY e.date, e.time_start")->fetchAll();
    $outRows = [];
    foreach ($rows as $e) {
        $e['past'] = crm_event_past($e);
        if (($scope === 'upcoming' && $e['past']) || ($scope === 'past' && !$e['past'])) {
            continue;
        }
        $e['url'] = event_public_url($e);
        $outRows[] = $e;
    }
    if ($scope === 'past') {
        $outRows = array_reverse($outRows);
    }
    return $outRows;
}

function visits_sql(): string
{
    return '(SELECT COUNT(*) FROM regs r WHERE r.person_id = p.id AND r.came = 1)';
}

function event_full(PDO $db, int $id): array
{
    $e = event_row($db, $id);
    $e['past'] = crm_event_past($e);
    $e['url'] = event_public_url($e);
    $st = $db->prepare('SELECT r.id, r.status, r.came, r.source, r.created_at, r.came_at, p.id AS person_id, p.name, p.phone, p.rank, '
        . visits_sql() . ' AS visits FROM regs r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? ORDER BY r.status, p.name');
    $st->execute([$id]);
    $regs = $st->fetchAll();
    $st = $db->prepare('SELECT l.type, l.text, l.meta, l.created_at, l.person_id, u.name AS user_name, p.name AS person_name
        FROM log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN people p ON p.id = l.person_id
        WHERE l.event_id = ? ORDER BY l.id DESC LIMIT 200');
    $st->execute([$id]);
    $log = $st->fetchAll();
    foreach ($log as &$l) {
        $l['meta'] = $l['meta'] ? json_decode($l['meta'], true) : null;
    }
    return ['event' => $e, 'regs' => $regs, 'log' => $log];
}

/** Следующее звание, до которого человек уже «дорос» по посещениям; null — нет. */
function ready_rank(int $rank, int $visits): ?int
{
    $next = $rank + 1;
    if (!isset(CRM_RANKS[$next])) {
        return null;
    }
    $need = CRM_RANKS[$next][1];
    return $need !== null && $visits >= $need ? $next : null;
}

function people_list(PDO $db, string $q, string $filter): array
{
    $where = [];
    $args = [];
    if ($q !== '') {
        $digits = preg_replace('/\D+/', '', $q);
        $where[] = '(p.name LIKE ? OR (? <> \'\' AND p.phone LIKE ?))';
        array_push($args, '%' . $q . '%', $digits, '%' . $digits . '%');
    }
    if ($filter === 'new') {
        $where[] = 'p.created_at > ' . (time() - 30 * 86400);
    }
    $sql = 'SELECT p.id, p.name, p.phone, p.rank, p.created_at, ' . visits_sql() . ' AS visits,
        (SELECT COUNT(*) FROM regs r WHERE r.person_id = p.id AND r.status = \'reg\') AS regs,
        (SELECT MAX(e.date) FROM regs r JOIN events e ON e.id = r.event_id WHERE r.person_id = p.id AND r.came = 1) AS last_visit
        FROM people p' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY visits DESC, p.name LIMIT 1000';
    $st = $db->prepare($sql);
    $st->execute($args);
    $rows = $st->fetchAll();
    foreach ($rows as $i => &$r) {
        $r['ready'] = ready_rank((int)$r['rank'], (int)$r['visits']);
        if ($filter === 'ready' && !$r['ready']) {
            unset($rows[$i]);
        }
        if ($filter === 'lost' && !($r['last_visit'] && $r['last_visit'] < date('Y-m-d', time() - 21 * 86400))) {
            unset($rows[$i]);
        }
    }
    return array_values($rows);
}

function person_full(PDO $db, int $id): array
{
    $p = person_row($db, $id);
    $st = $db->prepare('SELECT r.id, r.status, r.came, r.source, r.created_at, e.id AS event_id, e.title, e.kind, e.date, e.time_start, e.place
        FROM regs r JOIN events e ON e.id = r.event_id WHERE r.person_id = ? ORDER BY e.date DESC, e.time_start DESC');
    $st->execute([$id]);
    $regs = $st->fetchAll();
    $visits = 0;
    foreach ($regs as $r) {
        $visits += (int)$r['came'];
    }
    $st = $db->prepare('SELECT c.*, u.name AS user_name FROM certs c LEFT JOIN users u ON u.id = c.issued_by WHERE c.person_id = ? ORDER BY c.rank DESC, c.id DESC');
    $st->execute([$id]);
    $p['visits'] = $visits;
    $p['ready'] = ready_rank((int)$p['rank'], $visits);
    return ['person' => $p, 'regs' => $regs, 'certs' => $st->fetchAll()];
}

function stats(PDO $db, int $days): array
{
    $from = $days ? date('Y-m-d', time() - $days * 86400) : '0000-00-00';
    $today = date('Y-m-d');
    $st = $db->prepare("SELECT e.id, e.title, e.kind, e.date, e.time_start, e.time_end, e.capacity, e.status,
        (SELECT COUNT(*) FROM regs r WHERE r.event_id = e.id AND r.status = 'reg') AS taken,
        (SELECT COUNT(*) FROM regs r WHERE r.event_id = e.id AND r.came = 1) AS came
        FROM events e WHERE e.date >= ? AND e.date <= ? AND e.status <> 'cancelled' ORDER BY e.date, e.time_start");
    $st->execute([$from, $today]);
    $past = array_values(array_filter($st->fetchAll(), 'crm_event_past'));
    $reg = $came = 0;
    $byKind = [];
    foreach ($past as $e) {
        $reg += (int)$e['taken'];
        $came += (int)$e['came'];
        $byKind[$e['kind']] = ($byKind[$e['kind']] ?? 0) + (int)$e['came'];
    }
    arsort($byKind);

    $st = $db->prepare('SELECT COUNT(DISTINCT r.person_id) FROM regs r JOIN events e ON e.id = r.event_id WHERE r.came = 1 AND e.date >= ?');
    $st->execute([$from]);
    $active = (int)$st->fetchColumn();
    $st = $db->prepare('SELECT COUNT(*) FROM people WHERE created_at >= ?');
    $st->execute([$days ? time() - $days * 86400 : 0]);
    $newPeople = (int)$st->fetchColumn();
    $total = (int)$db->query('SELECT COUNT(*) FROM people')->fetchColumn();

    $ranks = array_fill_keys(array_merge([0], array_keys(CRM_RANKS)), 0);
    foreach ($db->query('SELECT rank, COUNT(*) n FROM people GROUP BY rank') as $r) {
        $ranks[(int)$r['rank']] = (int)$r['n'];
    }
    $st = $db->prepare('SELECT r.source, COUNT(*) n FROM regs r JOIN events e ON e.id = r.event_id WHERE e.date >= ? GROUP BY r.source');
    $st->execute([$from]);
    $bySource = [];
    foreach ($st as $r) {
        $bySource[$r['source']] = (int)$r['n'];
    }

    $top = $db->query('SELECT p.id, p.name, p.rank, ' . visits_sql() . ' AS visits FROM people p ORDER BY visits DESC, p.name LIMIT 10')->fetchAll();
    $top = array_values(array_filter($top, fn($p) => (int)$p['visits'] > 0));
    $ready = array_slice(people_list($db, '', 'ready'), 0, 20);

    return [
        'days' => $days, 'events' => count($past), 'reg' => $reg, 'came' => $came, 'active' => $active,
        'new_people' => $newPeople, 'people_total' => $total, 'by_kind' => $byKind, 'by_source' => $bySource,
        'ranks' => $ranks, 'top' => $top, 'ready' => $ready, 'last' => array_slice(array_reverse($past), 0, 12),
    ];
}

function send_csv(PDO $db, string $what, int $id): never
{
    if ($what === 'event') {
        $data = event_full($db, $id);
        $name = 'zapis-' . $data['event']['date'] . '.csv';
        $rows = [['Имя', 'Телефон', 'Статус', 'Пришёл', 'Откуда', 'Записан']];
        foreach ($data['regs'] as $r) {
            $rows[] = [$r['name'], '+' . $r['phone'], $r['status'] === 'reg' ? 'записан' : 'отменил', $r['came'] ? 'да' : 'нет',
                $r['source'] === 'site' ? 'сайт' : 'CRM', date('d.m.Y H:i', (int)$r['created_at'])];
        }
    } else {
        $name = 'uchastniki-' . date('Y-m-d') . '.csv';
        $rows = [['Имя', 'Телефон', 'Звание', 'Посещений', 'Последнее посещение', 'В базе с']];
        foreach (people_list($db, '', 'all') as $p) {
            $rows[] = [$p['name'], '+' . $p['phone'], CRM_RANKS[(int)$p['rank']][0] ?? '—', $p['visits'], $p['last_visit'] ?? '',
                date('d.m.Y', (int)$p['created_at'])];
        }
    }
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    $f = fopen('php://output', 'w');
    fwrite($f, "\xEF\xBB\xBF"); // BOM — чтобы Excel открыл кириллицу
    foreach ($rows as $r) {
        fputcsv($f, $r, ';');
    }
    exit;
}
