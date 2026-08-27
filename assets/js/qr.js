/* Минимальный генератор QR-кода (режим «байты», уровень коррекции M,
   версии 1–20). Нужен, чтобы на печатном бланке сертификата был код:
   отсканировал — открыл цифровой оригинал и убедился в подлинности.
   Внешних библиотек на сайте нет, поэтому кодировщик свой.
   Возвращает матрицу true/false — рисовать её можно чем угодно (SVG/canvas). */
(function (global) {
  "use strict";

  /* [кодовых слов коррекции на блок, блоков группы 1, данных в блоке группы 1,
      блоков группы 2, данных в блоке группы 2] — для уровня M, версии 1..20 */
  var EC_M = [
    null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37], [26, 4, 43, 1, 44], [30, 1, 50, 4, 51], [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46],
    [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42]
  ];

  var ALIGN = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
    [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
    [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90]
  ];

  /* ---------- арифметика Галуа GF(256) для кода Рида — Соломона ---------- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1);
      for (var j = 0; j < next.length; j++) next[j] = 0;
      for (j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(ecLen);
    for (var i = 0; i < ecLen; i++) res[i] = 0;
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (var j = 0; j < gen.length - 1; j++) res[j] ^= gfMul(gen[j + 1], factor);
    }
    return res;
  }

  /* ---------- служебные последовательности ---------- */
  function bchFormat(fmt) {          // 15-битная защита формата
    var d = fmt << 10;
    for (var i = 4; i >= 0; i--) if (d & (1 << (i + 10))) d ^= 0x537 << i;
    return ((fmt << 10) | d) ^ 0x5412;
  }

  function bchVersion(ver) {         // 18-битная защита версии (для 7+)
    var d = ver << 12;
    for (var i = 5; i >= 0; i--) if (d & (1 << (i + 12))) d ^= 0x1f25 << i;
    return (ver << 12) | d;
  }

  function utf8(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }

  function capacity(ver) {
    var e = EC_M[ver];
    return e[1] * e[2] + e[3] * e[4];       // всего кодовых слов данных
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 20; v++) {
      var countBits = v < 10 ? 8 : 16;
      var needBits = 4 + countBits + byteLen * 8;
      if (needBits <= capacity(v) * 8) return v;
    }
    return null;                            // слишком длинные данные
  }

  /* ---------- сборка потока данных ---------- */
  function buildCodewords(bytes, ver) {
    var countBits = ver < 10 ? 8 : 16;
    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }
    push(0x4, 4);                            // режим «байты»
    push(bytes.length, countBits);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var total = capacity(ver) * 8;
    for (i = 0; i < 4 && bits.length < total; i++) bits.push(0);   // терминатор
    while (bits.length % 8) bits.push(0);
    var pad = [0xec, 0x11], p = 0;
    while (bits.length < total) { push(pad[p++ % 2], 8); }

    var cw = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      cw.push(b);
    }

    /* разбивка на блоки и чередование */
    var e = EC_M[ver], ecLen = e[0];
    var blocks = [], ecBlocks = [], pos = 0, k;
    for (k = 0; k < e[1]; k++) { blocks.push(cw.slice(pos, pos + e[2])); pos += e[2]; }
    for (k = 0; k < e[3]; k++) { blocks.push(cw.slice(pos, pos + e[4])); pos += e[4]; }
    for (k = 0; k < blocks.length; k++) ecBlocks.push(rsEncode(blocks[k], ecLen));

    var out = [], maxLen = Math.max(e[2], e[4] || 0);
    for (i = 0; i < maxLen; i++) {
      for (k = 0; k < blocks.length; k++) if (i < blocks[k].length) out.push(blocks[k][i]);
    }
    for (i = 0; i < ecLen; i++) {
      for (k = 0; k < ecBlocks.length; k++) out.push(ecBlocks[k][i]);
    }
    return out;
  }

  /* ---------- матрица ---------- */
  function makeMatrix(ver, codewords, mask) {
    var size = ver * 4 + 17;
    var m = [], reserved = [], i, j;
    for (i = 0; i < size; i++) {
      m.push(new Array(size).fill(false));
      reserved.push(new Array(size).fill(false));
    }
    function set(r, c, v) { m[r][c] = v; reserved[r][c] = true; }

    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var inRing = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                       (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
          var inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          set(rr, cc, inRing || inCore);
        }
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (i = 8; i < size - 8; i++) {                 // синхрополосы
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }

    var centers = ALIGN[ver];                        // выравнивающие узоры
    for (i = 0; i < centers.length; i++) {
      for (j = 0; j < centers.length; j++) {
        var r = centers[i], c = centers[j];
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (var dr2 = -2; dr2 <= 2; dr2++) {
          for (var dc2 = -2; dc2 <= 2; dc2++) {
            set(r + dr2, c + dc2, Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1);
          }
        }
      }
    }

    set(size - 8, 8, true);                          // всегда тёмный модуль

    for (i = 0; i <= 8; i++) {                       // резерв под данные формата
      if (i !== 6) { reserved[8][i] = true; reserved[i][8] = true; }
    }
    for (i = 0; i < 8; i++) {
      reserved[8][size - 1 - i] = true;
      reserved[size - 1 - i][8] = true;
    }
    if (ver >= 7) {
      for (i = 0; i < 6; i++) {
        for (j = 0; j < 3; j++) {
          reserved[size - 11 + j][i] = true;
          reserved[i][size - 11 + j] = true;
        }
      }
    }

    /* укладка данных «змейкой» справа налево */
    var bitIdx = 0, upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                          // столбец синхрополосы пропускаем
      for (var step = 0; step < size; step++) {
        var row = upward ? size - 1 - step : step;
        for (var s = 0; s < 2; s++) {
          var cc2 = col - s;
          if (reserved[row][cc2]) continue;
          var bit = false;
          if (bitIdx < codewords.length * 8) {
            bit = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
          }
          bitIdx++;
          var maskOn;
          switch (mask) {
            case 0: maskOn = (row + cc2) % 2 === 0; break;
            case 1: maskOn = row % 2 === 0; break;
            case 2: maskOn = cc2 % 3 === 0; break;
            case 3: maskOn = (row + cc2) % 3 === 0; break;
            case 4: maskOn = (Math.floor(row / 2) + Math.floor(cc2 / 3)) % 2 === 0; break;
            case 5: maskOn = ((row * cc2) % 2) + ((row * cc2) % 3) === 0; break;
            case 6: maskOn = (((row * cc2) % 2) + ((row * cc2) % 3)) % 2 === 0; break;
            default: maskOn = (((row + cc2) % 2) + ((row * cc2) % 3)) % 2 === 0;
          }
          m[row][cc2] = maskOn ? !bit : bit;
        }
      }
      upward = !upward;
    }

    /* данные формата (уровень M = 0b00) */
    var fmt = bchFormat((0 << 3) | mask);
    for (i = 0; i < 15; i++) {
      var b2 = ((fmt >> i) & 1) === 1;
      if (i < 6) m[i][8] = b2;
      else if (i < 8) m[i + 1][8] = b2;
      else if (i === 8) m[8][7] = b2;
      else m[8][14 - i] = b2;

      if (i < 8) m[8][size - 1 - i] = b2;
      else m[size - 15 + i][8] = b2;
    }
    if (ver >= 7) {
      var vinfo = bchVersion(ver);
      for (i = 0; i < 18; i++) {
        var b3 = ((vinfo >> i) & 1) === 1;
        m[Math.floor(i / 3)][size - 11 + (i % 3)] = b3;
        m[size - 11 + (i % 3)][Math.floor(i / 3)] = b3;
      }
    }
    return m;
  }

  /* ---------- выбор маски по штрафным очкам (правила стандарта) ---------- */
  function penalty(m) {
    var size = m.length, score = 0, i, j, run, dark = 0;

    for (i = 0; i < size; i++) {                     // правило 1: серии подряд
      run = 1;
      for (j = 1; j < size; j++) {
        if (m[i][j] === m[i][j - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
      for (j = 1; j < size; j++) {
        if (m[j][i] === m[j - 1][i]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    for (i = 0; i < size - 1; i++) {                 // правило 2: блоки 2×2
      for (j = 0; j < size - 1; j++) {
        var v = m[i][j];
        if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) score += 3;
      }
    }

    var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    function matches(get, start, pat) {
      for (var k = 0; k < 11; k++) if (get(start + k) !== pat[k]) return false;
      return true;
    }
    for (i = 0; i < size; i++) {                     // правило 3: узор-обманка
      for (j = 0; j <= size - 11; j++) {
        var rowGet = (function (r) { return function (k) { return m[r][k]; }; })(i);
        var colGet = (function (c) { return function (k) { return m[k][c]; }; })(i);
        if (matches(rowGet, j, pat1) || matches(rowGet, j, pat2)) score += 40;
        if (matches(colGet, j, pat1) || matches(colGet, j, pat2)) score += 40;
      }
    }

    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j]) dark++;
    var pct = (dark * 100) / (size * size);          // правило 4: баланс чёрного
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* Возвращает { size, modules } либо null, если строка не помещается.
     forceMask используется только автотестами сверки с эталоном. */
  function encode(text, forceMask) {
    var bytes = utf8(String(text));
    var ver = pickVersion(bytes.length);
    if (!ver) return null;
    var cw = buildCodewords(bytes, ver);
    if (forceMask != null) {
      var fm = makeMatrix(ver, cw, forceMask);
      return { size: fm.length, modules: fm, version: ver, mask: forceMask };
    }
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var mask = 0; mask < 8; mask++) {
      var m = makeMatrix(ver, cw, mask);
      var s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; bestMask = mask; }
    }
    return { size: best.length, modules: best, version: ver, mask: bestMask };
  }

  /* Готовый SVG: одна «дорожка» на все тёмные модули — компактно и чётко печатается */
  function toSvg(text, opts) {
    opts = opts || {};
    var qr = encode(text);
    if (!qr) return null;
    var quiet = opts.quiet == null ? 2 : opts.quiet;
    var total = qr.size + quiet * 2;
    var d = "";
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
      '" shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || "QR-код") + '">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + (opts.bg || "#ffffff") + '"/>' +
      '<path d="' + d + '" fill="' + (opts.fg || "#000000") + '"/></svg>';
  }

  global.NespatQR = { encode: encode, toSvg: toSvg };
})(window);
