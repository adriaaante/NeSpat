# NeSpat

## Что это
Новый проект, кода ещё нет — репозиторий начат с установки набора скиллов
UI/UX Pro Max (v2.11.0, https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).

## Структура проекта
- `.claude/skills/` — 7 проектных скиллов пакета UI/UX Pro Max (не редактировать
  руками — файлы поставляются апстримом, обновлять целиком из релиза):
  - `ui-ux-pro-max/` — оркестратор: поисковая база стилей, палитр, шрифтов,
    UX-правил (`scripts/search.py`, данные в `data/*.csv`)
  - `design/`, `design-system/`, `ui-styling/`, `brand/`, `banner-design/`,
    `slides/` — под-скиллы

## Команды
- Поиск по базе дизайна: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<запрос>" --design-system`
  (нужен только Python 3, stdlib; выводит рекомендованный дизайн-набор)

## Грабли
- Обновление скиллов: апстрим рекомендует CLI `npx ui-ux-pro-max-cli init --ai claude`,
  но в облачной сессии npx может быть заблокирован — тогда копировать
  `.claude/skills/` из клона репозитория скилла (там лежат те же готовые файлы).
