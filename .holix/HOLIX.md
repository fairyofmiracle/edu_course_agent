# Студия образовательных программ

Holix читает этот файл на каждом ходе. Это справочник репозитория `edu-course-agent`.

Продуктовая встройка помощника в интерфейс студии ждёт ТЗ. До него не подменяй чат студии gateway Holix и не переноси генерацию курса из `src/app/api/chat`.

## Что это

Веб-студия для методиста: чат слева собирает бриф, справа живой комплект курса — структура, карта компетенций, тесты, семинары, слайды. Кнопка «Пример 24 ч» показывает заполненную студию без модели.

## Стек

- Next.js 16, React 19, TypeScript
- Vercel AI SDK (`streamText`, tools) — агент курса
- Cloud.ru Evolution Foundation Models (`CLOUDRU_API_KEY` в `.env`)
- Zod-схема документа, mermaid на слайдах, unpdf для PDF-референсов

## Команды

```bash
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

## Где что лежит

| Путь | Зачем |
|------|--------|
| `src/app/api/chat/route.ts` | Ход методиста: промпт, tools, стрим |
| `src/lib/agent/prompts.ts` | Методика backward design |
| `src/lib/agent/tools.ts` | Патчи документа: brief, competencies, structure, lecture, seminar, assessment |
| `src/lib/agent/model.ts` | Клиент Cloud.ru Evolution |
| `src/lib/framework-check.ts` | Часы, связи компетенций, утверждение каркаса |
| `src/lib/course-schema.ts` | Форма курса |
| `src/lib/course-patches.ts` | Как tool-вызовы складываются в документ |
| `src/lib/storage.ts` | Курс и сообщения только в `localStorage` браузера |
| `src/components/Studio.tsx` | Чат + правая панель |
| `src/app/api/extract/route.ts` | Текст из URL или PDF |

## Как помогать

Навык `.holix/skills/edu-methodist/SKILL.md` — правила комплекта. Для правок кода держись этих файлов и не ломай контракт tools: студия применяет их на клиенте.

Курс не лежит на диске. Пока нет серверного JSON, Holix не видит документ из браузера. Читать и менять код студии можно. Менять живой курс методиста — только после ТЗ (файл курса, кнопка проверки, MCP к тем же патчам).
