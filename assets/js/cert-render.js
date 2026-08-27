/* Отрисовка бланка сертификата. Общая для страницы просмотра и предпросмотра
   в студии выдачи, чтобы бланк везде был одинаковым. */
(function (global) {
  "use strict";

  var C = global.NespatCert;

  /* Уникальная эмблема под каждое звание — рисуется кодом, без картинок */
  var EMBLEMS = {
    chevron:
      '<path fill="currentColor" d="M32 14 56 34l-7 6-17-14-17 14-7-6 24-20Z" opacity=".35"/>' +
      '<path fill="currentColor" d="M32 30 56 50l-7 6-17-14-17 14-7-6 24-20Z"/>',
    fist:
      '<path fill="currentColor" d="M22 12h16a12 12 0 0 1 12 12v8a12 12 0 0 1-12 12H24a12 12 0 0 1-12-12v-8a12 12 0 0 1 10-11.9Z"/>' +
      '<path fill="currentColor" d="M14 24h-1a6 6 0 0 0 0 12h1v-12Z" opacity=".6"/>' +
      '<rect x="20" y="46" width="22" height="9" rx="3" fill="currentColor" opacity=".75"/>' +
      '<path fill="none" stroke="#0d0d0f" stroke-width="2.2" stroke-linecap="round" opacity=".35" d="M26 22v10M34 22v10M42 24v8"/>',
    iron:
      '<rect x="20" y="26" width="24" height="12" rx="1.5" fill="currentColor"/>' +
      '<rect x="12" y="18" width="7" height="28" rx="2" fill="currentColor"/>' +
      '<rect x="45" y="18" width="7" height="28" rx="2" fill="currentColor"/>' +
      '<rect x="5" y="24" width="6" height="16" rx="2" fill="currentColor" opacity=".55"/>' +
      '<rect x="53" y="24" width="6" height="16" rx="2" fill="currentColor" opacity=".55"/>',
    shield:
      '<path fill="none" stroke="currentColor" stroke-width="3.6" stroke-linejoin="round" d="M32 8 54 15v18c0 13-9 21-22 25C19 54 10 46 10 33V15L32 8Z"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="m22 32 7.5 7.5L43 26"/>',
    guard:
      '<path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round" d="M32 7 53 14v17c0 12.5-8.5 20.5-21 24.5C19.5 51.5 11 43.5 11 31V14L32 7Z"/>' +
      '<path fill="currentColor" d="m32 16 3.2 4v18.5h-6.4V20L32 16Z"/>' +
      '<path fill="currentColor" d="M24 38.5h16v4H24z"/>' +
      '<path fill="currentColor" d="M30.4 42.5h3.2V50l-1.6 2.4-1.6-2.4v-7.5Z"/>',
    mentor:
      '<path fill="currentColor" d="M32 4c5 7 8 11 8 16a8 8 0 0 1-16 0c0-5 3-9 8-16Z"/>' +
      '<path fill="currentColor" opacity=".45" d="M32 12c2.4 3.6 3.6 5.6 3.6 8a3.6 3.6 0 0 1-7.2 0c0-2.4 1.2-4.4 3.6-8Z"/>' +
      '<rect x="22" y="30" width="20" height="7" rx="2" fill="currentColor"/>' +
      '<path fill="currentColor" d="M27 39h10l-2.5 21h-5L27 39Z"/>',
    legend:
      '<path fill="currentColor" d="m32 10 4.8 10.4L48 21.8l-8 7.8 2 11.6L32 35.6l-10 5.6 2-11.6-8-7.8 11.2-1.4L32 10Z"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" d="M23 50c-8-3-12-11-11-20"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" d="M41 50c8-3 12-11 11-20"/>' +
      '<path fill="currentColor" d="M13 32c3.4-.6 5.6.6 6.6 3.2-2.8 1.2-5.2.4-6.6-3.2Zm1.6 8c3.2-1.2 5.6-.4 7 2-2.4 1.8-5 1.4-7-2Zm3.6 7.6c2.8-1.8 5.4-1.6 7.2.4-2 2.4-4.6 2.6-7.2-.4Z"/>' +
      '<path fill="currentColor" d="M51 32c-3.4-.6-5.6.6-6.6 3.2 2.8 1.2 5.2.4 6.6-3.2Zm-1.6 8c-3.2-1.2-5.6-.4-7 2 2.4 1.8 5 1.4 7-2Zm-3.6 7.6c-2.8-1.8-5.4-1.6-7.2.4 2 2.4 4.6 2.6 7.2-.4Z"/>'
  };

  function sealSvg() {
    return '<svg viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".85"/>' +
      '<circle cx="60" cy="60" r="45" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/>' +
      '<path id="sealArc" d="M60 22a38 38 0 1 1-.1 0" fill="none"/>' +
      '<text font-family="Oswald, sans-serif" font-size="9.5" letter-spacing="2.6" fill="currentColor" opacity=".9">' +
      '<textPath href="#sealArc" startOffset="4%">НЕ СПАТЬ МОСКВА · СПОРТИВНЫЙ КЛУБ ·</textPath></text>' +
      '<path fill="currentColor" d="m44 58 16 10 16-10v7l-16 10-16-10v-7Z" opacity=".6"/>' +
      '<path fill="currentColor" d="m44 70 16 10 16-10v7l-16 10-16-10v-7Z"/>' +
      '<text x="60" y="52" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="16" fill="currentColor">НСМ</text>' +
      '</svg>';
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Длинные имена и названия званий уменьшаем, чтобы бланк не «поехал» */
  function nameClass(name) {
    var n = String(name || "").length;
    if (n > 44) return " cert__name--xxlong";
    if (n > 34) return " cert__name--xlong";
    if (n > 22) return " cert__name--long";
    return "";
  }

  /* opts: { url — ссылка для QR (если нужен), monogram — путь к монограмме } */
  function html(data, opts) {
    opts = opts || {};
    var rank = C.rankById(data.r);
    var mono = opts.monogram || "assets/img/monogram.png";
    var qrSvg = "";
    if (opts.url && global.NespatQR) {
      qrSvg = global.NespatQR.toSvg(opts.url, { quiet: 1, label: "QR-код сертификата" }) || "";
    }

    return '' +
      '<div class="cert cert--r' + rank.id + '">' +
        '<div class="cert__frame"></div>' +
        '<span class="cert__corner cert__corner--tl"></span>' +
        '<span class="cert__corner cert__corner--tr"></span>' +
        '<span class="cert__corner cert__corner--bl"></span>' +
        '<span class="cert__corner cert__corner--br"></span>' +
        '<div class="cert__inner">' +
          '<div class="cert__head">' +
            '<img class="cert__mark" src="' + esc(mono) + '" alt="">' +
            '<span class="cert__club">НЕ СПАТЬ<em>МОСКВА</em></span>' +
          '</div>' +
          '<h1 class="cert__title">Сертификат</h1>' +
          '<span class="cert__rule"></span>' +
          '<p class="cert__lead">Настоящим подтверждается, что</p>' +
          '<p class="cert__name' + nameClass(data.n) + '">' + esc(data.n) + '</p>' +
          '<span class="cert__underline"></span>' +
          '<p class="cert__awarded">удостоен звания</p>' +
          '<div class="cert__rankrow">' +
            '<svg class="cert__emblem" viewBox="0 0 64 64" aria-hidden="true">' + EMBLEMS[rank.emblem] + '</svg>' +
            '<div class="cert__rankbox">' +
              '<div class="cert__roman">Ступень ' + rank.roman + '</div>' +
              '<div class="cert__rankname' + (rank.name.length > 12 ? " cert__rankname--long" : "") + '">' + esc(rank.name) + '</div>' +
            '</div>' +
          '</div>' +
          '<p class="cert__reason">' + esc(rank.reason) + '</p>' +
          '<p class="cert__motto">«' + esc(rank.motto) + '»</p>' +
          (data.m ? '<p class="cert__note">' + esc(data.m) + '</p>' : '') +
          '<div class="cert__footer">' +
            '<div>' +
              (qrSvg ? '<div class="cert__qr">' + qrSvg + '</div><div class="cert__qrcap">проверка</div>' : '') +
            '</div>' +
            '<div class="cert__meta">' +
              '<div class="cert__numcap">Сертификат №</div>' +
              '<div class="cert__num">' + esc(data.k) + '</div>' +
              '<div class="cert__date">Выдан ' + esc(C.formatDate(data.d)) + '</div>' +
              '<div class="cert__verifyline">Подлинность: nespatmoskva.ru/certificate.html</div>' +
            '</div>' +
            '<div class="cert__seal">' + sealSvg() + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function render(el, data, opts) {
    el.innerHTML = html(data, opts);
    return el;
  }

  global.NespatCertRender = { html: html, render: render, EMBLEMS: EMBLEMS };
})(window);
