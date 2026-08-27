/* Пересборка PDF-версии руководства из certificate-guide.html.
   Запуск: подними локальный сервер (python3 -m http.server 8123) из корня
   репозитория и выполни `node scripts/build-guide-pdf.js`. */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1100, height: 1400 } });
  const errs = [], bad = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().split('/').pop()); });
  await p.goto('http://localhost:8123/certificate-guide.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  // дождаться загрузки всех картинок
  await p.evaluate(() => Promise.all([...document.images].map(i => i.complete ? 1 :
    new Promise(r => { i.onload = i.onerror = r; }))));
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(400);
  await p.pdf({
    path: '/home/user/NeSpat/assets/doc/nespat-certificates-guide.pdf',
    format: 'A4', printBackground: true, preferCSSPageSize: true,
  });
  console.log('битые запросы:', bad.length ? bad.join(', ') : 'нет');
  console.log('JS-ошибки:', errs.length ? errs.join(' | ') : 'нет');
  await b.close();
})();
