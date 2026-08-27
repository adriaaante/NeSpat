/* Ядро системы сертификатов «НЕ СПАТЬ МОСКВА».
   Общее для страницы просмотра (certificate.html) и студии выдачи
   (certificate-studio.html): звания, подпись, номер, кодирование ссылки.

   ВАЖНО про подпись: сайт статический, поэтому ключ лежит в этом файле и
   технически доступен любому, кто откроет исходники. Подпись защищает от
   «случайной» подделки (переписать имя или звание в ссылке уже не выйдет),
   но не является криптографической гарантией против целенаправленного
   злоумышленника. Менять CERT_SECRET нельзя — это обнулит подлинность всех
   ранее выданных сертификатов. */
(function (global) {
  "use strict";

  var CERT_SECRET = "nespat-moskva::rank-certificate::v1";

  /* ---------- 7 званий клуба ---------- */
  var RANKS = [
    {
      id: 1, key: "recruit", roman: "I", name: "Новобранец",
      title: "Новобранец клуба",
      reason: "За вступление в спортивный клуб «НЕ СПАТЬ МОСКВА»",
      motto: "Первый шаг сделан — дальше только вперёд",
      accent: "#8b9099", accent2: "#c3c8d0", ink: "#0d0d0f", emblem: "chevron"
    },
    {
      id: 2, key: "fighter", roman: "II", name: "Боец",
      title: "Боец клуба",
      reason: "За 10 тренировок в составе клуба",
      motto: "Боец не ищет отговорок — он приходит и работает",
      accent: "#e02b2b", accent2: "#ff6b5e", ink: "#0d0d0f", emblem: "fist"
    },
    {
      id: 3, key: "iron", roman: "III", name: "Железный",
      title: "Железный",
      reason: "За 30 тренировок и сдачу первых нормативов клуба",
      motto: "Дисциплина стала характером",
      accent: "#9fb0c0", accent2: "#e8f0f7", ink: "#0d0d0f", emblem: "iron"
    },
    {
      id: 4, key: "defender", roman: "IV", name: "Защитник",
      title: "Защитник",
      reason: "За освоение базы самообороны",
      motto: "Спокойная сила вместо страха",
      accent: "#4a8fb5", accent2: "#9ed6f0", ink: "#0d0d0f", emblem: "shield"
    },
    {
      id: 5, key: "guard", roman: "V", name: "Страж",
      title: "Страж клуба",
      reason: "За 100 тренировок и участие в событиях клуба",
      motto: "Опора команды на тренировках и турнирах",
      accent: "#b03a4a", accent2: "#ef7f8c", ink: "#0d0d0f", emblem: "guard"
    },
    {
      id: 6, key: "mentor", roman: "VI", name: "Наставник",
      title: "Наставник клуба",
      reason: "За воспитание новичков и помощь тренерам",
      motto: "Клуб растёт теми, кто ведёт за собой",
      accent: "#c98a3c", accent2: "#f0c98a", ink: "#0d0d0f", emblem: "mentor"
    },
    {
      id: 7, key: "legend", roman: "VII", name: "Легенда «Не Спать»",
      title: "Легенда клуба",
      reason: "За выдающийся вклад в развитие клуба",
      motto: "Легенд знают по именам — их истории рассказывают новичкам",
      accent: "#ffc93c", accent2: "#fff0b8", ink: "#0d0d0f", emblem: "legend"
    }
  ];

  function rankById(id) {
    id = Number(id);
    for (var i = 0; i < RANKS.length; i++) if (RANKS[i].id === id) return RANKS[i];
    return null;
  }

  /* ---------- SHA-256 (чистый JS: работает и без https, и из file://) ---------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  /* принимает Array/Uint8Array байт, возвращает Array из 32 байт */
  function sha256Bytes(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = bytes.length;
    var withPad = [];
    var i;
    for (i = 0; i < len; i++) withPad.push(bytes[i] & 0xff);
    withPad.push(0x80);
    while (withPad.length % 64 !== 56) withPad.push(0);
    var bitsHi = Math.floor(len / 536870912);        // len * 8 / 2^32
    var bitsLo = (len * 8) >>> 0;
    withPad.push((bitsHi >>> 24) & 0xff, (bitsHi >>> 16) & 0xff, (bitsHi >>> 8) & 0xff, bitsHi & 0xff);
    withPad.push((bitsLo >>> 24) & 0xff, (bitsLo >>> 16) & 0xff, (bitsLo >>> 8) & 0xff, bitsLo & 0xff);

    var w = new Array(64);
    for (var off = 0; off < withPad.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = ((withPad[off + i * 4] << 24) | (withPad[off + i * 4 + 1] << 16) |
                (withPad[off + i * 4 + 2] << 8) | withPad[off + i * 4 + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) out.push((h[i] >>> 24) & 0xff, (h[i] >>> 16) & 0xff, (h[i] >>> 8) & 0xff, h[i] & 0xff);
    return out;
  }

  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }

  function hmacSha256(keyStr, msgStr) {
    var key = utf8Bytes(keyStr);
    if (key.length > 64) key = sha256Bytes(key);
    while (key.length < 64) key.push(0);
    var inner = [], outer = [], i;
    for (i = 0; i < 64; i++) { inner.push(key[i] ^ 0x36); outer.push(key[i] ^ 0x5c); }
    var msg = utf8Bytes(msgStr);
    var innerHash = sha256Bytes(inner.concat(msg));
    return sha256Bytes(outer.concat(innerHash));
  }

  function toHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += ("0" + bytes[i].toString(16)).slice(-2);
    return s;
  }

  /* ---------- нормализация и подписи ---------- */
  /* Имя приводим к единому виду, чтобы «Пётр  Иванов» и «петр иванов»
     давали один и тот же номер сертификата. */
  function normName(name) {
    return String(name || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }

  /* Номер сертификата: NSM-<звание>-<ГГММ>-<код>.
     Код считается от имени, звания и месяца выдачи — поэтому по номеру и
     имени владельца подлинность можно проверить вручную, без ссылки. */
  var ALPHABET = "ACDEFHJKLMNPRTUVWXY3479"; // без похожих символов (0/O, 1/I, 5/S...)

  function shortCode(name, rankId, ym) {
    var mac = hmacSha256(CERT_SECRET, "id|" + normName(name) + "|" + rankId + "|" + ym);
    var code = "";
    for (var i = 0; i < 6; i++) code += ALPHABET.charAt(mac[i] % ALPHABET.length);
    return code;
  }

  function makeId(name, rankId, dateIso) {
    var ym = String(dateIso || "").slice(0, 7);          // YYYY-MM
    var yy = ym.slice(2, 4), mm = ym.slice(5, 7);
    return "NSM-" + rankId + "-" + yy + mm + "-" + shortCode(name, rankId, ym);
  }

  /* Разбор номера обратно: NSM-4-2608-K7X9AM */
  function parseId(id) {
    var m = String(id || "").toUpperCase().replace(/\s+/g, "").match(/^NSM-([1-7])-(\d{2})(\d{2})-([A-Z0-9]{6})$/);
    if (!m) return null;
    return { rankId: Number(m[1]), ym: "20" + m[2] + "-" + m[3], code: m[4] };
  }

  /* Подпись всей карточки: защищает и то, что показано на экране
     (имя, звание, точная дата, комментарий). */
  function signature(data) {
    var canon = ["v1", normName(data.n), data.r, data.d || "", String(data.m || "").trim()].join("|");
    return toHex(hmacSha256(CERT_SECRET, canon)).slice(0, 16);
  }

  /* ---------- ссылка ----------
     Номер (k) в ссылке не храним: он однозначно выводится из имени, звания и
     месяца, поэтому его пересчитывает страница просмотра. Так ссылка короче —
     и QR-код на печатном бланке получается заметно проще для сканирования. */
  function encodePayload(data) {
    var slim = { n: data.n, r: data.r, d: data.d, s: data.s };
    if (data.m) slim.m = data.m;
    var bytes = utf8Bytes(JSON.stringify(slim));
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return "1." + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodePayload(hash) {
    try {
      var h = String(hash || "").replace(/^#/, "");
      if (h.indexOf("1.") !== 0) return null;
      var b64 = h.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var bin = atob(b64);
      var bytes = [];
      for (var i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
      /* декодируем UTF-8 вручную — без зависимости от TextDecoder */
      var str = decodeURIComponent(bytes.map(function (b) {
        return "%" + ("0" + b.toString(16)).slice(-2);
      }).join(""));
      var data = JSON.parse(str);
      if (!data || !data.n || !rankById(data.r)) return null;
      data.k = makeId(data.n, data.r, data.d);   // номер восстанавливаем
      return data;
    } catch (e) { return null; }
  }

  /* Полная сборка сертификата из формы */
  function build(name, rankId, dateIso, note) {
    var clean = String(name || "").replace(/\s+/g, " ").trim();
    var data = { n: clean, r: Number(rankId), d: dateIso, m: String(note || "").trim() };
    if (!data.m) delete data.m;
    data.k = makeId(clean, data.r, dateIso);
    data.s = signature(data);
    return data;
  }

  /* Проверка ссылки: подпись покрывает имя, звание, дату и комментарий,
     поэтому любая правка данных в ссылке ломает её. */
  function verify(data) {
    if (!data || !rankById(data.r)) return { ok: false, reason: "broken" };
    if (!data.s || data.s !== signature(data)) return { ok: false, reason: "signature" };
    return { ok: true };
  }

  /* Проверка вручную: номер + имя владельца (для печатной версии) */
  function verifyByNumber(id, name) {
    var parsed = parseId(id);
    if (!parsed) return { ok: false, reason: "format" };
    var expected = shortCode(name, parsed.rankId, parsed.ym);
    if (expected !== parsed.code) return { ok: false, reason: "mismatch" };
    return { ok: true, rank: rankById(parsed.rankId), ym: parsed.ym };
  }

  /* ---------- формат дат ---------- */
  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
                "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  function formatDate(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] + " года";
  }

  function formatMonth(ym) {
    var m = String(ym || "").match(/^(\d{4})-(\d{2})$/);
    if (!m) return "";
    return MONTHS[Number(m[2]) - 1] + " " + m[1];
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  global.NespatCert = {
    RANKS: RANKS,
    rankById: rankById,
    build: build,
    verify: verify,
    verifyByNumber: verifyByNumber,
    makeId: makeId,
    parseId: parseId,
    encodePayload: encodePayload,
    decodePayload: decodePayload,
    formatDate: formatDate,
    formatMonth: formatMonth,
    today: today,
    _hmacHex: function (k, m) { return toHex(hmacSha256(k, m)); },
    _sha256Hex: function (s) { return toHex(sha256Bytes(utf8Bytes(s))); }
  };
})(window);
