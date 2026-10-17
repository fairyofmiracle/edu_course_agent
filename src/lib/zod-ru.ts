import { z } from "zod";

export function russianZodError(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "корень";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
