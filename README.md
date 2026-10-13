# Студия образовательных программ

Веб-агент для методиста. Слева запрос и файлы, справа документ программы. Ноутбук `notebooks/solution.ipynb` повторяет тот же порядок шагов и читает материалы кейса.

## Запуск

```bash
cd edu-course-agent
cp .env.example .env.local
```

Модель курса — [Foundation Models в Cloud.ru Evolution](https://cloud.ru/docs/foundation-models/ug/topics/api-ref). В `.env.local` нужен API-ключ из личного кабинета:

```
CLOUDRU_API_KEY=...
CLOUDRU_BASE_URL=https://foundation-models.api.cloud.ru/v1
CLOUDRU_MODEL=t-tech/T-pro-it-2.0
```

Агент сначала собирает каркас: компетенции и учебный план, сумма часов равна объёму. Кнопка «Утвердить каркас» открывает тесты, задания и лекции. Источники агент берёт только из текста методиста и не выдумывает приказы и профстандарты.

Слайды по желанию озвучивает [SaluteSpeech](https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/voices), голос Наталья (`Nec_24000`). Ключ этого проекта отдельный:

```
SALUTE_CREDENTIALS=...
SALUTE_SCOPE=SALUTE_SPEECH_PERS
SALUTE_VOICE=Nec_24000
```

Другие голоса: `May_24000` Марфа, `Ost_24000` Александра, `Bys_24000` Борис, `Tur_24000` Тарас, `Pon_24000` Сергей. Кнопка «Озвучить» на слайде читает заголовок, тезисы и заметки лектора.

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000). Кнопка «Пример 24 ч» показывает заполненную студию без модели.

Материалы кейса лежат отдельной папкой `materials/`. У каждого документа два файла: исходный `.docx` и текст `.txt`.

- `program-general-24h` — интенсив, 24 часа
- `program-qualification-248h` — стажировка, 248 часов
- `open-cases` — пять открытых запросов и чек-листы

Ноутбук запускается из папки `notebooks` обычным Python, без дополнительных пакетов:

```bash
cd notebooks
jupyter notebook solution.ipynb
```

## Holix

Чат студии ходит в Cloud.ru Evolution. Holix подключается к репозиторию как помощник: при запуске из этой папки он читает `.holix/HOLIX.md` и навык `.holix/skills/edu-methodist`. Кнопку проверки и правки живого курса в интерфейсе добавим после ТЗ.
