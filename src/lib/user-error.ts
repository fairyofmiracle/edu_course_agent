const GENERIC =
  "Шаг не завершился. Каркас на месте — повторите запрос или выгрузите программу кнопкой в студии.";

const TECHNICAL =
  /document is not defined|ReferenceError|TypeError|PYTHON_AGENT|HTTP \d{3}|status code|EADDR|stack|Traceback|ZodError|ValidationError|[A-Za-z]+Error:| at \S+\(|\/src\/|\/backend\//i;

export function describeError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const status = (error as { statusCode?: number }).statusCode;
  return status ? `${status} ${error.message}` : error.message;
}

/** Текст для методиста: без HTTP-кодов, стека и имён переменных. */
export function userFacingError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = describeError(error);
  if (name === "TimeoutError" || name === "AbortError" || /abort|timed out|timeout/i.test(message)) {
    return "Шлюз не ответил за отведённое время. Каркас на месте, шаг можно повторить.";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network|ECONNRESET/i.test(message)) {
    return "Студия не достучалась до API. Проверьте, что сервер на порту 8000 запущен, и повторите шаг.";
  }
  if (TECHNICAL.test(message)) return GENERIC;
  const clipped = message.trim().slice(0, 240);
  return clipped || GENERIC;
}

export const chatFailureText = userFacingError;
