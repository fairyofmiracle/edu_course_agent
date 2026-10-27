export const FRAMEWORK_PROMPT =
  "Собери только каркас по уже известному. Не переспрашивай заполненные поля. Вызови update_brief, set_competency_map и set_structure. Сумма часов должна сойтись. Тесты, задания и лекции не пиши.";

export const KIT_PROMPT =
  "Каркас утверждён. Для каждого модуля вызови set_assessment, set_seminar и set_lecture. Часы и список компетенций не меняй. Каждый вопрос привяжи к компетенции.";

export function moduleKitPrompt(moduleId: string, title: string): string {
  const label = title.trim() || moduleId;
  return (
    `Каркас утверждён. Пересобери учебные материалы только для модуля «${label}» ` +
    `(moduleId <${moduleId}>): set_lecture, set_seminar и set_assessment именно для этого moduleId. ` +
    `Другие модули не трогай. Часы и список компетенций не меняй.`
  );
}

export function displayServicePrompt(text: string): string {
  if (text === KIT_PROMPT) {
    return "Готовлю учебные материалы: лекции, практические задания и тесты.";
  }

  if (text === FRAMEWORK_PROMPT) {
    return "Собираю каркас образовательной программы.";
  }

  if (text.startsWith("Каркас утверждён. Пересобери учебные материалы только для модуля")) {
    return "Пересобираю материалы выбранного модуля.";
  }

  return text;
}
