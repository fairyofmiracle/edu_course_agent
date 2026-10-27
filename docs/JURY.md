# Для проверяющих (5 минут)

Краткая шпаргалка к защите «Методий» / студии образовательных программ АЦР.
Полный прогон: [REPRODUCIBILITY.md](./REPRODUCIBILITY.md). Обзор продукта: [../README.md](../README.md).

## Что смотреть

| Что | Где |
| --- | --- |
| UI | http://127.0.0.1:3000 (локальный Next) или http://localhost:8000 (Docker web) |
| API health | http://127.0.0.1:8010/health → `status: ok`, `llmHost`, `exports` |
| LLM | `hub.gigaschool.ru` или Cloud.ru Foundation Models — без `api.openai.com` |
| Экспорты | json, docx, pptx, zip, moodle, gift, csv, html |

Локальный контур защиты: **Next :3000 ↔ FastAPI :8010**. Docker web :8000 не обязателен, если эти два порта отвечают.

## Быстрый сценарий в UI

1. **Новый курс** → бриф (тип ПК/ОД, часы, аудитория, форма, аттестация).
2. Дождаться **каркаса** → проверить сумму часов и компетенции.
3. **Утвердить каркас** → **Собрать комплект** (лекции / задания / тесты).
4. Вкладка **Проверка**: часы, покрытие результатов, источники; при устаревшем стеке — «Обновить устаревшее» и блок сроков поддержки.
5. Вкладка **О программе**: кнопки **Объём 16/36/72 ч** и **Другая аудитория** — адаптация сверх ТЗ.
6. В модуле: **Пересобрать материалы модуля** — точечная доработка.
7. **Выгрузить**: DOCX (шаблон АЦР), PPTX, ZIP (+ audit.json), LMS (Moodle/GIFT/CSV).

## Smoke без UI

```bash
curl -s http://127.0.0.1:8010/health
# ожидаем exports с moodle/gift/csv и llmConfigured true

curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
# 200
```

Тесты (без ключа LLM):

```bash
python -m pytest backend/tests/test_export_files.py backend/tests/test_kit_content.py backend/tests/test_health.py -q
npx vitest run src/lib/agent/turn.test.ts src/lib/outdated.test.ts
```

## Не путать

- **Офлайн-пример** — готовая витрина, не E2E генерации.
- Ключ в чат и в git не кладут; только `.env`.
- Push на origin для демо не требуется, если локальный live уже поднят.
