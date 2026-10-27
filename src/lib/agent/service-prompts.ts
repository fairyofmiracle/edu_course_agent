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

export function adaptHoursPrompt(hours: number): string {
  const n = Math.max(16, Math.round(hours * 2) / 2);
  return (
    `Адаптируй программу под объём ${n} академических часов. ` +
    `Вызови update_brief с durationHours=${n} и set_structure с пересчитанными модулями. ` +
    `Сумма часов модулей и аттестации должна сойтись. Тип программы и аудиторию не меняй. ` +
    `Лекции, семинары и тесты пока не пиши.`
  );
}

export function adaptAudiencePrompt(audience: string): string {
  const label = audience.trim() || "начинающие специалисты без опыта";
  return (
    `Адаптируй программу под аудиторию «${label}». ` +
    `Вызови update_brief с новым audience и при необходимости set_competency_map и set_structure ` +
    `с формулировками под эту аудиторию. Объём часов и тип программы не меняй. ` +
    `Лекции, семинары и тесты пока не пиши.`
  );
}

export function refreshOutdatedPrompt(labels: string[]): string {
  const listed = labels.length ? labels.join(", ") : "устаревшие технологии";
  return (
    `В программе найдены устаревшие технологии: ${listed}. ` +
    `Замени их на актуальные аналоги в темах, результатах и планах модулей через set_structure ` +
    `(и set_competency_map при необходимости). Часы и тип программы не меняй. ` +
    `Лекции, семинары и тесты пока не пиши — только каркас.`
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

  if (text.startsWith("Адаптируй программу под объём")) {
    return "Адаптирую программу под новый объём часов.";
  }

  if (text.startsWith("Адаптируй программу под аудиторию")) {
    return "Адаптирую программу под другую аудиторию.";
  }

  if (text.startsWith("В программе найдены устаревшие технологии")) {
    return "Обновляю устаревшие технологии в каркасе.";
  }

  return text;
}
