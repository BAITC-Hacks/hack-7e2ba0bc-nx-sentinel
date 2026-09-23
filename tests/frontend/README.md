# Full frontend tester

Автоматический полный прогон frontend без изменения исходников проекта.

## Что проверяет

- наличие `package.json`, Node.js, npm и зависимостей;
- статический поиск потенциально захардкоженных секретов и опасных конструкций;
- `lint`, если скрипт есть;
- TypeScript (`typecheck` или `npx tsc --noEmit` при наличии `tsconfig.json`);
- `npm test`;
- production build (`npm run build`);
- browser/E2E скрипты: `test:browser`, `test:e2e`, `e2e`, `test:ui`;
- для browser/E2E автоматически запускает локальный dev-server и передаёт `FRONTEND_URL`;
- создаёт `frontend-test-report.md` и `frontend-test-report.json`.

`WARN` в статическом анализе означает «нужно просмотреть», а не доказанный баг. Потенциальные секреты считаются ошибкой.

## Запуск для вашего проекта

```bash
cd "/home/fofka/Рабочий стол/XAKATON/HACKTON/test/tests/frontend"
./run.sh
```

Или явно:

```bash
python3 run_frontend_tests.py "/home/fofka/Рабочий стол/XAKATON/HACKTON/frontend"
```

Отчёты появятся в `test/tests/frontend/reports/`.

## Код возврата

- `0` — критических ошибок не найдено (возможны WARN/SKIP);
- `1` — хотя бы одна обязательная проверка завершилась ошибкой.

## Перед первым запуском

В `frontend` должны быть установлены зависимости. Если `node_modules` отсутствует:

```bash
cd "/home/fofka/Рабочий стол/XAKATON/HACKTON/frontend"
npm ci
```
