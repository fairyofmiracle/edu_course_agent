# Студия образовательных программ

Веб-агент для методиста: чат слева собирает бриф, справа появляется комплект курса — структура, карта компетенций, тесты, семинары и слайды лекций.

## Запуск

```bash
cd edu-course-agent
cp .env.example .env.local
```

Модель и голос — российские сервисы Сбера.

Текст курса собирает [GigaChat](https://developers.sber.ru/docs/ru/gigachat/individuals-quickstart). В `.env.local` нужен ключ авторизации из личного кабинета, не короткий токен доступа: студия сама меняет ключ на токен.

```
GIGACHAT_CREDENTIALS=...
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_MODEL=GigaChat
```

Для ИП и юрлиц смените `GIGACHAT_SCOPE` на `GIGACHAT_API_B2B` или `GIGACHAT_API_CORP`.

Слайды озвучивает [SaluteSpeech](https://developers.sber.ru/docs/ru/salutespeech/guides/synthesis/voices), голос Наталья (`Nec_24000`). Ключ этого проекта отдельный:

```
SALUTE_CREDENTIALS=...
SALUTE_SCOPE=SALUTE_SPEECH_PERS
SALUTE_VOICE=Nec_24000
```

Другие голоса: `May_24000` Марфа, `Ost_24000` Александра, `Bys_24000` Борис, `Tur_24000` Тарас, `Pon_24000` Сергей. Кнопка «Озвучить» на слайде читает заголовок, тезисы и заметки лектора.

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000). Кнопка «Пример 24 ч» показывает заполненную студию без модели. Экспорт: разметка, данные и слайды.
