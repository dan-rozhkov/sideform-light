---
name: auto
description: "Автопилот для sideform-light: задача в отдельном worktree → брейншторм/план → субагенты (Sonnet) → /code-review → фикс → lint/test/build → commit+push в main → скриншоты → отчёт в Notion. Используй для /auto или просьбы выполнить задачу по workflow auto."
argument-hint: <что нужно сделать> [notion:<URL страницы для обновления>]
---

Ты выполняешь задачу **`$ARGUMENTS`** в автопилот-режиме по фиксированному воркфлоу этого репозитория. Работай до конца без остановок на подтверждение (полный автопилот), но соблюдай гейты качества ниже.

Просьба установить или изменить этот скилл не запускает его workflow.

## Контекст репозитория

- `sideform-light/` — **один** git-репо (`origin` = `github.com/dan-rozhkov/sideform-light`, ветка `main`). Внутри два npm-пакета со своими `package-lock.json` и `node_modules`:
  - `app/` — Electron-оболочка (CommonJS, Playwright `_electron` e2e). Читай `app/CLAUDE.md`.
  - `ui/` — панель агента, страница трейса, настройки (Vite + React). Читай `ui/CLAUDE.md`.
  - `CONTRACT.md` — контракт `app` ↔ `ui` ↔ бэкенд. Меняешь протокол `app://`, формы `penAgentPanel`/`penDesktop`, эндпоинты или `clientCapabilities` — сначала прочитай его и обнови в том же коммите.
- Бэкенд — `pen-editor-backend` из соседнего проекта: `/Users/daniilrozhkov/prj/pen-editor-app/pen-editor-backend` (свой репо и свой `main`; режим `agentMode: "browser"` живёт в `src/ai/`). Схемы тулов — там, хэндлеры — в `ui/src/lib/toolRegistry.ts` и `ui/src/lib/tools/`. Если задача меняет тул-контракт, задеты **оба** репо, и **бэкенд пушится первым**.
- В основном чекауте может работать другая сессия Клода. Вся работа идёт в отдельном worktree, основные чекауты ты не трогаешь.

## Шаги

### 0. Worktree
Придумай короткий `<slug>` (латиница, kebab-case). Worktree кладём **рядом** с репо, не внутри (иначе eslint/vitest основного чекаута подхватят копию):

```bash
R=/Users/daniilrozhkov/prj/sideform-light
W=/Users/daniilrozhkov/prj/wt-auto-<slug>
git -C $R fetch origin
git -C $R worktree add -b auto/<slug> $W/sideform-light origin/main
# только если задет бэкенд:
B=/Users/daniilrozhkov/prj/pen-editor-app/pen-editor-backend
git -C $B fetch origin
git -C $B worktree add -b auto/light-<slug> $W/pen-editor-backend origin/main
```

- `node_modules` для `app/` и `ui/` отдельно: если `package-lock.json` в worktree совпадает с основным чекаутом (`cmp`), — симлинк `ln -s $R/<pkg>/node_modules $W/sideform-light/<pkg>/node_modules`; иначе `npm ci` в `$W/sideform-light/<pkg>`. Для бэкенда — так же относительно `$B`.
- `npm run dist` в `app/` с симлинком `node_modules` **запрещён**: electron-builder теряет транзитивные зависимости, приложение падает при запуске (хук `afterPack` отклонит сборку). Перед `dist`: `rm $W/sideform-light/app/node_modules`, затем `npm ci`. **Никогда** не запускай `npm ci` при живом симлинке — он пройдёт по ссылке и сотрёт `node_modules` основного чекаута.
- Все команды, правки, субагенты, ревью — только с путями внутри `$W`. Bash сбрасывает cwd, поэтому пиши абсолютные пути или `git -C`.

### 1. Брейншторм / план
Если в задаче есть хоть капля неоднозначности в требованиях или дизайне — сначала `superpowers:brainstorming`, затем при необходимости `superpowers:writing-plans`. Для механических/точечных правок можно пропустить, кратко назвав план.

### 2. Делегируй субагентам на Sonnet
- Реализацию отдавай через `Agent` **с `model: "sonnet"`**, `subagent_type: "general-purpose"` (или `Explore`/`Plan` где уместно).
- Независимые куски — параллельно (несколько `Agent` в одном сообщении), зависимые — последовательно. Параллельным субагентам давай **непересекающиеся** файлы. Типичный раздел: `app/` и `ui/` — разные агенты, если контракт между ними уже зафиксирован в `CONTRACT.md`.
- В промпте субагенту: абсолютный путь worktree и запрет трогать `$R` и `$B`; точный скоуп и файлы; какие `CLAUDE.md` прочитать; команды проверок из шага 5 дословно; что вернуть (список изменений + результаты проверок **с числом файлов/тестов**). Субагенты **не** делают git-операций — коммит и пуш только ты.

### 3. Ревью через /code-review
После сборки изменений вызови `Skill` `code-review` (эффорт: `medium` для точечных, `high` для крупных). Явно передай цель: путь worktree и `git -C $W/sideform-light diff origin/main` (и бэкенд отдельно, если задет). Если в шапке отчёта не тот репо или коммит — выбрось отчёт и перезапусти.

### 4. Почини находки
Реальные замечания почини (сам или новым Sonnet-субагентом). Ложные отсеивай, не чини вслепую (`superpowers:receiving-code-review`). Повтори ревью, если правки существенные.

### 5. Верификация перед коммитом
Каждую проверку — **отдельной командой**, вывод в файл, явный код возврата (пайп `| tail` прячет красный код). `$SCRATCH` — scratchpad-директория сессии.

`ui/` (если задет; `ui` собирай всегда, если задет `app` и ты собираешь `app` без `SIDEFORM_LIGHT_SKIP_UI`):
```bash
cd $W/sideform-light/ui && npm run lint > $SCRATCH/ui-lint.txt 2>&1; echo "ui-lint=$?"
cd $W/sideform-light/ui && NODE_OPTIONS=--no-experimental-webstorage npx vitest run > $SCRATCH/ui-test.txt 2>&1; echo "ui-test=$?"
cd $W/sideform-light/ui && npm run build > $SCRATCH/ui-build.txt 2>&1; echo "ui-build=$?"
```

`app/` (если задет):
```bash
cd $W/sideform-light/app && npm run lint > $SCRATCH/app-lint.txt 2>&1; echo "app-lint=$?"
cd $W/sideform-light/app && npm test > $SCRATCH/app-test.txt 2>&1; echo "app-test=$?"
cd $W/sideform-light/app && npm run build > $SCRATCH/app-build.txt 2>&1; echo "app-build=$?"   # нужен собранный ../ui/dist; иначе SIDEFORM_LIGHT_SKIP_UI=1, как в CI
cd $W/sideform-light/app && npm run test:e2e > $SCRATCH/app-e2e.txt 2>&1; echo "app-e2e=$?"  # если задет src/ оболочки
```

Бэкенд (если задет): `npm run lint`, `npm test`, `npm run build` в `$W/pen-editor-backend` по тем же правилам.

- **Никогда** `npm test -- run`: это фильтр по имени, он гоняет пару файлов и выглядит зелёным. Сверяй число файлов/тестов с логом.
- e2e не ходит в сеть (stub ui, `SIDEFORM_LIGHT_NO_ADBLOCK=1` ставит сам конфиг) и работает в один воркер. Если трогаешь Electron-оболочку, держи правила из `app/CLAUDE.md` про `waitForShellViews` и `app.evaluate`.
- Live-проверка с реальным бэкендом и `ui/dist` — ручная (`npm start`), в автопилоте не обязательна.

Не заявляй «готово», пока не увидел зелёный вывод (`superpowers:verification-before-completion`). Красное — назад к шагу 4.

### 6. Commit + push в main (делаешь ты, основной агент)
- `git -C $W/sideform-light status --short`, стейджи **перечислением путей**, никогда `-A`/`.`. Не коммить одноразовые спеки/конфиги для скриншотов.
- Осмысленное commit-сообщение в стиле репо (`feat(ui): …`, `fix(app): …`, `docs: …`), заканчивающееся строкой:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `git fetch origin`, затем `git rebase origin/main` **отдельной командой**. Проверь код возврата и что `git status` не показывает «rebasing». Если main сдвинулся — снова шаг 5.
- Пуш: `git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main`. Без force push.
- Задет тул-контракт — сначала то же самое в бэкенде (`HEAD:main` в его `origin`), потом sideform-light.
- После пуша посмотри CI: `gh run list -R dan-rozhkov/sideform-light -b main -L 1`, при желании `gh run watch`. Красный CI — назад к шагу 4.
- Релиз (тег `v*`, `npm version`) — **только** если пользователь явно попросил.

### 7. Скриншоты
Отчёт получает **только запушенный** код — сначала шаг 6, потом этот шаг. PNG в `$SCRATCH/auto-<slug>/`, имена `NN-<что-на-снимке>.png`.

- **Изменение в `ui/`** (панель агента, трейс, настройки): одноразовый Playwright-скрипт (Chromium), который сам поднимает Vite из worktree на своём порту: `npx vite --port 5199 --strictPort` (не 5174 — там может быть чужой dev-сервер). Застабь `window.penAgentPanel` / `window.penDesktop` через `page.addInitScript` и бэкенд `/api/*` (`http://localhost:3001`) через `page.route`. Открывай `/agent`, `/trace/<id>?src=local`, `/settings?section=…`.
- **Изменение оболочки `app/`** (табы, адресная строка, Passwords, History, раскладка): одноразовая спека в `app/e2e/` на `launchShell` из `e2e/launch.ts` со stub ui (или с `SIDEFORM_LIGHT_UI_URL` на Vite из worktree), `SIDEFORM_LIGHT_NO_ANIMATIONS=1`; снимай `page.screenshot` нужных view. Для общей раскладки есть `AGENT_LAYOUT_SHOT=<png> npx playwright test e2e/agent-layout.spec.ts`. Спеку не коммить, удали после съёмки.
- Сними основной вид и каждое новое состояние (пустое, загрузка, ошибка), тёмную тему, узкое окно — что применимо.
- Открой каждый PNG через `Read` и убедись, что на нём то, что нужно, а не белый экран или страница ошибки.
- **Без UI** (CI, сборка, бэкенд): вставь в отчёт результат проверок блоком кода или отрисуй его в HTML и сними Playwright'ом, если картинка что-то добавляет.

### 8. Страница в Notion
Одна страница на задачу. Повторный `/auto` по той же задаче **обновляет** её.

1. Найди страницу: URL из `notion:<URL>`; иначе `notion-search` по `auto-slug: sideform-light/<slug>` и по названию задачи. Нашёл — `notion-fetch` и обновляй. Нет — создавай.
2. Залей каждый PNG: `notion-create-file-upload` с `filename`, затем **один** multipart POST на `upload_url` со всеми `upload_headers` (`curl -sS -X POST "$URL" -H '...' -F "file=@<png>"`). Сеть заблокирована песочницей — используй штатный механизм разрешений. Из ответа бери `suggested_markdown`. Загрузка живёт около часа — вставляй сразу.
3. Содержимое (Notion-markdown, сначала прочитай `notion://docs/enhanced-markdown-spec`):
   - первая строка: одно-два предложения, что сделано; затем `Код в main:` репо + short SHA каждого коммита; условия снимков (размер окна, тема, стабы);
   - секции `##` по смыслу, в каждой — картинки с подписью, что на снимке;
   - `## Что изменилось` — маркированный список для человека, не для разработчика;
   - `## Проверки` — lint/test/build/e2e по `ui`, `app` (и бэкенду) с числом тестов, статус CI;
   - последняя строка серым: `auto-slug: sideform-light/<slug>`.
4. Создание: `notion-create-pages` с `creation_mode: "draft"` (приватная страница), иконка-эмодзи, заголовок `Sideform Light: <Задача> (DD.MM.YYYY)`. Обновление: `notion-update-page` — секция `## Обновление DD.MM.YYYY` через `insert_content`, первая строка и SHA через `update_content`. Старые снимки без причины не удаляй.

Нет инструментов Notion — сохрани Markdown-отчёт и PNG в `$SCRATCH/auto-<slug>/`, сообщи, что публикация заблокирована и чего не хватает.

### 9. Уборка и итог
- Удали симлинки `node_modules`, затем `git -C $R worktree remove $W/sideform-light`, `git -C $R branch -D auto/<slug>` (только если её коммиты уже в `origin/main`); то же для бэкенда через `$B`; удали пустую `$W`. Грязный worktree или незапушенные коммиты не удаляй — сообщи почему.
- Итог в чат кратко: что сделано, какие репо запушены (short SHA), статус CI, ссылка на страницу Notion (и что она приватная), что осталось/отложено. Если всплыло важное для памяти проекта — предложи записать.

## Правила
- Заблокирован (нужен доступ/решение пользователя, задача расходится с фактами кода) — **остановись и спроси**, не выдумывай обход.
- Не снижай пороги тестов/линта ради зелёного прохода. Не выключай e2e и тесты контракта (`test/ipcContract.test.ts`, `localProtocol.test.ts`), а обновляй их вместе с кодом.
- Не давай субагентам делать `git stash/reset/checkout`, не трогай основные чекауты `$R` и `$B` и чужие `wt-*`.
- Безопасность оболочки (пароли, preload-free вкладки браузера, CSP `app://`) — правила из `app/CLAUDE.md` обязательны; нарушение — баг, даже если фича работает.
