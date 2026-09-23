# NX-Sentinel · Campaign Intelligence

Frontend существующего проекта HackAlem AI / Beeline Tariff Marketing Campaigns. Рабочий интерфейс аналитика: аудитория → исследование → пилоты → оценка → портфель кампаний. Frontend находится в `frontend/`; существующий Agent подключён через корневой FastAPI backend.

## Запуск

Установленный стек: React, TypeScript, Vite, Lucide, локальный Manrope Variable. Требуется современный Node.js с поддержкой TypeScript stripping для тестов (в рабочем окружении Node 26.8.2). Для Vite: Node 20.19+ или 22.12+; подробнее — [официальная документация](https://vite.dev/guide/).

```fish
cd "/home/fofka/Рабочий стол/XAKATON/HACKTON/frontend"
npm ci
npm run dev
```

Адрес: http://127.0.0.1:5173. Сервер привязан к localhost. `npm run build` проверяет TypeScript и создаёт `dist/`. `npm run preview` открывает локальный просмотр production-сборки.

`.npmrc` сохраняет npm-кэш в `frontend/.cache/npm`. `node_modules`, `dist`, `.cache` и `.artifacts` исключены локальным `.gitignore`. Системные пакеты не нужны.

## Что работает

- Шесть hash-маршрутов: `#/overview`, `#/agent`, `#/audience`, `#/pilots`, `#/campaigns`, `#/analytics`. Перезагрузка страницы сохраняет маршрут.
- Command center с аудиторией, остатком бюджета, количеством пилотов и кампаний.
- Единый бюджет, контакты, лимиты пилотов; отдельно отображаются известные и отсутствующие значения.
- Реальная лента событий; состояния INITIAL, DATA_READY, AGENT_RUNNING, PILOT_RUNNING, OPTIMIZING, COMPLETED и FAILED.
- Карта пилотов: наблюдаемый относительный эффект × confidence; размер точки соответствует аудитории сегмента. Без всех трёх величин точка не рисуется. Решения и confidence не рассчитываются интерфейсом.
- Кампании: поиск, сортировка, детали тарифного перехода, источники evidence, reasoning и риск — только если они предоставлены.
- Аудитория: фильтры по существующим значениям сегментов и тарифов, поиск по ID, страницы по 50 записей. Имён клиентов интерфейс не генерирует.
- Экономика каналов только из источника, без заранее выбранного «лучшего» канала.
- Адаптивный sidebar, мобильная панель деталей, управление клавиатурой, native dialog, reduced motion.
- Загрузка реальных файлов и подключение явно заданного HTTP API. Нет встроенного demo dataset, случайных графиков или вымышленных результатов.

## Подключение backend

FastAPI теперь реализован в `../backend/app/main.py`, Agent находится в `../ai/agents/agent.py`.
Запуск backend из PROJECT_ROOT: `.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`.
Vite проксирует `/api` и `/health` на порт 8000; production-сборку также обслуживает сам backend.

Connect source предзаполняет `GET /api/workspace` и `POST /api/agent/runs`.
Снимок schema_version 1 совместим с контрактом ниже. Поле capabilities сообщает, доступен ли запуск, и причину блокировки.
Upload audience data отправляет CSV/JSON до 20 MiB на `POST /api/datasets`; Import results остаётся локальным импортом результатов.
Точный контракт upload и официальной среды: [../docs/api.md](../docs/api.md).

Официальная среда/evaluator и данные отсутствуют; API не создаёт фиктивные пилоты.
Чтобы выполнять Agent, владелец backend подключает реальную среду через NX_ENV_FACTORY.
При отсутствии среды доступны загрузка и просмотр аудитории; причина недоступности Run Agent показана в интерфейсе.

Polling: 3 секунды во время запуска, 15 секунд в остальное время, timeout GET/POST запуска — 15 секунд.
Сессии изолированы HttpOnly cookie при работе через один origin. Произвольный cross-origin источник по-прежнему работает без credentials;
для штатного локального backend используйте proxy. При ошибке предыдущие данные сохраняются.

## Контракт снимка

Полные типы и проверка входных данных: [`src/services/data.ts`](src/services/data.ts). Это контракт отображения frontend, а не утверждение о формате официального evaluator. Backend заполняет его данными адаптера реальной среды.

Корень — JSON object. Обязательны `schema_version: 1` и `state` из списка состояний выше. Любое отсутствующее optional поле показывается как «не предоставлено»; оно не становится нулём. Явный пустой массив означает, что источник передал пустую коллекцию.

| Поле                              | Тип / смысл                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_id`, `updated_at`            | Идентификатор запуска и ISO timestamp источника                                                                |
| `summary`, `next_action`, `error` | Фактическое описание/следующее действие/ошибка из источника                                                    |
| `audience_total`                  | Целое неотрицательное количество абонентов                                                                     |
| `budget`                          | `total`, `exploration_spent`, `campaigns_allocated`, `remaining`, необязательный `currency`                    |
| `contacts`, `pilot_limit`         | `total`, `used`, `remaining`; целые неотрицательные значения                                                   |
| `audience[]`                      | Обязательный строковый `id`; optional `current_tariff`, `arpu`, `arpu_segment`, `data_segment`, `call_segment` |
| `campaigns[]`                     | Обязательные `target_tariff`, `channel`; остальные поля ниже                                                   |
| `pilots[]`                        | Поля кампании + фактические наблюдения ниже                                                                    |
| `events[]`                        | `id`, `title`, `status`, optional `description`, `timestamp`, `cost`, `contacts`                               |
| `channels[]`                      | `id`, optional `name`, `cost`, `effectiveness`                                                                 |
| `tariffs[]`                       | `id`, optional `name`, `price`, `data_gb`, `minutes`, `sms`                                                    |

Optional поля кампании: `id`, `name`, `targeting`, `audience_size`, `estimated_cost`, `expected_impact`, `confidence`, `reasoning`, `risk`, `evidence_ids`. Если название/ID не передано, используется технический номер строки, без выдуманного бизнес-названия. `targeting` содержит optional `current_tariff`, `arpu_segment`, `data_segment`, `call_segment`.

`expected_impact` — абсолютный ожидаемый чистый результат в единицах бюджета. `confidence` — фактическая оценка источника от 0 до 1. Если методика не даёт confidence, поле следует пропустить. Интерфейс не подменяет uncertainty значением `1 - confidence`.

Поля пилота: `sample_size`, `cost`, `observed_effect` (относительная величина, 0.1 означает 10%), `uncertainty`, `timestamp`, `status`. Поддерживаемые решения: `selected`, `promoted`, `rejected`, `uncertain`, `testing`, `needs_more_data`. Никакая классификация пилота не придумывается на клиенте.

Статусы события: `pending`, `running`, `completed`, `warning`, `rejected`, `selected`. Порядок событий сохраняется из источника. ID внутри каждой коллекции должны быть уникальны. Недопустимые типы, NaN, Infinity, отрицательные счётчики, ошибочные timestamps отклоняются.

## Импорт файлов

- JSON: snapshot описанного выше формата; до 20 MB.
- CSV: реальные результаты с обязательными `target_tariff`, `channel`. Optional: `filter_current_tariff`, `filter_arpu_segment`, `filter_data_segment`, `filter_call_segment`.
- CSV parser поддерживает BOM, CRLF, quoted commas, escaped quotes и переносы внутри quoted fields.
- Исходный CSV хранится в памяти и экспортируется без изменения колонок и содержимого. Другие поля CSV не интерпретируются как экономика без известного контракта.
- Для JSON предлагается экспорт JSON, а не самодельный submission.csv.
- Импорт CSV не утверждает, что запуск завершён, не проверяет валидность тарифов/лимитов без среды и не создаёт pilot history.
- Import results не отправляет файлы на сервер. Upload audience data отправляет отдельный набор в локальную backend-сессию. При ошибке предыдущие данные сохраняются.

## Проверки

```fish
npm test
npm run build
# Однократная установка браузера только внутри frontend:
env PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" TMPDIR="$PWD/.cache/tmp" ./node_modules/.bin/playwright install chromium --only-shell
# В другом терминале уже должен работать npm run dev:
npm run test:browser
# Дополнительно при запущенном backend: HTTP + upload + session isolation
npm run test:api
```

Тесты проверяют валидацию, корректность отсутствующих значений, CSV, URL, маршруты, ошибочный источник, сохранение данных после ошибки, agent states, мобильные диалоги, горизонтальный overflow и WCAG 2 AA через axe. Бизнес-сущности для тестов не выдумываются: используются пустые и намеренно ошибочные входы.

Снимки для 1920, 2560, 1366, 1024 и 390 px и отчёт accessibility сохраняются в `.artifacts/`. HTTP API проверен отдельно; без официальных данных и env нельзя подтвердить полный проход реальных кампаний по правилам evaluator. Интерфейс не имитирует эти результаты.
