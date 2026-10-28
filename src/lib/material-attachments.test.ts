import { describe, expect, it } from "vitest";
import { materialToReference } from "@/lib/material-attachments";

describe("materialToReference", () => {
  it("marks uploaded files as methodologist materials", () => {
    expect(
      materialToReference({ label: "program.docx", body: "[x]", source: "program.docx" }),
    ).toEqual({
      title: "program.docx",
      source: "program.docx",
      note: "Файл загружен методистом",
    });
  });

  it("marks http(s) links separately", () => {
    expect(
      materialToReference({
        label: "Приказ 629",
        body: "[y]",
        source: "https://example.gov/order",
      }),
    ).toEqual({
      title: "Приказ 629",
      source: "https://example.gov/order",
      note: "Ссылка добавлена методистом",
    });
  });

  it("falls back to label when source missing", () => {
    expect(materialToReference({ label: "notes.txt", body: "" }).source).toBe("notes.txt");
  });
});
