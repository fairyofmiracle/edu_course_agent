from __future__ import annotations

import re
from typing import Any

from .models import CourseDocument, CourseModule

STUB_QUESTION = re.compile(r"^Что верно про тему")
STUB_BULLET = re.compile(r"Практика по теме|Проверка понимания")
STUB_COMPETENCY = re.compile(r"^(Осваивает |Знает: |Умеет применить: |Владеет: )")


def course_text(course: CourseDocument) -> str:
    parts = [
        course.brief.title,
        course.brief.audience,
        course.brief.attestation_form,
        *course.brief.goals,
        *(module.title for module in course.modules),
        *(topic for module in course.modules for topic in module.topics),
    ]
    return " ".join(part for part in parts if part).lower()


def is_teacher_ai(course: CourseDocument) -> bool:
    text = course_text(course)
    teacher = any(token in text for token in ("учител", "педагог"))
    ai = any(
        token in text
        for token in ("нейросет", "искусственн", "gigachat", "yandexgpt", "ии в работе")
    )
    return teacher and ai


def is_intro_python(course: CourseDocument) -> bool:
    if is_teacher_ai(course):
        return False
    text = course_text(course)
    return "python" in text and any(
        token in text for token in ("школ", "8 и 9", "8–9", "подрост")
    )


def mentions_project(course: CourseDocument) -> bool:
    text = course_text(course)
    return any(token in text for token in ("проект", "чат-бот", "чатбот", "игр"))


PEDAGOGUE_STANDARD = {
    "title": (
        "Приказ Минтруда России от 18.10.2013 № 544н "
        "«Об утверждении профессионального стандарта „Педагог“»"
    ),
    "source": "https://www.consultant.ru/document/cons_doc_LAW_155553/",
    "note": "Приложен к запросу. Коды трудовых функций перенесены из этого стандарта.",
}


def is_stub_competency_node(node: dict[str, Any]) -> bool:
    name = str(node.get("name") or "")
    knowledge = node.get("knowledge") or []
    if name.startswith("Осваивает ") or name in {"Решает учебные задачи по теме", "Представляет результат работы"}:
        return True
    first = str(knowledge[0]) if knowledge else ""
    return bool(first.startswith("Знает: ") and name and name in first)


def has_stub_competencies(course: CourseDocument) -> bool:
    nodes = course.competencies.nodes
    if not nodes:
        return True
    return all(
        is_stub_competency_node(node.model_dump(by_alias=True)) for node in nodes
    )


def has_stub_questions(course: CourseDocument) -> bool:
    questions = [question for item in course.assessments for question in item.questions]
    if not questions:
        return True
    return any(STUB_QUESTION.search(question.stem) for question in questions)


def has_stub_lectures(course: CourseDocument) -> bool:
    if not course.lectures:
        return True
    return any(
        STUB_BULLET.search(" ".join(slide.bullets))
        for lecture in course.lectures
        for slide in lecture.slides
    )


def _extra_competencies(course: CourseDocument) -> list[dict[str, Any]] | None:
    from .catalog import extra_competencies

    return extra_competencies(course)


def _catalog_bank(course: CourseDocument) -> list[dict[str, Any]]:
    from .catalog import extra_questions

    return extra_questions(course)


def _module_ids(course: CourseDocument) -> list[str]:
    return [module.id for module in course.modules]


def default_competencies(course: CourseDocument) -> list[dict[str, Any]]:
    ids = _module_ids(course)
    first = ids[:1]
    middle = ids[1:2] or first
    last = ids[-1:] if ids else []
    project = last or middle
    existing = [node.id for node in course.competencies.nodes]
    padded = existing + ["c1", "c2", "c3"]
    id1, id2, id3 = padded[0], padded[1], padded[2]
    if is_teacher_ai(course):
        return [
            {
                "id": id1,
                "name": "Готовит план урока с помощью ИИ",
                "bloomLevel": "apply",
                "moduleIds": first,
                "knowledge": [
                    "Какие сервисы доступны в России и что можно поручить модели в плане урока"
                ],
                "skills": ["Собирает план урока в GigaChat или YandexGPT и правит его под класс"],
                "abilities": ["Отличает готовый к уроку план от сырого ответа модели"],
                "laborFunctionCode": "A/01.6",
            },
            {
                "id": id2,
                "name": "Готовит задания и проверочные работы",
                "bloomLevel": "create",
                "moduleIds": middle,
                "knowledge": ["Как проверить задание модели на возраст, формулировку и ключ"],
                "skills": ["Делает комплект заданий и короткую проверочную работу"],
                "abilities": ["Оставляет в работе только то, что можно дать ученикам"],
                "laborFunctionCode": "A/01.6",
            },
            {
                "id": id3,
                "name": "Соблюдает риски и защиту данных учеников",
                "bloomLevel": "evaluate",
                "moduleIds": last or middle,
                "knowledge": [
                    "Персональные данные детей нельзя вставлять в запрос к нейросети"
                ],
                "skills": ["Проверяет материал на риски, этику и персональные данные"],
                "abilities": ["Отказывается от сервиса, которым в России нельзя пользоваться"],
                "laborFunctionCode": "A/03.6",
            },
        ]
    extra = _extra_competencies(course)
    if extra:
        return extra
    if is_intro_python(course):
        return [
            {
                "id": id1,
                "name": "Пишет короткую программу",
                "bloomLevel": "apply",
                "moduleIds": list(dict.fromkeys(first + middle)),
                "knowledge": [
                    "Переменная хранит значение, которое можно прочитать и изменить"
                ],
                "skills": ["Пишет программу с вводом, выводом и простыми вычислениями"],
                "abilities": ["Запускает свой файл и исправляет простую ошибку"],
            },
            {
                "id": id2,
                "name": "Собирает мини-проект",
                "bloomLevel": "create",
                "moduleIds": list(dict.fromkeys(middle + project)),
                "knowledge": [
                    "Ветвление и цикл помогают программе выбирать действие и повторять шаги"
                ],
                "skills": ["Собирает игру или чат-бот из нескольких понятных шагов"],
                "abilities": ["Доводит программу до запуска перед одноклассниками"],
            },
            {
                "id": id3,
                "name": "Объясняет, как работает программа",
                "bloomLevel": "understand",
                "moduleIds": project,
                "knowledge": ["Защита проекта — это показ работы и короткий рассказ о ходе"],
                "skills": ["Называет, где в коде ввод, решение и ответ программы"],
                "abilities": ["Отвечает на вопрос «что будет, если ввести другое число?»"],
            },
        ]
    title = course.brief.title or "программу"
    return [
        {
            "id": id1,
            "name": f"Ориентируется в теме «{title}»",
            "bloomLevel": "understand",
            "moduleIds": first,
            "knowledge": [f"Называет основные понятия курса «{title}»"],
            "skills": ["Выполняет учебное задание по образцу"],
            "abilities": ["Своими словами говорит, что уже умеет"],
        },
        {
            "id": id2,
            "name": "Решает практическую задачу курса",
            "bloomLevel": "apply",
            "moduleIds": middle,
            "knowledge": ["Знает, из каких шагов состоит учебная задача"],
            "skills": ["Собирает решение из изученных приёмов"],
            "abilities": ["Проверяет результат по понятному критерию"],
        },
        {
            "id": id3,
            "name": "Представляет результат работы",
            "bloomLevel": "evaluate",
            "moduleIds": last or middle,
            "knowledge": ["Знает, что показать на итоговой работе"],
            "skills": ["Коротко рассказывает ход работы"],
            "abilities": ["Отвечает на уточняющий вопрос по своему результату"],
        },
    ]


PYTHON_QUESTIONS: list[dict[str, Any]] = [
    {
        "keys": ("программирован", "python"),
        "stem": "Что такое программа на языке Python?",
        "options": [
            "Набор шагов, которые компьютер выполняет по порядку",
            "Только картинка с кнопками",
            "Сообщение в мессенджере",
            "Таблица в Excel",
        ],
        "answer": "Набор шагов, которые компьютер выполняет по порядку",
        "explanation": "Программу пишут текстом, компьютер читает её по строкам.",
    },
    {
        "keys": ("установ", "сред", "запуск"),
        "stem": "С чего начинают работу в Python на занятии?",
        "options": [
            "Открывают редактор, пишут файл .py и запускают его",
            "Сразу пишут сайт в интернете",
            "Устанавливают новую операционную систему",
            "Рисуют схему без компьютера",
        ],
        "answer": "Открывают редактор, пишут файл .py и запускают его",
        "explanation": "Сначала нужна среда, где текст программы можно запустить.",
    },
    {
        "keys": ("перемен", "синтакс", "тип"),
        "stem": "Что делает строка name = \"Аня\"?",
        "options": [
            "Сохраняет текст «Аня» в переменную name",
            "Печатает имя на экран",
            "Сравнивает два имени",
            "Удаляет переменную name",
        ],
        "answer": "Сохраняет текст «Аня» в переменную name",
        "explanation": "Знак = записывает значение, а не сравнивает.",
    },
    {
        "keys": ("ввод", "вывод", "print", "input"),
        "stem": "Для чего нужна функция input()?",
        "options": [
            "Чтобы программа спросила данные у человека",
            "Чтобы нарисовать график",
            "Чтобы удалить файл",
            "Чтобы выключить компьютер",
        ],
        "answer": "Чтобы программа спросила данные у человека",
        "explanation": "input() ждёт строку с клавиатуры.",
    },
    {
        "keys": ("hello", "перв", "вычисл"),
        "stem": "Что выведет print(2 + 3)?",
        "options": ["5", "23", "2 + 3", "Ошибку"],
        "answer": "5",
        "explanation": "Сначала считается сумма, потом результат печатается.",
    },
    {
        "keys": ("алгоритм", "шаг"),
        "stem": "Зачем перед кодом выписывают шаги алгоритма?",
        "options": [
            "Чтобы понять порядок действий, пока программа ещё не написана",
            "Чтобы компьютер сам выбрал язык",
            "Чтобы не запускать программу",
            "Чтобы скрыть ошибки",
        ],
        "answer": "Чтобы понять порядок действий, пока программа ещё не написана",
        "explanation": "Короткий план снижает путаницу в коде.",
    },
    {
        "keys": ("ветвлен", "услов", "if"),
        "stem": "Когда срабатывает блок после if age >= 14:?",
        "options": [
            "Если в переменной age число 14 или больше",
            "Всегда, в любом случае",
            "Только если age равно нулю",
            "Никогда, if только комментирует код",
        ],
        "answer": "Если в переменной age число 14 или больше",
        "explanation": "if проверяет условие и выполняет блок только если оно истинно.",
    },
    {
        "keys": ("цикл", "for", "while", "повтор"),
        "stem": "Для чего в учебной программе нужен цикл?",
        "options": [
            "Чтобы повторить одни и те же шаги несколько раз",
            "Чтобы сохранить файл под другим именем",
            "Чтобы выключить ветвление",
            "Чтобы заменить переменные",
        ],
        "answer": "Чтобы повторить одни и те же шаги несколько раз",
        "explanation": "Цикл экономит копирование одинаковых строк.",
    },
    {
        "keys": ("функц", "файл"),
        "stem": "Что удобно вынести в функцию в мини-проекте?",
        "options": [
            "Повторяющееся действие, например ответ бота или ход игры",
            "Название папки с Python",
            "Цвет окна редактора",
            "Пароль от компьютера",
        ],
        "answer": "Повторяющееся действие, например ответ бота или ход игры",
        "explanation": "Функция даёт действию имя и позволяет вызывать его снова.",
    },
    {
        "keys": ("проект", "игр", "чат", "защит", "аттестац"),
        "stem": "Что обязательно показать на защите мини-проекта?",
        "options": [
            "Рабочую программу и своими словами объяснить, как она отвечает человеку",
            "Только скриншот чужого сайта",
            "Список всех библиотек Python",
            "Оценки за четверть",
        ],
        "answer": "Рабочую программу и своими словами объяснить, как она отвечает человеку",
        "explanation": "Важно, что программа запускается и ученик понимает её ход.",
    },
]


TEACHER_AI_QUESTIONS: list[dict[str, Any]] = [
    {
        "keys": ("план", "урок", "нейросет"),
        "stem": "Что учитель делает с планом урока, который написала нейросеть?",
        "options": [
            "Проверяет цель, время и формулировки и правит под свой класс",
            "Отдаёт ученикам без чтения",
            "Просит модель написать программу на Python",
            "Публикует в нём ФИО учеников",
        ],
        "answer": "Проверяет цель, время и формулировки и правит под свой класс",
        "explanation": "Модель даёт черновик, ответственность за урок остаётся у учителя.",
    },
    {
        "keys": ("задан", "провероч"),
        "stem": "Какой материал входит в портфолио учителя по этой программе?",
        "options": [
            "План урока, задания для учеников и проверочная работа",
            "Только скриншот чата с моделью",
            "Исходный код нейросети",
            "Табель успеваемости класса",
        ],
        "answer": "План урока, задания для учеников и проверочная работа",
        "explanation": "Зачёт принимают по трём учебным материалам, а не по переписке с ботом.",
    },
    {
        "keys": ("риск", "данн", "персональн", "этик"),
        "stem": "Что нельзя вставлять в запрос к нейросети?",
        "options": [
            "Имена, оценки и другие персональные данные учеников",
            "Тему урока без фамилий",
            "Общий запрос «сделай план на 45 минут»",
            "Критерии к заданию",
        ],
        "answer": "Имена, оценки и другие персональные данные учеников",
        "explanation": "Данные детей в запрос к модели не входят.",
    },
    {
        "keys": ("сервис", "росси", "gigachat", "yandex"),
        "stem": "Какой сервис можно указать в программе для школы в России?",
        "options": [
            "GigaChat или YandexGPT",
            "Только сервис, который в России недоступен напрямую",
            "Любой западный чат без проверки",
            "Закрытый корпоративный код ученика",
        ],
        "answer": "GigaChat или YandexGPT",
        "explanation": "В программе остаются сервисы, которыми учитель может пользоваться в школе.",
    },
    {
        "keys": ("программ", "входн", "слушател"),
        "stem": "Нужно ли учителю уметь программировать, чтобы пройти эту программу?",
        "options": [
            "Нет, достаточно уверенно работать с текстом и школьными материалами",
            "Да, обязателен Python",
            "Да, нужен опыт backend-разработки",
            "Да, нужен диплом программиста",
        ],
        "answer": "Нет, достаточно уверенно работать с текстом и школьными материалами",
        "explanation": "Это программа для учителя, а не курс разработки.",
    },
    {
        "keys": ("портфолио", "зачёт", "аттестац"),
        "stem": "Как принимают итоговую аттестацию?",
        "options": [
            "Зачёт по портфолио из трёх материалов, сделанных с помощью ИИ",
            "Письменный экзамен по математике",
            "Защита игры на Python",
            "Тест на 256 вопросов",
        ],
        "answer": "Зачёт по портфолио из трёх материалов, сделанных с помощью ИИ",
        "explanation": "В запросе методиста назван зачёт по портфолио.",
    },
    {
        "keys": ("очн", "дистанц", "заочн"),
        "stem": "Как в программе разделены форматы занятий?",
        "options": [
            "Очная работа в аудитории и дистанционная работа с применением ЭО и ДОТ",
            "Только лекции без самостоятельной работы",
            "Только стажировка 248 часов",
            "Только программирование в лаборатории",
        ],
        "answer": "Очная работа в аудитории и дистанционная работа с применением ЭО и ДОТ",
        "explanation": "Формат запроса — очно-заочный с дистанционными технологиями.",
    },
    {
        "keys": ("этик", "дет", "безопас"),
        "stem": "Что учитель проверяет, прежде чем дать ученикам текст от модели?",
        "options": [
            "Нет ли вреда, стереотипов и данных конкретных детей",
            "Красиво ли оформлен шрифт в редакторе",
            "Совпадает ли текст с чужой программой на 248 часов",
            "Есть ли в тексте код на Python",
        ],
        "answer": "Нет ли вреда, стереотипов и данных конкретных детей",
        "explanation": "Этика и безопасность важнее гладкого текста.",
    },
    {
        "keys": ("план", "цель"),
        "stem": "Чего в плане урока от модели часто не хватает?",
        "options": [
            "Реалистичного времени, цели и работы именно этого класса",
            "Названия языка Python",
            "Списка приказов Минтруда",
            "Кода трудовой функции в каждой строке",
        ],
        "answer": "Реалистичного времени, цели и работы именно этого класса",
        "explanation": "Черновик модели нужно сажать на конкретный урок.",
    },
    {
        "keys": ("провероч", "ключ", "критер"),
        "stem": "Что должно быть у проверочной работы в портфолио?",
        "options": [
            "Формулировки заданий, ключ или критерии и пометка, что проверил учитель",
            "Только красивая картинка",
            "Логин и пароль ученика",
            "Ссылка на недоступный в России сервис",
        ],
        "answer": "Формулировки заданий, ключ или критерии и пометка, что проверил учитель",
        "explanation": "Без ключа или критериев работу нельзя принять.",
    },
]


SLIDE_BANK: list[tuple[tuple[str, ...], dict[str, Any]]] = [
    (
        ("план", "урок"),
        {
            "title": "План урока с помощью ИИ",
            "bullets": [
                "Модель пишет черновик: цель, этапы, время.",
                "Учитель проверяет, подходит ли это его классу.",
                "В запросе не указывают имена и оценки учеников.",
                "Для работы в школе берут GigaChat или YandexGPT.",
                "В портфолио кладут уже проверенный план, а не сырой чат.",
            ],
        },
    ),
    (
        ("задан", "провероч"),
        {
            "title": "Задания и проверочная работа",
            "bullets": [
                "Нейросеть может предложить формулировки заданий.",
                "Учитель смотрит возраст, ясность и один верный ключ.",
                "Проверочная работа — третий материал портфолио.",
                "Программировать для этого не нужно.",
                "Готовый комплект можно дать классу на следующем уроке.",
            ],
        },
    ),
    (
        ("риск", "персональн", "этик", "безопасн"),
        {
            "title": "Риски и данные учеников",
            "bullets": [
                "Персональные данные детей в запрос к модели не входят.",
                "Текст модели проверяют на вред, стереотипы и утечку быта класса.",
                "Сервис, которым нельзя пользоваться в России, в программу не ставят.",
                "Если сомневаетесь — не отправляйте фрагмент ученической работы.",
                "Это отдельная тема программы, а не сноска в конце.",
            ],
        },
    ),
    (
        ("программирован", "что такое программа", "python"),
        {
            "title": "Что такое программа",
            "bullets": [
                "Программа — это шаги, которые компьютер выполняет по порядку.",
                "Python — язык, на котором эти шаги пишут обычным текстом.",
                "На Python делают игры, ботов и обработку данных.",
                "Мы пишем короткие программы в несколько строк.",
                "Классы, сайты и API на этом курсе не нужны.",
            ],
        },
    ),
    (
        ("установ", "сред", "запуск"),
        {
            "title": "Среда и запуск",
            "bullets": [
                "Редактор — место, где виден текст программы.",
                "Файл программы обычно заканчивается на .py.",
                "Кнопка запуска заставляет компьютер читать файл сверху вниз.",
                "Если в тексте ошибка, среда показывает строку, а не «всё сломалось».",
                "Сначала запускаем одну короткую программу и смотрим результат.",
            ],
        },
    ),
    (
        ("синтакс", "перемен", "тип", "ввод", "вывод", "input", "print"),
        {
            "title": "Переменные и ввод-вывод",
            "bullets": [
                "Переменная — имя, в котором лежит значение.",
                "Текст пишут в кавычках: \"привет\".",
                "print() показывает значение на экране.",
                "input() спрашивает строку у человека.",
                "Сначала сохраняем ответ в переменную, потом решаем, что с ним делать.",
            ],
        },
    ),
    (
        ("hello", "перв", "вычисл"),
        {
            "title": "Первая программа",
            "bullets": [
                "Первая программа может только поздороваться или сложить два числа.",
                "print(2 + 3) сначала считает, потом печатает 5.",
                "Если написать print(\"2 + 3\"), на экране будет текст, а не сумма.",
                "Ошибка — обычная часть работы: читаем сообщение и правим строку.",
                "Когда программа запускается, её уже можно показывать соседу.",
            ],
        },
    ),
    (
        ("алгоритм",),
        {
            "title": "Алгоритм простыми словами",
            "bullets": [
                "Алгоритм — понятный порядок шагов к результату.",
                "Его можно записать списком ещё до кода.",
                "Каждый шаг должен быть однозначным: что взять и что получить.",
                "Если шаг пропущен, программа ведёт себя странно.",
                "На занятии сначала говорим шаги вслух, потом пишем код.",
            ],
        },
    ),
    (
        ("ветвлен", "услов", "if"),
        {
            "title": "Ветвление if",
            "bullets": [
                "if проверяет условие и выбирает одну из веток.",
                "Пример: если число больше 10 — один ответ, иначе другой.",
                "Отступ справа от if показывает, какие строки относятся к условию.",
                "else — что делать, если условие не подошло.",
                "Так программа перестаёт делать одно и то же для всех.",
            ],
        },
    ),
    (
        ("цикл", "for", "while"),
        {
            "title": "Цикл",
            "bullets": [
                "Цикл повторяет одни и те же шаги.",
                "for удобен, когда известно, сколько раз повторить.",
                "while повторяет, пока условие остаётся истинным.",
                "В игре цикл часто спрашивает ход, пока игрок не угадает.",
                "Важно придумать, когда цикл остановится.",
            ],
        },
    ),
    (
        ("проект", "игр", "чат", "защит"),
        {
            "title": "Мини-проект и защита",
            "bullets": [
                "Проект — небольшая программа, которую можно показать классу.",
                "Подойдёт «угадай число», викторина или бот на несколько фраз.",
                "На защите запускаете программу и говорите, где ввод и решение.",
                "Критерий: программа работает и вы понимаете её ход.",
                "Чужой код без объяснения защиту не закрывает.",
            ],
        },
    ),
]


def _norm(value: str) -> str:
    return value.lower()


def _best_module_for_keys(course: CourseDocument, keys: tuple[str, ...]) -> CourseModule | None:
    scored: list[tuple[int, CourseModule]] = []
    for module in course.modules:
        blob = _norm(" ".join([module.title, *module.topics, *module.learning_outcomes]))
        score = sum(1 for key in keys if key in blob)
        if score:
            scored.append((score, module))
    if not scored:
        return course.modules[0] if course.modules else None
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def fallback_questions(course: CourseDocument, module_id: str | None = None) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    host = next((item for item in course.modules if item.id == module_id), None)
    host = host or (course.modules[0] if course.modules else None)
    if is_teacher_ai(course):
        bank = TEACHER_AI_QUESTIONS
    elif is_intro_python(course) or (
        "python" in course_text(course) and not _catalog_bank(course)
    ):
        bank = PYTHON_QUESTIONS
    else:
        bank = _catalog_bank(course)
    for item in bank:
        module = host or _best_module_for_keys(course, item["keys"])
        if module is None:
            continue
        outcomes = list(module.learning_outcomes) or [module.title]
        competency = module.competency_ids[0] if module.competency_ids else "c1"
        questions.append(
            {
                "type": "mcq",
                "stem": item["stem"],
                "options": item["options"],
                "answer": item["answer"],
                "explanation": item["explanation"],
                "competencyId": competency,
                "learningOutcome": outcomes[len(questions) % len(outcomes)],
            }
        )
        if len(questions) == 10:
            return questions
    if questions:
        seed = list(questions)
        while len(questions) < 10:
            questions.append(seed[len(questions) % len(seed)])
        return questions[:10]
    module = host
    topics = list(module.topics) if module and module.topics else ["тема занятия"]
    outcomes = list(module.learning_outcomes) if module and module.learning_outcomes else ["результат"]
    competency = module.competency_ids[0] if module and module.competency_ids else "c1"
    built: list[dict[str, Any]] = []
    for index in range(10):
        topic = topics[index % len(topics)]
        built.append(
            {
                "type": "mcq",
                "stem": f"Что слушатель должен уметь после темы «{topic}»?",
                "options": [
                    f"Выполнить учебное действие по теме «{topic}»",
                    "Выучить наизусть текст приказа",
                    "Пропустить эту тему",
                    "Заменить тему другой программой",
                ],
                "answer": f"Выполнить учебное действие по теме «{topic}»",
                "explanation": "Вопрос проверяет результат модуля, а не название темы.",
                "competencyId": competency,
                "learningOutcome": outcomes[index % len(outcomes)],
            }
        )
    return built


def slides_for_topic(topic: str, course: CourseDocument | None = None) -> dict[str, Any]:
    from .catalog import extra_slide

    extra = extra_slide(topic)
    if extra:
        return extra
    blob = _norm(topic)
    teacher = bool(course is not None and is_teacher_ai(course))
    for keys, slide in SLIDE_BANK:
        if keys[0] in {"план", "задан", "риск"} and not teacher:
            continue
        if any(key in blob for key in keys):
            return {"title": slide["title"], "bullets": list(slide["bullets"])}
    return {
        "title": topic,
        "bullets": [
            f"Тема занятия: {topic}.",
            "Сначала называем понятие своими словами.",
            "Потом смотрим короткий пример.",
            "Дальше повторяем действие на своём примере.",
            "В конце проверяем: могу объяснить и могу сделать.",
        ],
    }


def lecture_for_module(
    module: CourseModule, course: CourseDocument | None = None
) -> dict[str, Any]:
    outline = list(module.topics[:6]) if module.topics else [module.title]
    return {
        "moduleId": module.id,
        "durationMin": max(30, min(90, (module.lecture_hours or 1) * 45)),
        "outline": outline,
        "slides": [slides_for_topic(item, course) for item in outline],
    }


def project_module(course: CourseDocument) -> CourseModule | None:
    for module in course.modules:
        blob = _norm(" ".join([module.title, *module.topics]))
        if any(token in blob for token in ("проект", "игр", "чат", "защит")):
            if "аттестац" in blob and len(course.modules) > 1:
                continue
            return module
    content = [module for module in course.modules if "аттестац" not in _norm(module.title)]
    return (content[-1] if content else None) or (course.modules[-1] if course.modules else None)


def project_seminar(course: CourseDocument) -> dict[str, Any] | None:
    if is_teacher_ai(course):
        return teacher_ai_seminar(course)
    from .catalog import extra_seminar

    extra = extra_seminar(course)
    if extra:
        return extra
    module = project_module(course)
    if module is None:
        return None
    outcome = module.learning_outcomes[-1] if module.learning_outcomes else module.title
    competency = module.competency_ids[-1] if module.competency_ids else "c3"
    if not is_intro_python(course):
        return {
            "moduleId": module.id,
            "tasks": [
                {
                    "title": f"Практическое задание: {module.title}",
                    "prompt": (
                        f"Выполните учебное задание модуля «{module.title}» "
                        "и покажите результат по понятным критериям."
                    ),
                    "steps": [
                        "Уточните, что нужно получить.",
                        "Сделайте работу по шагам модуля.",
                        "Проверьте результат.",
                        "Коротко объясните ход.",
                    ],
                    "timeMin": 60,
                    "criteria": [
                        "Результат можно проверить.",
                        "Шаги соответствуют теме модуля.",
                        "Можно объяснить, что сделано.",
                    ],
                    "competencyId": competency,
                    "learningOutcome": outcome,
                }
            ],
        }
    return {
        "moduleId": module.id,
        "tasks": [
            {
                "title": "Мини-проект: игра или чат-бот",
                "prompt": (
                    "Собери маленькую программу, которую можно показать классу: "
                    "«угадай число», викторина на 5 вопросов или бот, который отвечает "
                    "на несколько фраз. Пиши так, чтобы одноклассник понял, что происходит."
                ),
                "steps": [
                    "Выбери формат: игра или чат-бот.",
                    "Выпиши 3–5 шагов: что спрашивает программа и что отвечает.",
                    "Напиши код с переменными, вводом и ветвлением или циклом.",
                    "Проверь запуск и пустой ввод.",
                    "Подготовь одну минуту: что делает программа и где самое сложное место.",
                ],
                "timeMin": 90,
                "criteria": [
                    "Программа запускается и делает то, что обещано.",
                    "Есть ввод человека и ответ программы.",
                    "Использованы переменные и хотя бы одно ветвление или цикл.",
                    "Можно своими словами объяснить ход работы.",
                ],
                "competencyId": competency,
                "learningOutcome": outcome,
            }
        ],
    }


def relink_modules(course: CourseDocument, node_ids: list[str]) -> list[dict[str, Any]]:
    modules = []
    total = len(course.modules)
    for index, module in enumerate(course.as_api()["modules"]):
        row = dict(module)
        if total <= 1:
            row["competencyIds"] = node_ids
        elif index == 0:
            row["competencyIds"] = node_ids[:1] or node_ids
        elif index == total - 1:
            row["competencyIds"] = node_ids[-1:]
        else:
            row["competencyIds"] = node_ids[1:2] or node_ids[:1]
        modules.append(row)
    return modules


def teacher_ai_seminar(course: CourseDocument) -> dict[str, Any] | None:
    module = course.modules[1] if len(course.modules) > 1 else (course.modules[0] if course.modules else None)
    if module is None:
        return None
    outcome = module.learning_outcomes[-1] if module.learning_outcomes else module.title
    competency = module.competency_ids[0] if module.competency_ids else "c2"
    return {
        "moduleId": module.id,
        "tasks": [
            {
                "title": "План урока с помощью ИИ",
                "prompt": (
                    "Соберите план урока на 45 минут в GigaChat или YandexGPT "
                    "и поправьте его под свой класс. Имена учеников в запрос не вставляйте."
                ),
                "steps": [
                    "Сформулируйте тему и цель без персональных данных.",
                    "Получите черновик плана в доступном в России сервисе.",
                    "Проверьте время, этапы и формулировки.",
                    "Сохраните итоговый план в портфолио.",
                ],
                "timeMin": 45,
                "criteria": [
                    "План можно провести за урок.",
                    "Нет персональных данных учеников.",
                    "Видно, что учитель правил ответ модели.",
                ],
                "competencyId": competency,
                "learningOutcome": outcome,
            },
            {
                "title": "Задания для учеников",
                "prompt": "Сделайте 5–7 заданий к этому уроку и проверьте, что их можно дать классу.",
                "steps": [
                    "Попросите модель черновик заданий.",
                    "Уберите слишком сложные или вредные формулировки.",
                    "Оставьте задания, которые ученик поймёт без программирования.",
                ],
                "timeMin": 40,
                "criteria": [
                    "Задания по теме урока.",
                    "Язык понятен школьнику.",
                    "Нет требования писать код.",
                ],
                "competencyId": competency,
                "learningOutcome": outcome,
            },
            {
                "title": "Проверочная работа",
                "prompt": "Соберите короткую проверочную работу с ключом или критериями.",
                "steps": [
                    "Соберите 5 вопросов или заданий.",
                    "Напишите ключ или критерии.",
                    "Проверьте этику и отсутствие данных детей.",
                ],
                "timeMin": 35,
                "criteria": [
                    "Есть ключ или критерии.",
                    "Работу можно провести на уроке.",
                    "Материал проверен учителем.",
                ],
                "competencyId": competency,
                "learningOutcome": outcome,
            },
        ],
    }


def attestation_form(course: CourseDocument) -> str | None:
    if is_teacher_ai(course):
        current = course.brief.attestation_form.lower()
        if "портфолио" in current and "трёх" in current:
            return None
        return (
            "Зачёт по портфолио из трёх материалов, созданных с помощью ИИ: "
            "план урока, задания для учеников и проверочная работа; "
            "у каждого есть требования и критерии"
        )
    from .catalog import extra_attestation

    extra = extra_attestation(course)
    if extra:
        return extra
    if not is_intro_python(course):
        return None
    current = course.brief.attestation_form.lower()
    if "защит" in current and "проект" in current and "критер" in current:
        return None
    return (
        "Защита проекта (игра или чат-бот): программа запускается, "
        "есть ввод и ответ, ученик объясняет ход работы"
    )


def hour_split(course: CourseDocument) -> tuple[float, float]:
    from .catalog import is_internship

    classroom = sum(
        module.lecture_hours + module.practice_hours + module.lab_hours
        for module in course.modules
    )
    self_study = sum(module.self_study_hours for module in course.modules)
    if is_internship(course) or course.brief.format == "workshop":
        return 0, classroom + self_study
    if course.brief.format == "lecture":
        return classroom + self_study, 0
    if self_study <= 0 and course.brief.format == "blended" and classroom:
        return (
            sum(module.lecture_hours + module.lab_hours for module in course.modules),
            sum(module.practice_hours for module in course.modules),
        )
    return classroom, self_study


def issued_document(course: CourseDocument) -> str:
    if course.brief.program_kind == "qualification":
        return "Выдаваемый документ: удостоверение о повышении квалификации."
    if course.brief.program_kind == "general":
        return "Выдаваемый документ: сертификат об освоении программы."
    return ""


def document_constraints(course: CourseDocument) -> list[str]:
    from .catalog import is_internship

    lines = [issued_document(course)]
    ochno, distance = hour_split(course)
    if is_internship(course) or course.brief.format == "workshop":
        if distance or ochno:
            lines.append(
                f"На площадке, самостоятельно: {distance:g} ч. Аудитория: {ochno:g} ч."
            )
    elif ochno and distance:
        lines.append(
            f"Очно: {ochno:g} ч (аудитория). Дистанционно, ЭО и ДОТ: {distance:g} ч."
        )
    elif ochno:
        lines.append(f"Очно: {ochno:g} ч (аудитория).")
    elif distance:
        lines.append(f"Дистанционно, ЭО и ДОТ: {distance:g} ч.")
    if is_teacher_ai(course):
        lines.extend(
            [
                "Только сервисы, доступные в России: GigaChat, YandexGPT.",
                "Входные требования: педагогическое образование, программирование не требуется.",
                "Персональные данные учеников в запросы к модели не входят.",
            ]
        )
    from .catalog import extra_constraints

    lines.extend(extra_constraints(course))
    return [line for line in lines if line]


def teacher_ai_constraints() -> list[str]:
    return [
        "Только сервисы, доступные в России: GigaChat, YandexGPT.",
        "Программирование не требуется.",
        "Персональные данные учеников в запросы к модели не входят.",
    ]


def ensure_risk_topic(modules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    blob = " ".join(
        f"{module.get('title')} {' '.join(module.get('topics') or [])}"
        for module in modules
    ).lower()
    if "риск" in blob and ("персональн" in blob or "данн" in blob):
        return modules
    if not modules:
        return modules
    target = modules[-1]
    topics = list(target.get("topics") or [])
    topics.append("Риски, этика и защита персональных данных учеников при работе с ИИ")
    target["topics"] = topics[:8]
    outcomes = list(target.get("learningOutcomes") or [])
    if not any("персональн" in item.lower() or "риск" in item.lower() for item in outcomes):
        outcomes.append("Соблюдает риски и защиту персональных данных учеников")
        target["learningOutcomes"] = outcomes[:6]
    return modules
