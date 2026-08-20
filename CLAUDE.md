# NeSpat

## Что это
Сайт спортивного клуба уличных тренировок «НЕ СПАТЬ МОСКВА» (nespat).
Статический лендинг: HTML + CSS + vanilla JS, без сборки и зависимостей.
Фирменный стиль: чёрный/белый/красный (#e02b2b), шрифты Oswald + Inter.
**Шрифты хостятся локально** (`assets/fonts/{oswald,inter}-{latin,cyrillic}.woff2`,
вариативные 400–700, вместе 96 КБ) — Google Fonts не подключается: в РФ он
работает нестабильно, и при недоступности сайт терял гарнитуру. Подключение —
`@font-face` в начале `style.css` + preload в `<head>`; у `404.html` стили
инлайновые, там свой блок `@font-face` (правки шрифтов нужно дублировать).

## Структура проекта
- `index.html` — весь лендинг одной страницей (герой, о клубе, тренировки,
  галерея, 7 званий, форма записи). SVG-иконки — спрайт в конце файла.
- `assets/css/style.css` — все стили (дизайн-токены в `:root`).
- `assets/js/main.js` — навигация, reveal-анимации, параллакс, лайтбокс,
  маска телефона, отправка формы в Telegram.
- `assets/js/config.js` — токен/chat_id Telegram-бота (см. «Форма заявок»).
- `assets/img/` — фото с тренировок (из HEIC через thumbnail-API Google Drive;
  пережаты: длинная сторона ≤1800, JPEG q82 progressive, 19→8.7 МБ.
  `atmosphere-0*.png` стали `.jpg` — альфа была артефактом конвертации,
  подложен фон сайта #0a0a0b), `logo.jpg` (лого на чёрном фоне,
  на сайте применяется mix-blend-mode: screen), постеры видео,
  `monogram.png` (монограмма НСМ, вырезана из logo.jpg, белая на прозрачном —
  шапка/подвал), `favicon.png` (монограмма на тёмном квадрате). Самодельный
  щит «НС» использовать нельзя — просили убрать; только официальная графика.
- `assets/video/` — вертикальные видео: `reel-*.mp4` (720p, полные, со звуком,
  для лайтбокса; h264 crf31 + aac 80k) и `loop-*.mp4` (480p, 7 с, без звука,
  crf32, автоплей-превью в галерее). Все с `+faststart` — начинают играть
  до полной загрузки. Итого 29→18 МБ; на глаз от оригинала не отличаются
  (сравнивал кадры), сильнее жать не стоит.
- `.claude/skills/` — 7 скиллов пакета UI/UX Pro Max v2.11.0 (апстрим,
  руками не редактировать; обновлять целиком из релиза).
- `404.html` — страница ошибки в фирменной палитре (подключена через
  `ErrorDocument` в `.htaccess`); `robots.txt`, `sitemap.xml` — для поиска.

## Деплой
- **Боевой хостинг — Beget** (аккаунт `dudareid`, сервер `dudareid.beget.tech`,
  там же voidaform.ru и подноль.рф). Выкладка автоматическая:
  `.github/workflows/deploy.yml` — push в `claude/install-ui-ux-pro-max-skill-8bfxro`
  (или `main`) → заливка по FTP. Нужны секреты репо `FTP_SERVER`/`FTP_USERNAME`/
  `FTP_PASSWORD`/`FTP_DIR`; без них шаг мягко пропускается (warning, не ошибка).
  На хостинг не едут `.github/`, `.claude/`, `CLAUDE.md`.
- **Три домена, один сайт.** Основной — **nespatmoskva.ru**; `dontsleepmoscow.ru`
  и `неспатьмосква.рф` (punycode `xn--80aafk0alelgtej4k.xn--p1ai`) склеены с ним
  301-м редиректом в `.htaccess` (там же https, без www, кэш, gzip, Accept-Ranges
  для mp4 — иначе не перематывается видео). Canonical/OG/sitemap/robots смотрят
  на nespatmoskva.ru. При смене основного домена править: `.htaccess`,
  `index.html` (canonical, og:url, og:image, JSON-LD), `robots.txt`, `sitemap.xml`.
- Все три домена должны быть привязаны к одному сайту в панели Beget, и на
  каждом выпущен свой SSL Let's Encrypt — иначе редирект с https зеркала
  упрётся в ошибку сертификата раньше, чем сработает.
- GitHub Pages (https://adriaaante.github.io/NeSpat/) остаётся как запасная
  витрина; canonical смотрит на домен, дублем в поиске не станет.

## Форма заявок → Telegram
Заявки (имя + телефон) шлются ботом в группу напрямую из браузера через
Bot API `sendMessage`. Настройка: вписать `telegramBotToken` и
`telegramChatId` (у групп отрицательный) в `assets/js/config.js`.
Пока токен пуст, форма показывает подсказку и открывает
`telegramFallbackUrl`. ВАЖНО: токен в статике публичен — использовать
отдельного бота без прав администратора, только для приёма заявок.

## Медиа-исходники
Оригиналы (HEIC 4K, MOV/MP4 ~270 МБ, .cdr логотипа) лежат в Google Drive
папке 1WvpY5m2wJnRoKkbyJR1QN5crMVc5ug2o — в репо только веб-версии.
Конвертация без системных пакетов: JPEG — `https://drive.google.com/thumbnail?id=<ID>&sz=w1600`,
видео — ffmpeg из pip-пакета `imageio-ffmpeg` (HDR-видео нужен tonemap:
zscale+tonemap=hable). Превью логотипа было извлечено из .cdr (это zip,
внутри `metadata/thumbnails/`).

## Команды
- Локальный просмотр: `python3 -m http.server 8000` из корня репо.
- Поиск по базе дизайна: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<запрос>" --design-system`

## Грабли
- Обновление скиллов: `npx ui-ux-pro-max-cli` в облачной сессии блокируется —
  копировать `.claude/skills/` из клона репозитория скилла.
- Названия фото в `assets/img/` смысловые (team-, run-, portrait-, fighters-),
  маппинг на исходные IMG_XXXX не хранится — при обновлении фото просто
  класть новые под теми же именами.
