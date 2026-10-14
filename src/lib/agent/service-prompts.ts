export const FRAMEWORK_PROMPT =
  "Собери только каркас по уже известному. Не переспрашивай заполненные поля. Вызови update_brief, set_competency_map и set_structure. Сумма часов должна сойтись. Тесты, задания и лекции не пиши.";

export const KIT_PROMPT =
  "Каркас утверждён. Для каждого модуля вызови set_assessment, set_seminar и set_lecture. Часы и список компетенций не меняй. Каждый вопрос привяжи к компетенции.";
