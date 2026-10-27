<?php
/**
 * База CRM «НЕ СПАТЬ МОСКВА» — SQLite-файл вне папки сайта: на Beget это
 * каталог сайта над public_html (…/nespat/crm-data/crm.sqlite), снаружи его
 * не скачать. Если туда писать нельзя — запасной crm/data/ с запретом доступа.
 * Схема создаётся и дополняется сама при первом обращении (crm_migrate).
 */

declare(strict_types=1);

/** Роли команды — в стиле клуба. Права: lib/auth.php, crm_can(). */
const CRM_ROLES = ['dev' => 'Инженер', 'head' => 'Командир', 'manager' => 'Сержант'];

/** Виды мероприятий (ключ → подпись). */
const CRM_KINDS = [
    'training' => 'Тренировка',
    'boxing'   => 'Бокс',
    'func'     => 'Функциональный тренинг',
    'run'      => 'Бег',
    'defense'  => 'Самооборона',
    'tournament' => 'Турнир',
    'trip'     => 'Выезд',
    'meeting'  => 'Общий сбор',
    'charity'  => 'Благотворительность',
    'other'    => 'Другое',
];

/** Звания клуба и сколько посещений нужно (null — по решению команды). */
const CRM_RANKS = [
    1 => ['Новобранец', 1],
    2 => ['Боец', 10],
    3 => ['Железный', 30],
    4 => ['Защитник', null],
    5 => ['Страж', 100],
    6 => ['Наставник', null],
    7 => ['Легенда «Не Спать»', null],
];

function crm_data_dir(): string
{
    $candidates = [dirname(__DIR__, 3) . '/crm-data', dirname(__DIR__) . '/data'];
    foreach ($candidates as $dir) {
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        if (is_dir($dir) && is_writable($dir)) {
            if (str_starts_with($dir, dirname(__DIR__))) {
                // запасной каталог внутри сайта — закрываем от веба
                @file_put_contents($dir . '/.htaccess', "Require all denied\n");
            }
            return $dir;
        }
    }
    throw new RuntimeException('нет каталога для базы CRM');
}

function crm_db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $pdo = new PDO('sqlite:' . crm_data_dir() . '/crm.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    crm_migrate($pdo);
    return $pdo;
}

function crm_migrate(PDO $db): void
{
    $v = (int)$db->query('PRAGMA user_version')->fetchColumn();
    if ($v < 1) {
        $db->exec(<<<SQL
CREATE TABLE users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
  pin_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
  tour_done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, created_by INTEGER, last_login INTEGER
);
CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, ip TEXT
);
CREATE TABLE login_attempts(ip TEXT, ok INTEGER, ts INTEGER);
CREATE INDEX login_attempts_ts ON login_attempts(ts);
CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE people(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
  rank INTEGER NOT NULL DEFAULT 0, note TEXT, source TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE events(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, kind TEXT NOT NULL,
  date TEXT NOT NULL, time_start TEXT NOT NULL, time_end TEXT,
  place TEXT NOT NULL, address TEXT, map_url TEXT, capacity INTEGER NOT NULL DEFAULT 0,
  description TEXT, status TEXT NOT NULL DEFAULT 'open',
  created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX events_date ON events(date, time_start);
CREATE TABLE regs(
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  status TEXT NOT NULL DEFAULT 'reg', came INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL,
  created_at INTEGER NOT NULL, came_at INTEGER, came_by INTEGER REFERENCES users(id),
  UNIQUE(event_id, person_id)
);
CREATE INDEX regs_person ON regs(person_id);
CREATE TABLE certs(
  id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES people(id), rank INTEGER NOT NULL,
  date TEXT NOT NULL, number TEXT NOT NULL, url TEXT NOT NULL, note TEXT,
  issued_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL
);
CREATE INDEX certs_person ON certs(person_id);
CREATE TABLE log(
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), type TEXT NOT NULL,
  event_id INTEGER, person_id INTEGER, text TEXT, meta TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX log_event ON log(event_id, created_at);
CREATE INDEX log_person ON log(person_id, created_at);
CREATE TABLE pub_hits(ip TEXT, ts INTEGER);
CREATE TABLE used_tokens(nonce TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE INDEX pub_hits_ts ON pub_hits(ts);
PRAGMA user_version = 1;
SQL);
    }
    if ($v < 2) {
        // человек из команды — тоже участник клуба: учётка связана с карточкой по телефону
        $db->exec(<<<SQL
ALTER TABLE users ADD COLUMN person_id INTEGER REFERENCES people(id);
PRAGMA user_version = 2;
SQL);
    }
}

function crm_kv(string $k, ?string $set = null): ?string
{
    if ($set !== null) {
        crm_db()->prepare('INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')->execute([$k, $set]);
        return $set;
    }
    $st = crm_db()->prepare('SELECT v FROM kv WHERE k = ?');
    $st->execute([$k]);
    $v = $st->fetchColumn();
    return $v === false ? null : (string)$v;
}

/** Секрет для подписи токенов публичной формы: создаётся один раз и живёт в базе. */
function crm_secret(): string
{
    return crm_kv('secret') ?? crm_kv('secret', bin2hex(random_bytes(32)));
}

/** Запись в журнал: кто (null — сам участник через сайт), что, по какому мероприятию/участнику. */
function crm_log(?int $userId, string $type, ?int $eventId = null, ?int $personId = null, string $text = '', array $meta = []): void
{
    crm_db()->prepare('INSERT INTO log(user_id, type, event_id, person_id, text, meta, created_at) VALUES(?,?,?,?,?,?,?)')
        ->execute([$userId, $type, $eventId, $personId, $text, $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null, time()]);
}

/** Телефон к виду 7XXXXXXXXXX; null, если на российский номер не похоже. */
function crm_phone(?string $raw): ?string
{
    $d = preg_replace('/\D+/', '', (string)$raw) ?? '';
    if (strlen($d) === 10) {
        $d = '7' . $d;
    } elseif (strlen($d) === 11 && $d[0] === '8') {
        $d = '7' . substr($d, 1);
    }
    return preg_match('/^7\d{10}$/', $d) ? $d : null;
}

/** Участник по телефону: найти или завести. Пустое имя у найденного дополняется. */
function crm_person(string $phone, string $name, string $source): int
{
    $db = crm_db();
    $st = $db->prepare('SELECT id, name FROM people WHERE phone = ?');
    $st->execute([$phone]);
    $p = $st->fetch();
    $now = time();
    if ($p) {
        if (trim((string)$p['name']) === '' && $name !== '') {
            $db->prepare('UPDATE people SET name = ?, updated_at = ? WHERE id = ?')->execute([$name, $now, $p['id']]);
        }
        return (int)$p['id'];
    }
    $db->prepare('INSERT INTO people(name, phone, source, created_at, updated_at) VALUES(?,?,?,?,?)')
        ->execute([$name, $phone, $source, $now, $now]);
    $id = (int)$db->lastInsertId();
    crm_log(null, 'person_new', null, $id, $name, ['source' => $source]);
    return $id;
}

/** Сколько человек записано (не отменили) на мероприятие. */
function crm_taken(int $eventId): int
{
    $st = crm_db()->prepare("SELECT COUNT(*) FROM regs WHERE event_id = ? AND status = 'reg'");
    $st->execute([$eventId]);
    return (int)$st->fetchColumn();
}

/** Закончилось ли мероприятие (по московскому времени окончания, а если его нет — начала + 3 ч). */
function crm_event_past(array $e): bool
{
    $tz = new DateTimeZone('Europe/Moscow');
    $end = $e['time_end'] ?: null;
    $at = DateTime::createFromFormat('Y-m-d H:i', $e['date'] . ' ' . ($end ?? $e['time_start']), $tz);
    if (!$at) {
        return false;
    }
    if (!$end) {
        $at->modify('+3 hours');
    }
    return $at->getTimestamp() < time();
}
