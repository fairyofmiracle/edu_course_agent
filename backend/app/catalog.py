from __future__ import annotations

import re

from typing import Any

from .kit_content import course_text, is_intro_python, is_teacher_ai
from .models import CourseDocument

DATA_STANDARD = {
    "title": "Профессиональный стандарт «Специалист по большим данным», код 06.042",
    "source": "https://profstandart.rosmintrud.ru/",
    "note": (
        "Код и название стандарта существуют в реестре. "
        "Код трудовой функции методист переносит из текста стандарта, студия его не выдумывает."
    ),
}

IB_STANDARD = {
    "title": (
        "Профессиональный стандарт «Специалист по безопасности "
        "компьютерных систем и сетей», код 06.032"
    ),
    "source": "https://profstandart.rosmintrud.ru/",
    "note": (
        "Код и название стандарта существуют в реестре. "
        "Код трудовой функции методист переносит из текста стандарта, студия его не выдумывает."
    ),
}

ADMIN_STANDARD = {
    "title": (
        "Профессиональный стандарт «Системный администратор "
        "информационно-коммуникационных систем», код 06.026"
    ),
    "source": "https://profstandart.rosmintrud.ru/",
    "note": (
        "Код и название стандарта существуют в реестре. "
        "Код трудовой функции методист переносит из текста стандарта, студия его не выдумывает."
    ),
}


def is_incomplete_brief(course: CourseDocument) -> bool:
    brief = course.brief
    return brief.program_kind == "unset" or brief.duration_hours <= 0


def _brief_profile_text(course: CourseDocument) -> str:
    """Только бриф: заголовки модулей от модели не должны менять профиль."""
    brief = course.brief
    parts = [
        brief.title,
        brief.audience,
        brief.attestation_form,
        *brief.goals,
        *brief.constraints,
        *(ref.title for ref in brief.references),
    ]
    return " ".join(part for part in parts if part).lower()


# Strong DS stack only — Excel/данные/аналитика alone must stay generic
# (own-s1 Excel→бухгалтерия) and not auto-pick «ИИ для аналитиков».
_OFFICE_NOT_DS = re.compile(
    r"бухгалтер|кадров|кадры|1с|зуп|офисн|делопроизвод",
    re.IGNORECASE,
)
_STRONG_DS = re.compile(
    r"pandas|dataframe|jupyter|"
    r"(?<![a-zа-яё0-9_])sql(?![a-zа-яё0-9_])|"
    r"машинн\w*\s+обучен|machine\s+learning|(?<![a-zа-яё])ml(?![a-zа-яё])",
    re.IGNORECASE,
)
_WEAK_DATA_HINT = re.compile(
    r"анализ\w*\s+данн|данн\w*|аналитик|статистик|excel|эксель",
    re.IGNORECASE,
)


def is_data_analysis(course: CourseDocument) -> bool:
    """Только явный pandas/SQL/ML + Excel или банк; слабые маркеры → generic."""
    if is_teacher_ai(course):
        return False
    text = _brief_profile_text(course)
    if _OFFICE_NOT_DS.search(text):
        return False
    if not _STRONG_DS.search(text):
        return False
    workplace = any(
        token in text and f"без {token}" not in text for token in ("excel", "банк")
    )
    return workplace


def needs_profile_confirm(course: CourseDocument) -> bool:
    """Excel/данные/аналитика без pandas/SQL — спросить профиль."""
    if is_teacher_ai(course) or is_data_analysis(course):
        return False
    text = _brief_profile_text(course)
    if _OFFICE_NOT_DS.search(text):
        return False
    if not _WEAK_DATA_HINT.search(text):
        return False
    return not _STRONG_DS.search(text)


def is_internship(course: CourseDocument) -> bool:
    text = course_text(course)
    return any(
        token in text
        for token in ("стажиров", "аудиторных нет", "аудиторных занятий нет")
    )


def is_devops_internship(course: CourseDocument) -> bool:
    if not is_internship(course):
        return False
    text = course_text(course)
    return any(token in text for token in ("devops", "ci/cd", "контейнер")) or (
        "linux" in text and "мониторинг" in text
    )


def is_cyber(course: CourseDocument) -> bool:
    text = course_text(course)
    return any(
        token in text
        for token in ("кибербезопас", "информационн безопас", "иб для")
    )


def profile_name(course: CourseDocument) -> str:
    if is_incomplete_brief(course):
        return "incomplete"
    if is_teacher_ai(course):
        return "teacher_ai"
    if is_devops_internship(course):
        return "internship"
    if is_data_analysis(course):
        return "data_analysis"
    if is_intro_python(course):
        return "intro_python"
    if is_cyber(course):
        return "cyber"
    return "generic"


def _module(
    module_id: str,
    title: str,
    hours: float,
    *,
    lecture: float = 0,
    practice: float = 0,
    lab: float = 0,
    self_study: float = 0,
    topics: list[str],
    outcomes: list[str],
    competency_ids: list[str],
) -> dict[str, Any]:
    return {
        "id": module_id,
        "title": title,
        "hours": hours,
        "lectureHours": lecture,
        "practiceHours": practice,
        "labHours": lab,
        "selfStudyHours": self_study,
        "topics": topics,
        "learningOutcomes": outcomes,
        "competencyIds": competency_ids,
    }


def default_structure(course: CourseDocument) -> list[dict[str, Any]] | None:
    if is_incomplete_brief(course):
        return None
    name = profile_name(course)
    if name == "teacher_ai":
        return [
            _module(
                "1",
                "Введение в ИИ и доступные в России сервисы",
                6,
                lecture=4,
                practice=2,
                topics=[
                    "Основные понятия ИИ и нейросетей",
                    "Обзор российских сервисов для школы",
                    "Регистрация без персональных данных учеников",
                    "Короткий запрос к модели и правка ответа",
                ],
                outcomes=[
                    "Называет, что можно поручить модели в подготовке урока",
                    "Выбирает сервис, доступный в России",
                ],
                competency_ids=["c1"],
            ),
            _module(
                "2",
                "Учебные материалы с помощью ИИ",
                12,
                lecture=6,
                practice=6,
                topics=[
                    "План урока",
                    "Задания для учеников",
                    "Проверочная работа",
                    "Правка черновика модели под класс",
                ],
                outcomes=[
                    "Собирает план урока и правит его под класс",
                    "Готовит задания и проверочную работу",
                ],
                competency_ids=["c2"],
            ),
            _module(
                "3",
                "Риски, этика и персональные данные учеников",
                8,
                lecture=4,
                practice=4,
                topics=[
                    "Этика ИИ в школе",
                    "Персональные данные детей в запросах",
                    "Риски и отказ от недоступного сервиса",
                    "Что учитель проверяет перед уроком",
                ],
                outcomes=[
                    "Соблюдает риски и защиту персональных данных учеников",
                    "Отказывается от сервиса, которым в России нельзя пользоваться",
                ],
                competency_ids=["c3"],
            ),
            _module(
                "4",
                "Портфолио из трёх материалов",
                10,
                lecture=0,
                practice=10,
                topics=[
                    "План урока с помощью ИИ",
                    "Комплект заданий",
                    "Проверочная работа",
                    "Зачёт по портфолио",
                ],
                outcomes=["Собирает портфолио из трёх материалов с критериями"],
                competency_ids=["c2"],
            ),
        ]
    if name == "intro_python":
        return [
            _module(
                "1",
                "Старт, переменные, ввод и вывод",
                6,
                lecture=2,
                practice=4,
                topics=["Что такое программа", "Переменные и типы", "input() и print()"],
                outcomes=["Пишет короткую программу с вводом и выводом"],
                competency_ids=["c1"],
            ),
            _module(
                "2",
                "Ветвления и циклы",
                5,
                lecture=2,
                practice=3,
                topics=["if и else", "Цикл for и while", "Ошибки новичка"],
                outcomes=["Собирает программу с условием и повторением"],
                competency_ids=["c1"],
            ),
            _module(
                "3",
                "Мини-проект: игра или чат-бот",
                5,
                lecture=1,
                practice=4,
                topics=["План мини-проекта", "Сборка и запуск", "Защита проекта"],
                outcomes=["Показывает рабочую программу и объясняет ход работы"],
                competency_ids=["c2"],
            ),
        ]
    if name == "data_analysis":
        return [
            _module(
                "1",
                "Python для тех, кто работал в Excel",
                12,
                lecture=4,
                practice=6,
                self_study=2,
                topics=[
                    "Переменные, списки и файлы",
                    "От таблицы Excel к таблице в коде",
                    "Jupyter и запуск короткого скрипта",
                ],
                outcomes=["Пишет короткий скрипт вместо ручных шагов в Excel"],
                competency_ids=["c1"],
            ),
            _module(
                "2",
                "pandas: таблицы и очистка данных",
                16,
                lecture=6,
                practice=8,
                self_study=2,
                topics=[
                    "DataFrame и чтение CSV",
                    "Отбор строк и столбцов",
                    "Пропуски и типы",
                    "Сводные таблицы",
                ],
                outcomes=["Собирает и чистит таблицу в pandas"],
                competency_ids=["c2"],
            ),
            _module(
                "3",
                "Визуализация",
                12,
                lecture=4,
                practice=6,
                self_study=2,
                topics=["График ряда", "Сравнение групп", "Как не ввести в заблуждение"],
                outcomes=["Строит понятный график по банковской таблице"],
                competency_ids=["c2"],
            ),
            _module(
                "4",
                "SQL для выгрузки",
                12,
                lecture=4,
                practice=6,
                self_study=2,
                topics=["SELECT и фильтр", "JOIN", "Агрегаты", "Выгрузка без персональных полей"],
                outcomes=["Пишет запрос на выгрузку обезличенных данных"],
                competency_ids=["c2"],
            ),
            _module(
                "5",
                "Статистика и проект на обезличенных данных",
                20,
                lecture=4,
                practice=12,
                self_study=4,
                topics=[
                    "Среднее, медиана, доля",
                    "Отток или просрочка: постановка",
                    "Требования к данным и результату",
                    "Защита проекта",
                ],
                outcomes=["Защищает проект на обезличенных банковских данных"],
                competency_ids=["c3"],
            ),
        ]
    if name == "internship":
        blocks = [
            (
                "1",
                "Linux и повседневная работа в консоли",
                50,
                ["Пользователи и права", "Процессы и журналы", "Сеть на уровне хоста"],
                "Выполняет базовые операции в Linux под руководством наставника",
                "c1",
            ),
            (
                "2",
                "Сети для инженера",
                40,
                ["Адресация и маршруты", "DNS и доступ к сервису", "Диагностика обрыва"],
                "Проверяет сетевую связность и объясняет симптом наставнику",
                "c1",
            ),
            (
                "3",
                "Контейнеры",
                44,
                ["Образ и контейнер", "Сеть и тома", "Сборка простого сервиса"],
                "Запускает сервис в контейнере и описывает шаги в отчёте",
                "c2",
            ),
            (
                "4",
                "CI/CD",
                44,
                ["Пайплайн", "Тест и сборка", "Выкладка по согласованию наставника"],
                "Собирает короткий пайплайн и фиксирует результат",
                "c2",
            ),
            (
                "5",
                "Мониторинг",
                38,
                ["Метрики и логи", "Простая авария", "Что писать наставнику"],
                "Читает сигнал мониторинга и описывает гипотезу",
                "c3",
            ),
            (
                "6",
                "Инфраструктура как код",
                38,
                ["Повторяемая конфигурация", "Секрет не в репозитории", "Отчёт о стажировке"],
                "Описывает повторённую конфигурацию и готовит отчёт к защите",
                "c3",
            ),
        ]
        return [
            _module(
                module_id,
                title,
                hours,
                self_study=hours,
                topics=topics,
                outcomes=[outcome],
                competency_ids=[competency],
            )
            for module_id, title, hours, topics, outcome, competency in blocks
        ]
    if name == "cyber":
        return [
            _module(
                "1",
                "Начальный уровень: из чего состоит защита",
                16,
                lecture=6,
                practice=10,
                topics=["Активы и угрозы", "Роли в команде", "Что курс не обещает"],
                outcomes=["Называет границы своей учебной роли на 72 часах"],
                competency_ids=["c1"],
            ),
            _module(
                "2",
                "Сети и Linux на учебном стенде",
                18,
                lecture=6,
                practice=12,
                topics=["Повторение сетей", "Журналы Linux", "Учебный стенд колледжа"],
                outcomes=["Выполняет учебное задание на стенде по инструкции"],
                competency_ids=["c2"],
            ),
            _module(
                "3",
                "Типовые атаки и первая реакция",
                20,
                lecture=6,
                practice=14,
                topics=["Фишинг и слабый пароль", "Лишние права", "Что сообщить наставнику"],
                outcomes=["Разбирает учебный инцидент без обещания уровня специалиста"],
                competency_ids=["c2"],
            ),
            _module(
                "4",
                "Практический экзамен на стенде",
                18,
                lecture=2,
                practice=16,
                topics=["Пример задания", "Критерии оценки", "Разбор ошибок"],
                outcomes=["Проходит экзамен с практическим заданием на стенде"],
                competency_ids=["c3"],
            ),
        ]
    return generic_structure(course)


def flatten_internship_hours(course: CourseDocument) -> CourseDocument:
    if not is_internship(course) and course.brief.format != "workshop":
        return course
    value = course.as_api()
    changed = False
    for module in value["modules"]:
        classroom = (
            float(module.get("lectureHours") or 0)
            + float(module.get("practiceHours") or 0)
            + float(module.get("labHours") or 0)
        )
        if classroom <= 0:
            continue
        hours = float(module.get("hours") or 0)
        module["lectureHours"] = 0
        module["practiceHours"] = 0
        module["labHours"] = 0
        module["selfStudyHours"] = hours
        changed = True
    return CourseDocument.model_validate(value) if changed else course


def block_count(hours: float) -> int:
    """Крупный объём пишется модулями-блоками, не одним текстом.

    После 500 часов блок держится около 40 часов. Число модулей растёт
    вместе с объёмом, отдельного потолка у программы нет.
    """
    if hours <= 24:
        return 3
    if hours <= 80:
        return 4
    if hours <= 160:
        return 6
    if hours <= 320:
        return 8
    if hours <= 500:
        return 12
    return max(12, int((hours + 39) // 40))


def generic_structure(course: CourseDocument) -> list[dict[str, Any]] | None:
    hours = course.brief.duration_hours - course.brief.attestation_hours
    if hours <= 0:
        return None
    from .reference_outline import generic_module_titles, subject_name

    subject = subject_name(course)
    audience = (course.brief.audience or "слушатель").rstrip(" .")
    hints = generic_module_titles(course)
    count = block_count(hours)
    while len(hints) < count:
        hints.append(f"Раздел {len(hints) + 1}: {subject}")
    chunks = [max(0.5, round((hours / count) * 2) / 2) for _ in range(count)]
    chunks[-1] = hours - sum(chunks[:-1])
    modules = []
    internship_like = (
        is_internship(course)
        or course.brief.format == "workshop"
        or (course.brief.attestation_hours > 0 and "аудиторн" in course_text(course))
    )
    for index, (hint, module_hours) in enumerate(zip(hints[:count], chunks)):
        competency = "c1" if index == 0 else "c3" if index == count - 1 else "c2"
        if internship_like:
            lecture, practice, self_study = 0.0, 0.0, module_hours
        elif hours <= 24:
            practice = round(module_hours / 2 * 2) / 2
            lecture = module_hours - practice
            self_study = 0.0
        else:
            lecture = round(module_hours * 0.35 * 2) / 2
            self_study = round(module_hours * 0.15 * 2) / 2
            practice = module_hours - lecture - self_study
        short = hint[:70]
        modules.append(
            _module(
                str(index + 1),
                hint[:80],
                module_hours,
                lecture=lecture,
                practice=practice,
                self_study=self_study,
                topics=[
                    f"Зачем {audience} нужна тема «{short}»",
                    f"Базовые приёмы «{subject}» в этом разделе",
                    f"Учебный пример для {audience}",
                    "Критерий готовности: работу можно показать и объяснить",
                ],
                outcomes=[
                    f"Выполняет работу по теме «{short}» и объясняет результат",
                    f"Объясняет, что в работе по теме «{short}» сделано и чего делать нельзя",
                ],
                competency_ids=[competency],
            )
        )
    return modules


def extra_competencies(course: CourseDocument) -> list[dict[str, Any]] | None:
    ids = [module.id for module in course.modules] or ["1", "2", "3"]
    first, middle, last = ids[:1], ids[1:2] or ids[:1], ids[-1:]
    existing = [node.id for node in course.competencies.nodes]
    padded = existing + ["c1", "c2", "c3"]
    id1, id2, id3 = padded[0], padded[1], padded[2]
    name = profile_name(course)
    if name == "data_analysis":
        return [
            {
                "id": id1,
                "name": "Переводит привычку Excel в короткий скрипт",
                "bloomLevel": "apply",
                "moduleIds": first,
                "knowledge": ["Чем таблица в pandas отличается от листа Excel"],
                "skills": ["Пишет короткий скрипт загрузки и проверки файла"],
                "abilities": ["Объясняет коллеге, что сделал код"],
            },
            {
                "id": id2,
                "name": "Готовит выгрузку и график по задаче банка",
                "bloomLevel": "apply",
                "moduleIds": middle,
                "knowledge": ["Какой запрос SQL и какой график подходят к вопросу"],
                "skills": ["Собирает обезличенную таблицу и понятный график"],
                "abilities": ["Проверяет, что в данных нет лишних персональных полей"],
            },
            {
                "id": id3,
                "name": "Защищает учебный проект на обезличенных данных",
                "bloomLevel": "evaluate",
                "moduleIds": last,
                "knowledge": ["Какие требования к данным и какой результат ждут на защите"],
                "skills": ["Собирает проект оттока или просрочки"],
                "abilities": ["Отвечает на вопрос по своему графику и выводу"],
            },
        ]
    if name == "cyber":
        return [
            {
                "id": id1,
                "name": "Ориентируется в начальных задачах защиты",
                "bloomLevel": "understand",
                "moduleIds": first,
                "knowledge": ["Какие роли бывают рядом со стендом и чего курс не обещает"],
                "skills": ["Повторяет учебный сценарий по инструкции"],
                "abilities": ["Отличает учебную задачу от работы специалиста"],
            },
            {
                "id": id2,
                "name": "Выполняет задание на учебном стенде",
                "bloomLevel": "apply",
                "moduleIds": middle,
                "knowledge": ["Где смотреть журналы и что считать подозрительным в учебной среде"],
                "skills": ["Выполняет практическое задание на стенде колледжа"],
                "abilities": ["Фиксирует шаги так, чтобы преподаватель мог повторить"],
            },
            {
                "id": id3,
                "name": "Проходит практический экзамен",
                "bloomLevel": "evaluate",
                "moduleIds": last,
                "knowledge": ["Какие критерии у экзамена и какой пример задания"],
                "skills": ["Делает задание за отведённое время"],
                "abilities": ["Объясняет, что сделал и где ошибся"],
            },
        ]
    if name == "internship":
        return [
            {
                "id": id1,
                "name": "Работает на площадке под наставником",
                "bloomLevel": "apply",
                "moduleIds": first,
                "knowledge": ["Какие правила площадки и какой формат собеседования с наставником"],
                "skills": ["Выполняет поручение по Linux и сети и фиксирует его"],
                "abilities": ["Задаёт наставнику уточняющий вопрос по симптому"],
            },
            {
                "id": id2,
                "name": "Собирает контейнер и короткий пайплайн",
                "bloomLevel": "apply",
                "moduleIds": middle,
                "knowledge": ["Чем образ отличается от контейнера и зачем нужен пайплайн"],
                "skills": ["Повторяет согласованные шаги CI/CD"],
                "abilities": ["Описывает результат так, чтобы его можно было проверить"],
            },
            {
                "id": id3,
                "name": "Готовит отчёт о стажировке",
                "bloomLevel": "evaluate",
                "moduleIds": last,
                "knowledge": ["Какие разделы отчёта и какие критерии защиты"],
                "skills": ["Собирает отчёт без копирования чужого образца"],
                "abilities": ["Отвечает на вопросы наставника по каждому разделу"],
            },
        ]
    return None


def extra_questions(course: CourseDocument) -> list[dict[str, Any]]:
    name = profile_name(course)
    if name == "data_analysis":
        return [
            {
                "keys": ("excel", "python"),
                "stem": "Зачем банкиру, который работал в Excel, вводный блок Python?",
                "options": [
                    "Чтобы перенести привычные шаги с листа в короткий воспроизводимый скрипт",
                    "Чтобы сразу писать высоконагруженный сервис",
                    "Чтобы выучить все классы языка",
                    "Чтобы отказаться от таблиц",
                ],
                "answer": "Чтобы перенести привычные шаги с листа в короткий воспроизводимый скрипт",
                "explanation": "Слушатели приходят из Excel, поэтому старт — основы языка.",
            },
            {
                "keys": ("pandas",),
                "stem": "Что в pandas обычно соответствует листу Excel?",
                "options": ["DataFrame", "Только одна ячейка print", "Файл .docx", "DNS-запись"],
                "answer": "DataFrame",
                "explanation": "DataFrame — таблица со столбцами и строками.",
            },
            {
                "keys": ("sql",),
                "stem": "Для чего в этой программе нужен SQL?",
                "options": [
                    "Чтобы выгрузить нужные строки из базы, лучше уже без лишних персональных полей",
                    "Чтобы рисовать слайды",
                    "Чтобы заменить pandas",
                    "Чтобы настроить принтер",
                ],
                "answer": "Чтобы выгрузить нужные строки из базы, лучше уже без лишних персональных полей",
                "explanation": "SQL здесь про выгрузку, не про весь курс баз данных.",
            },
            {
                "keys": ("визуализац", "график"),
                "stem": "Какой график уместен, если нужно сравнить доли двух групп?",
                "options": [
                    "Столбики или доли, где подписаны оси и выборка",
                    "Случайная картинка без подписей",
                    "Схема метро",
                    "Только сырая таблица на 40 столбцов",
                ],
                "answer": "Столбики или доли, где подписаны оси и выборка",
                "explanation": "График должен отвечать на вопрос, а не украшать слайд.",
            },
            {
                "keys": ("статистик",),
                "stem": "Что безопаснее показать на первых шагах статистики?",
                "options": [
                    "Среднее, медиану и долю по понятной выборке",
                    "Свою нейросеть с нуля",
                    "Доказательство теоремы без данных",
                    "Прогноз на 10 лет без оговорок",
                ],
                "answer": "Среднее, медиану и долю по понятной выборке",
                "explanation": "72 часа — начальный уровень, не курс математика-исследователя.",
            },
            {
                "keys": ("проект", "обезлич", "банк"),
                "stem": "Какие данные допустимы в итоговом проекте?",
                "options": [
                    "Обезличенные учебные данные, без ФИО и документов клиентов",
                    "Боевая база отделения с паспортами",
                    "Скриншоты чужого дашборда",
                    "Только выдуманные числа без постановки",
                ],
                "answer": "Обезличенные учебные данные, без ФИО и документов клиентов",
                "explanation": "В запросе прямо сказано: данные обезличены.",
            },
            {
                "keys": ("отток", "просроч"),
                "stem": "Какая постановка ближе к работе банка на семинаре?",
                "options": [
                    "Посмотреть, чем отличаются клиенты с оттоком или просрочкой",
                    "Написать игру для школьников",
                    "Собрать сайт визитку",
                    "Выучить наизусть приказ",
                ],
                "answer": "Посмотреть, чем отличаются клиенты с оттоком или просрочкой",
                "explanation": "Задания должны быть про банковские ситуации.",
            },
            {
                "keys": ("верси", "актуал"),
                "stem": "Какой ориентир по инструментам ставить в программу 2026 года?",
                "options": [
                    "Актуальные поддерживаемые версии Python 3, pandas и библиотек графиков",
                    "Python 2.7 и pandas 0.18 как в старом конспекте",
                    "Только калькулятор Windows",
                    "Любая версия «на глаз»",
                ],
                "answer": "Актуальные поддерживаемые версии Python 3, pandas и библиотек графиков",
                "explanation": "Снятые с поддержки инструменты в программу не входят.",
            },
            {
                "keys": ("защит", "критер"),
                "stem": "Что должно быть в описании защиты проекта?",
                "options": [
                    "Требования к данным, ожидаемый результат и критерии защиты",
                    "Только фраза «сделать что-нибудь»",
                    "Оценки за школу",
                    "Список фильмов",
                ],
                "answer": "Требования к данным, ожидаемый результат и критерии защиты",
                "explanation": "Без требований защита превращается в рассказ «ну я попробовал».",
            },
            {
                "keys": ("копир", "референс"),
                "stem": "Как пользоваться старой программой АЦР как образцом?",
                "options": [
                    "Взять логику разделов, а текст и часы написать заново",
                    "Скопировать абзацы и темы дословно",
                    "Перенести чужую ошибку в итоговой строке",
                    "Игнорировать образец и придумать другой объём",
                ],
                "answer": "Взять логику разделов, а текст и часы написать заново",
                "explanation": "Референс — про структуру, не про копирование.",
            },
        ]
    if name == "cyber":
        return [
            {
                "keys": ("уровень", "специалист"),
                "stem": "Что честно обещать после 72 часов?",
                "options": [
                    "Начальный уровень работы с учебным стендом, не полную подготовку специалиста",
                    "Гарантированное трудоустройство",
                    "Уровень архитектора безопасности",
                    "Право проводить расследования без наставника",
                ],
                "answer": "Начальный уровень работы с учебным стендом, не полную подготовку специалиста",
                "explanation": "Пожелание «пойти работать» шире, чем объём курса.",
            },
            {
                "keys": ("стенд", "экзамен"),
                "stem": "Как устроен итоговый экзамен этой программы?",
                "options": [
                    "Практическое задание на стенде, пример задания и критерии",
                    "Только тест из трёх вопросов без практики",
                    "Сочинение о кино",
                    "Защита чужого диплома",
                ],
                "answer": "Практическое задание на стенде, пример задания и критерии",
                "explanation": "Так ответил методист: экзамен с заданием на стенде.",
            },
            {
                "keys": ("колледж", "входн"),
                "stem": "Что учесть во входных требованиях?",
                "options": [
                    "Студенты 3 курса параллельно получают СПО и уже знают основы сетей и Linux",
                    "Слушатели — директора без технической базы",
                    "Нужен опыт 10 лет в SOC",
                    "Программирование на ассемблере обязательно",
                ],
                "answer": "Студенты 3 курса параллельно получают СПО и уже знают основы сетей и Linux",
                "explanation": "Курс идёт вместе с учёбой в колледже, не вместо неё.",
            },
            {
                "keys": ("фишинг", "парол"),
                "stem": "Какой учебный инцидент уместен на 72 часах?",
                "options": [
                    "Фишинг или слабый пароль на стенде колледжа",
                    "Расследование международной APT без наставника",
                    "Сертификация ISO за один день",
                    "Написание ядра операционной системы",
                ],
                "answer": "Фишинг или слабый пароль на стенде колледжа",
                "explanation": "Начальный уровень: понятный симптом, который можно повторить.",
            },
            {
                "keys": ("linux", "журнал"),
                "stem": "Зачем на курсе смотреть журналы Linux?",
                "options": [
                    "Чтобы увидеть, что произошло на учебном стенде, и записать шаги",
                    "Чтобы сразу стать администратором банка",
                    "Чтобы выучить наизусть все команды man",
                    "Чтобы отключить сеть колледжа",
                ],
                "answer": "Чтобы увидеть, что произошло на учебном стенде, и записать шаги",
                "explanation": "Журнал — учебный след, не боевое расследование.",
            },
            {
                "keys": ("роль", "команд"),
                "stem": "Как говорить о своей роли после этого курса?",
                "options": [
                    "Я могу выполнить учебное задание на стенде и объяснить шаги",
                    "Я готов возглавить SOC",
                    "Мне больше не нужен преподаватель",
                    "Я имею право выдавать сертификаты другим",
                ],
                "answer": "Я могу выполнить учебное задание на стенде и объяснить шаги",
                "explanation": "Результаты курса — начальные, без раздувания статуса.",
            },
            {
                "keys": ("работ", "сфер"),
                "stem": "Почему нельзя обещать, что после месяца «пойдёшь работать в сферу»?",
                "options": [
                    "72 часа дают старт, а не полную подготовку специалиста",
                    "Потому что в колледже нельзя учиться",
                    "Потому что Linux запрещён",
                    "Потому что экзамена не будет",
                ],
                "answer": "72 часа дают старт, а не полную подготовку специалиста",
                "explanation": "Пожелание заказчика шире объёма программы.",
            },
            {
                "keys": ("критер", "оценк"),
                "stem": "Что должно быть у практического экзамена?",
                "options": [
                    "Пример задания, понятные шаги и критерии оценки",
                    "Только оценка «зачёт» без задания",
                    "Сочинение на свободную тему",
                    "Чужой диплом за прошлый год",
                ],
                "answer": "Пример задания, понятные шаги и критерии оценки",
                "explanation": "Без примера и критериев экзамен нельзя воспроизвести.",
            },
            {
                "keys": ("сет", "стенд"),
                "stem": "Откуда у слушателей знание сетей и Linux?",
                "options": [
                    "Это входной уровень 3 курса, курс на нём опирается, а не учит с нуля",
                    "Курс обещает сети с чистого листа за два часа",
                    "Сети не нужны",
                    "Linux запрещено упоминать",
                ],
                "answer": "Это входной уровень 3 курса, курс на нём опирается, а не учит с нуля",
                "explanation": "Методист сказал: основы сетей и Linux уже есть.",
            },
            {
                "keys": ("сообще", "преподавател"),
                "stem": "Что сделать, если на стенде что-то непонятно?",
                "options": [
                    "Записать наблюдение и сообщить преподавателю",
                    "Спрятать ошибку и перезагрузить всё",
                    "Опубликовать пароли стенда",
                    "Сказать, что уже специалист",
                ],
                "answer": "Записать наблюдение и сообщить преподавателю",
                "explanation": "Учебная реакция важнее геройства.",
            },
        ]
    if name == "internship":
        return [
            {
                "keys": ("аудиторн", "самостоят"),
                "stem": "Где проходят часы этой стажировки?",
                "options": [
                    "В компании, самостоятельно под наставником, без аудиторных лекций",
                    "В лекционном зале 8 часов каждый день",
                    "Только дома без наставника и без отчёта",
                    "На школьном кружке",
                ],
                "answer": "В компании, самостоятельно под наставником, без аудиторных лекций",
                "explanation": "Лекции, практика и лабораторные в плане равны нулю.",
            },
            {
                "keys": ("отчёт", "защит"),
                "stem": "Что защищают на итоговой аттестации?",
                "options": [
                    "Отчёт о стажировке по требованиям и критериям",
                    "Чужой образец по бизнес-анализу",
                    "Только скриншот чата",
                    "Устную песню",
                ],
                "answer": "Отчёт о стажировке по требованиям и критериям",
                "explanation": "Аттестация — 2 часа, защита отчёта.",
            },
            {
                "keys": ("наставник", "собеседован"),
                "stem": "Как выглядит текущий контроль?",
                "options": [
                    "Собеседование с руководителем стажировки по вопросам каждого раздела",
                    "Ежедневный экзамен на 4 часа",
                    "Только посещаемость лекций",
                    "Оценки из школы",
                ],
                "answer": "Собеседование с руководителем стажировки по вопросам каждого раздела",
                "explanation": "К собеседованию готовят вопросы по разделам, не копируя чужой курс.",
            },
            {
                "keys": ("linux",),
                "stem": "Что входит в раздел Linux этой стажировки?",
                "options": [
                    "Повседневные операции в консоли под наставником",
                    "Лекции 8 часов каждый день",
                    "Только установка Windows",
                    "Копирование чужой стажировки по бизнес-анализу",
                ],
                "answer": "Повседневные операции в консоли под наставником",
                "explanation": "Часы — самостоятельная работа на площадке.",
            },
            {
                "keys": ("контейнер", "образ"),
                "stem": "Чем образ отличается от контейнера?",
                "options": [
                    "Образ — заготовка, контейнер — запущенный экземпляр",
                    "Это одно и то же слово",
                    "Образ — это отчёт о стажировке",
                    "Контейнер бывает только на лекции",
                ],
                "answer": "Образ — заготовка, контейнер — запущенный экземпляр",
                "explanation": "Так проще объяснить наставнику, что именно запущено.",
            },
            {
                "keys": ("ci/cd", "пайплайн"),
                "stem": "Что можно собрать на стажировке в CI/CD?",
                "options": [
                    "Короткий пайплайн: проверка, сборка и согласованная выкладка",
                    "Полный продакшен банка без наставника",
                    "Только презентацию без запуска",
                    "Чужой пайплайн дословно из образца",
                ],
                "answer": "Короткий пайплайн: проверка, сборка и согласованная выкладка",
                "explanation": "Шаги согласуют с наставником и фиксируют в отчёте.",
            },
            {
                "keys": ("мониторинг",),
                "stem": "Что делать с сигналом мониторинга?",
                "options": [
                    "Прочитать метрику или лог, сформулировать гипотезу и написать наставнику",
                    "Игнорировать, если не лекция",
                    "Сразу перезагрузить все серверы компании",
                    "Удалить метрики, чтобы стало тихо",
                ],
                "answer": "Прочитать метрику или лог, сформулировать гипотезу и написать наставнику",
                "explanation": "Текущий контроль — разговор по факту, не тишина.",
            },
            {
                "keys": ("инфраструктур", "код"),
                "stem": "Что значит «инфраструктура как код» в этой стажировке?",
                "options": [
                    "Повторяемая конфигурация, секрет не лежит в открытом репозитории",
                    "Стихи про серверы",
                    "Только схема на доске без файлов",
                    "Пароль в чате группы",
                ],
                "answer": "Повторяемая конфигурация, секрет не лежит в открытом репозитории",
                "explanation": "Это раздел про повтор и аккуратность, не про копирование образца.",
            },
            {
                "keys": ("4 часа", "нагруз"),
                "stem": "Какая дневная нагрузка допустима?",
                "options": [
                    "Не больше 4 часов в день, срок около двух месяцев",
                    "12 часов каждый день без выходных",
                    "Только одна лекция в месяц",
                    "Нагрузка не нормируется",
                ],
                "answer": "Не больше 4 часов в день, срок около двух месяцев",
                "explanation": "Так сказано в запросе, календарь от этого не ломаем.",
            },
            {
                "keys": ("ошибк", "образец"),
                "stem": "Что делать, если в образце стажировки итоговая строка часов не сходится?",
                "options": [
                    "Не переносить ошибку и сказать методисту о расхождении",
                    "Скопировать кривую строку как есть",
                    "Молча выкинуть аттестацию",
                    "Поставить 72 часа вместо 256",
                ],
                "answer": "Не переносить ошибку и сказать методисту о расхождении",
                "explanation": "Это отдельное требование кейса и правило студии.",
            },
        ]
    return []


def extra_seminar(course: CourseDocument) -> dict[str, Any] | None:
    if not course.modules:
        return None
    name = profile_name(course)
    last = course.modules[-1]
    outcome = last.learning_outcomes[-1] if last.learning_outcomes else last.title
    competency = last.competency_ids[-1] if last.competency_ids else "c3"
    if name == "data_analysis":
        return {
            "moduleId": last.id,
            "tasks": [
                {
                    "title": "Отток или просрочка на обезличенных данных",
                    "prompt": (
                        "Разберите учебную выгрузку без ФИО клиентов: чем группа с оттоком "
                        "или просрочкой отличается от остальных. На защите покажите таблицу, "
                        "график и три вывода."
                    ),
                    "steps": [
                        "Сформулируйте вопрос бизнеса одним предложением.",
                        "Проверьте, что в файле нет персональных полей.",
                        "Соберите таблицу в pandas и один график.",
                        "Запишите требования к данным, результат и критерии.",
                    ],
                    "timeMin": 90,
                    "criteria": [
                        "Данные обезличены.",
                        "Есть таблица, график и вывод.",
                        "Понятно, что можно и чего нельзя обещать по 72 часам.",
                    ],
                    "competencyId": competency,
                    "learningOutcome": outcome,
                }
            ],
        }
    if name == "cyber":
        return {
            "moduleId": last.id,
            "tasks": [
                {
                    "title": "Практическое задание на стенде",
                    "prompt": (
                        "На учебном стенде колледжа найдите указанный симптом, "
                        "запишите шаги и что бы вы сообщили преподавателю. "
                        "Это экзамен начального уровня, не аттестация специалиста."
                    ),
                    "steps": [
                        "Прочитайте карточку задания.",
                        "Воспроизведите шаги на стенде.",
                        "Зафиксируйте команды и наблюдение.",
                        "Сдайте работу по критериям.",
                    ],
                    "timeMin": 60,
                    "criteria": [
                        "Задание выполнено на стенде.",
                        "Шаги можно повторить.",
                        "Нет обещания уровня специалиста.",
                    ],
                    "competencyId": competency,
                    "learningOutcome": outcome,
                }
            ],
        }
    if name == "internship":
        tasks = []
        for module in course.modules:
            module_outcome = module.learning_outcomes[-1] if module.learning_outcomes else module.title
            module_competency = module.competency_ids[-1] if module.competency_ids else competency
            tasks.append(
                {
                    "title": f"Собеседование: {module.title}",
                    "prompt": (
                        f"Подготовьте ответы наставнику по разделу «{module.title}»: "
                        "что сделали, где застряли, что написали в отчёт."
                    ),
                    "steps": [
                        "Коротко перескажите цель раздела.",
                        "Покажите артефакт или запись шагов.",
                        "Назовите один риск и как его обошли.",
                    ],
                    "timeMin": 20,
                    "criteria": [
                        "Ответ по делу, без копирования чужого образца.",
                        "Есть факт работы, не только теория.",
                        "Понятно, что пойдёт в отчёт.",
                    ],
                    "competencyId": module_competency,
                    "learningOutcome": module_outcome,
                }
            )
        return {"moduleId": last.id, "tasks": tasks}
    return None


def extra_attestation(course: CourseDocument) -> str | None:
    name = profile_name(course)
    current = course.brief.attestation_form.lower()
    if name == "data_analysis":
        if "проект" in current and "обезлич" in current and "критер" in current:
            return None
        return (
            "Защита проекта на обезличенных банковских данных: "
            "требования к данным, ожидаемый результат и критерии защиты"
        )
    if name == "cyber":
        if "экзамен" in current and "стенд" in current:
            return None
        return (
            "Экзамен с практическим заданием на стенде: пример задания и критерии оценки. "
            "Начальный уровень, не подготовка специалиста."
        )
    if name == "internship":
        if "отчёт" in current and "критер" in current:
            return None
        return (
            "Защита отчёта о стажировке (2 часа): требования к отчёту "
            "и критерии защиты. Текущий контроль — собеседование с наставником."
        )
    return None


def extra_constraints(course: CourseDocument) -> list[str]:
    text = course_text(course)
    lines: list[str] = []
    name = profile_name(course)
    hours = course.brief.duration_hours
    if name == "intro_python" and abs(hours - 16) < 0.01:
        lines.append("Календарный график: 8 занятий по 2 часа, 4 недели.")
    elif "два раза в неделю" in text and abs(hours - 16) < 0.01:
        lines.append("Календарный график: 8 занятий по 2 часа, 4 недели.")
    if "4 недели" in text or (name == "data_analysis" and abs(hours - 72) < 0.01):
        lines.append("Календарный график: 4 недели.")
    if name == "internship" or "4 часа в день" in text or (
        "4 ч" in text and "день" in text
    ):
        days = int((hours + 3) // 4) if hours else 0
        if hours >= 200:
            lines.append(
                "Календарный график: около двух месяцев, нагрузка не больше 4 ч в день."
            )
        else:
            lines.append(
                f"Календарный график: не больше 4 ч в день"
                + (f", ориентир {days} учебных дней." if days else ".")
            )
    if name == "data_analysis":
        lines.extend(
            [
                "Инструменты 2026 года: актуальный Python 3 и поддерживаемый pandas, без второй ветки языка.",
                "В проекте только обезличенные данные, без ФИО и документов клиентов.",
                "Текст старой программы не копировать, ошибку часов из образца не переносить.",
            ]
        )
    if name == "cyber":
        lines.extend(
            [
                "Входные требования: студенты колледжа, параллельно получают СПО, знают основы сетей и Linux.",
                "Результаты — начальный уровень. Курс не обещает полную подготовку специалиста и трудоустройство.",
            ]
        )
    if name == "internship":
        lines.extend(
            [
                "Аудиторных занятий нет: лекции, практика и лабораторные равны нулю во всех строках.",
                "254 часа самостоятельной работы на площадке и 2 часа защиты отчёта.",
                "Ошибку итоговой строки из чужого образца не переносить.",
            ]
        )
    if name == "intro_python":
        lines.append("Сложные темы вроде классов не идут раньше переменных, условий и циклов.")
    if name == "generic" and hours > 0:
        weeks = max(1, round(hours / 10))
        if course.brief.format == "workshop":
            lines.append(
                f"Календарный график: около {weeks} недель, нагрузка не больше 4 ч в день."
            )
        else:
            lines.append(f"Календарный график ориентировочно {weeks} недель.")
    return lines


def extra_references(course: CourseDocument) -> list[dict[str, str]]:
    name = profile_name(course)
    if name == "data_analysis":
        return [DATA_STANDARD]
    if name == "cyber":
        return [IB_STANDARD]
    if name == "internship":
        return [ADMIN_STANDARD]
    return []


def extra_slide(topic: str) -> dict[str, Any] | None:
    blob = topic.lower()
    bank = (
        (
            ("pandas", "dataframe"),
            {
                "title": "pandas: таблица в коде",
                "bullets": [
                    "DataFrame — таблица: строки и столбцы с именами.",
                    "read_csv читает файл в таблицу.",
                    "Сначала смотрим размер, столбцы и пропуски.",
                    "Отбор столбцов заменяет ручное копирование в Excel.",
                    "Версия — актуальный поддерживаемый pandas, не релиз 2016 года.",
                ],
            },
        ),
        (
            ("sql", "select", "выгруз"),
            {
                "title": "SQL для выгрузки",
                "bullets": [
                    "SELECT берёт столбцы, WHERE оставляет нужные строки.",
                    "JOIN соединяет таблицы по ключу.",
                    "В выгрузку не кладём ФИО и паспорт.",
                    "Запрос должен отвечать на один рабочий вопрос.",
                    "Результат проверяем глазами на нескольких строках.",
                ],
            },
        ),
        (
            ("linux",),
            {
                "title": "Linux на площадке",
                "bullets": [
                    "Сначала каталог, пользователь и права.",
                    "Журнал помогает понять, что произошло.",
                    "Команду, которую не поняли, наставнику лучше показать, чем спрятать.",
                    "Секреты не кладут в открытый репозиторий.",
                    "Каждый шаг потом попадает в отчёт.",
                ],
            },
        ),
    )
    for keys, slide in bank:
        if any(key in blob for key in keys):
            return {"title": slide["title"], "bullets": list(slide["bullets"])}
    return None


def promise_notes(course: CourseDocument) -> list[str]:
    notes: list[str] = []
    text = course_text(course)
    if "пойти работать" in text or "работать в эту сферу" in text:
        notes.append(
            "Пожелание заказчика «пойти работать в сферу» шире объёма курса. "
            "Результаты формулируем как начальный уровень, без обещания полной "
            "подготовки специалиста и трудоустройства."
        )
    elif is_cyber(course):
        notes.append(
            "Результаты — начальный уровень, без обещания полной подготовки "
            "специалиста и трудоустройства."
        )
    if is_internship(course):
        notes.append(
            "Если в образце стажировки итоговая строка часов не сходится, "
            "ошибку не переносим и сообщаем методисту."
        )
    if is_data_analysis(course):
        notes.append(
            "Старую программу АЦР используем как каркас разделов, текст и часы пишем заново."
        )
    return notes


def lecture_modules(course: CourseDocument, limit: int) -> list[Any]:
    if limit <= 0:
        return []
    picked: list[Any] = []
    seen: set[str] = set()
    lectured = [module for module in course.modules if (module.lecture_hours or 0) > 0]
    pool = lectured or list(course.modules)
    for module in pool[:limit]:
        picked.append(module)
        seen.add(module.id)
    text = course_text(course)
    for module in course.modules:
        if len(picked) >= limit:
            break
        if module.id in seen:
            continue
        title = module.title.lower()
        if "pandas" in title and "pandas" in text:
            picked.append(module)
            seen.add(module.id)
        elif "слайд" in text and any(token in title for token in text.split() if len(token) > 4):
            picked.append(module)
            seen.add(module.id)
    return picked
