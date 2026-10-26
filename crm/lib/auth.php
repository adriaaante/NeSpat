<?php
/**
 * Вход по PIN из 6 цифр и права ролей.
 *
 * PIN у каждого свой и уникальный — по нему и узнаём, кто вошёл. Храним только
 * хэш. От подбора: 5 ошибок с адреса — пауза 15 минут, 30 ошибок со всех
 * адресов за час — вход закрыт на час. Сессия — случайный токен в cookie
 * (HttpOnly, Secure, SameSite=Strict, путь /crm/), в базе только его хэш;
 * живёт 30 дней, без активности — 7 дней.
 *
 * PIN, выданный при создании или сбросе, — временный: при первом входе
 * нужно задать свой (must_change), до этого API пускает только к смене PIN.
 *
 * Роли: Инженер (dev) — всё; Командир (head) — всё, кроме учёток Инженеров;
 * Сержант (manager) — мероприятия, записи, отметки и участники, без команды,
 * сертификатов, удаления и сводки.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const CRM_COOKIE = 'nsm_crm';
const CRM_SESSION_MAX = 30 * 86400;
const CRM_SESSION_IDLE = 7 * 86400;

/** Что можно роли: сержанту — только повседневная работа с мероприятиями. */
function crm_can(array $me, string $what): bool
{
    if ($me['role'] === 'dev' || $me['role'] === 'head') {
        return true;
    }
    return in_array($what, ['events', 'event_edit', 'regs', 'people'], true);
}

/** Cookie только по https; исключение — локальная проверка на 127.0.0.1. */
function crm_secure(): bool
{
    return !in_array(strtok((string)($_SERVER['HTTP_HOST'] ?? ''), ':'), ['127.0.0.1', 'localhost'], true);
}

function crm_ip(): string
{
    return (string)($_SERVER['REMOTE_ADDR'] ?? '');
}

function crm_pin_weak(string $pin): bool
{
    return !preg_match('/^\d{6}$/', $pin)
        || preg_match('/^(\d)\1{5}$/', $pin)
        || str_contains('0123456789', $pin)
        || str_contains('9876543210', $pin);
}

/** Занят ли PIN другим активным пользователем (сверка по хэшам). */
function crm_pin_taken(string $pin, ?int $exceptId = null): bool
{
    foreach (crm_db()->query('SELECT id, pin_hash FROM users WHERE active = 1') as $u) {
        if ((int)$u['id'] !== $exceptId && password_verify($pin, $u['pin_hash'])) {
            return true;
        }
    }
    return false;
}

/** PIN, заданный командиром, или сгенерированный, если поле пустое. */
function crm_pick_pin(string $given, ?int $exceptId = null): string
{
    if ($given === '') {
        return crm_new_pin();
    }
    if (crm_pin_weak($given)) {
        throw new InvalidArgumentException('PIN — 6 цифр, не одинаковые и не подряд');
    }
    if (crm_pin_taken($given, $exceptId)) {
        throw new InvalidArgumentException('Такой PIN уже у другого человека в команде');
    }
    return $given;
}

function crm_new_pin(): string
{
    do {
        $pin = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    } while (crm_pin_weak($pin) || crm_pin_taken($pin));
    return $pin;
}

function crm_pin_hash(string $pin): string
{
    return password_hash($pin, PASSWORD_DEFAULT);
}

/** Кем можно управлять: Инженер — всеми, Командир — всеми, кроме Инженеров. */
function crm_can_manage(array $actor, string $targetRole): bool
{
    return $actor['role'] === 'dev' || ($actor['role'] === 'head' && $targetRole !== 'dev');
}

/** Вход по PIN. Возвращает пользователя или бросает исключение с понятным текстом. */
function crm_login(string $pin): array
{
    $db = crm_db();
    $now = time();
    $ip = crm_ip();
    $db->prepare('DELETE FROM login_attempts WHERE ts < ?')->execute([$now - 86400]);

    $st = $db->prepare('SELECT COUNT(*) FROM login_attempts WHERE ok = 0 AND ts > ?');
    $st->execute([$now - 3600]);
    if ((int)$st->fetchColumn() >= 30) {
        throw new RuntimeException('Вход временно закрыт из-за подбора PIN. Попробуйте через час.');
    }
    $st = $db->prepare('SELECT COUNT(*) FROM login_attempts WHERE ok = 0 AND ip = ? AND ts > ?');
    $st->execute([$ip, $now - 900]);
    if ((int)$st->fetchColumn() >= 5) {
        throw new RuntimeException('Слишком много неверных попыток. Подождите 15 минут.');
    }

    $user = null;
    if (preg_match('/^\d{6}$/', $pin)) {
        foreach ($db->query('SELECT * FROM users WHERE active = 1') as $u) {
            if (password_verify($pin, $u['pin_hash'])) {
                $user = $u;
                break;
            }
        }
    }
    $db->prepare('INSERT INTO login_attempts(ip, ok, ts) VALUES(?,?,?)')->execute([$ip, $user ? 1 : 0, $now]);
    if (!$user) {
        throw new RuntimeException('Неверный PIN');
    }

    $token = bin2hex(random_bytes(32));
    $db->prepare('INSERT INTO sessions(token_hash, user_id, created_at, last_seen, ip) VALUES(?,?,?,?,?)')
        ->execute([hash('sha256', $token), $user['id'], $now, $now, $ip]);
    $db->prepare('UPDATE users SET last_login = ? WHERE id = ?')->execute([$now, $user['id']]);
    $db->prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?')->execute([$now - CRM_SESSION_IDLE, $now - CRM_SESSION_MAX]);
    setcookie(CRM_COOKIE, $token, [
        'expires' => $now + CRM_SESSION_MAX, 'path' => '/crm/', 'secure' => crm_secure(),
        'httponly' => true, 'samesite' => 'Strict',
    ]);
    crm_log((int)$user['id'], 'login');
    return $user;
}

function crm_current_user(): ?array
{
    $token = (string)($_COOKIE[CRM_COOKIE] ?? '');
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
        return null;
    }
    $db = crm_db();
    $now = time();
    $st = $db->prepare('SELECT u.*, s.token_hash, s.last_seen, s.created_at AS s_created FROM sessions s
                        JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.active = 1');
    $st->execute([hash('sha256', $token)]);
    $u = $st->fetch();
    if (!$u || $u['last_seen'] < $now - CRM_SESSION_IDLE || $u['s_created'] < $now - CRM_SESSION_MAX) {
        return null;
    }
    if ($u['last_seen'] < $now - 300) {
        $db->prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?')->execute([$now, $u['token_hash']]);
    }
    unset($u['pin_hash'], $u['token_hash']);
    return $u;
}

function crm_logout(): void
{
    $token = (string)($_COOKIE[CRM_COOKIE] ?? '');
    if ($token !== '') {
        crm_db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
    }
    setcookie(CRM_COOKIE, '', ['expires' => 1, 'path' => '/crm/', 'secure' => crm_secure(), 'httponly' => true, 'samesite' => 'Strict']);
}
