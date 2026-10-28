# Студия образовательных программ

Рабочее место методиста АЦР: слева программа, справа чат. По запросу на ИТ-курс студия собирает программу по шаблону АЦР (общеразвивающая → сертификат; повышение квалификации → удостоверение) и отдаёт DOCX / PPTX / JSON.

Быстрый прогон: [docs/REPRODUCIBILITY.md](docs/REPRODUCIBILITY.md). К защите: [docs/JURY.md](docs/JURY.md). Архитектура: [docs/architecture.md](docs/architecture.md).

## Внедрение

### Поднять

```bash
cp -n .env.example .env
# заполнить обязательные переменные (имена ниже)
docker compose up -d --build
docker compose ps
curl -sS http://localhost:8000/backend/health
```

Студия: http://localhost:8000  
Swagger: http://localhost:8000/backend/docs  
Миграции Alembic на старте `api` (`alembic upgrade head`).

Локально без Docker: `npm ci`, `pip install -r backend/requirements.txt`, `npm run backend:migrate`, затем `npm run backend` и `npm run dev` (студия на :3000).

### Обязательные env (только имена)

- `STUDIO_API_TOKEN`, `STUDIO_JWT_SECRET`
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- ключ LLM: `GIGASCHOOL_API_KEY` + `GIGASCHOOL_BASE_URL` **или** `CLOUDRU_API_KEY` + `CLOUDRU_BASE_URL`

Опционально: `CLOUDRU_MODEL` / `CLOUDRU_MODEL_WRITER`, `GATEWAY_CONCURRENCY`, `LLM_TOKEN_BUDGET`, `LOG_FORMAT` (`json` по умолчанию в Compose).

Разрешённые шлюзы: `https://hub.gigaschool.ru/api/v1/llm/v1`, `https://foundation-models.api.cloud.ru/v1`. Ключ в репозиторий не кладут. Проверка ключа: `npm run smoke:llm`.

### Сервисы и worker

Compose: `db`, `redis`, `api`, `worker`, `web`.  
**Worker обязателен:** без Celery-worker ход чата в Docker не выполняется (очередь через Redis).

### Health и логи

- Health: `GET http://localhost:8000/backend/health`
- Логи: `docker compose logs -f --tail=200 api worker web`
- Статус: `docker compose ps` — api, web и worker healthy
- Узкий E2E smoke (без UI-логина): `npm run smoke:e2e` — health → brief → audit → export. Auth stub не gate.
- Если smoke красный: `docker compose ps`, `docker compose logs --tail=100 api web`; проверьте `STUDIO_API_TOKEN` в `.env`.

### Архитектура (проверка без авторизации)

Логин/SSO не нужны — заглушки на будущее.

1. **Non-root** api/worker: `docker compose exec api id` / `worker id` — пользователь `app`, uid `10001`.
2. **JSON-логи**: `LOG_FORMAT=json`. `docker compose logs --tail=30 api` — поля `time`, `level`, `service`, `requestId` / `jobId`.
3. **Идемпотентность очереди**: `python -m pytest backend/tests/test_gateway_queue.py -k idempotent -q` — повтор `execute_chat_job` не вызывает `run_turn` дважды (`SET NX`, `acks_late`).

### Что проверяет код, а что — человек

Код валидирует часы и суммы, покрытие результатов, источники/ссылки и шаблонность. Смысл программы и применимость норм подтверждает методист.

#### Парсер запроса и валидатор ограничений часов

Парсер запроса без LLM (`backend/app/brief_guard.py`) достаёт из текста объём курса, часы аттестации, вид программы и ограничения по видам занятий («практики не менее 20 ч», «ровно 8 ч»). Опечатки правит; «месяц» и сроки часами не считает.

Валидатор (`backend/app/curriculum_rules/validator.py`) ловит противоречия ограничений и выход за общий объём за вычетом аттестации. Профили нагрузки — `curriculum_rules/profiles.py` и `workload_profiles.json`, нормативные рамки — `regulations.py`.

Тесты: `test_brief_hours_parser`, `test_hour_constraints_parser`, `test_hour_constraints_guard`, `test_allocated_hours_validator`, `test_hour_allocation`, `test_regulations`. Код отвечает за арифметику и противоречия; уместность распределения и применимость норм подтверждает методист.

## Как устроено (кратко)

Next.js UI → Python FastAPI → SQLite (локально) / PostgreSQL (Compose); LLM через `CloudRuClient` (Cloud.ru или GigaSchool). Часы, тип и коды ТФ утверждает код. Выгрузки: DOCX, PPTX, JSON с сервера. Подробнее: [docs/architecture.md](docs/architecture.md). Демо: [docs/technicka-10min.md](docs/technicka-10min.md).

## Проверки

```bash
npm test
python -m pytest backend/tests -q
npm run build
npm run smoke:e2e   # стек уже поднят
```
