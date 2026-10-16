import { describe, expect, it } from "vitest";
import { createEmptyCourse } from "@/lib/course-schema";
import {
  adaptCourseCopy,
  duplicateCourse,
  forgetCourse,
  LIBRARY_KEY,
  listLibrary,
  loadLibraryCourse,
  readLibrary,
  rememberCourse,
} from "@/lib/course-library";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("библиотека курсов", () => {
  it("новый курс не затирает уже сохранённый", () => {
    const storage = memory();
    const first = createEmptyCourse();
    first.id = "course-teachers";
    first.brief = { ...first.brief, title: "Для учителей", audience: "Учителя школ" };
    const second = createEmptyCourse();
    second.id = "course-students";
    second.brief = { ...second.brief, title: "Для студентов", audience: "Студенты колледжа" };
    rememberCourse(first, [{ id: "m1", role: "user", parts: [] }], storage);
    rememberCourse(second, [], storage);

    const titles = listLibrary(storage).map((item) => item.title);
    expect(titles).toEqual(["Для студентов", "Для учителей"]);
    expect(loadLibraryCourse(storage, first.id)?.course.brief.audience).toBe("Учителя школ");
    expect(loadLibraryCourse(storage, first.id)?.messages).toHaveLength(1);

    forgetCourse(second.id, storage);
    expect(listLibrary(storage).map((item) => item.id)).toEqual([first.id]);
    expect(loadLibraryCourse(storage, second.id)).toBeNull();
  });

  it("копия получает новый идентификатор и оставляет аудиторию для правки", () => {
    const course = createEmptyCourse();
    course.brief = { ...course.brief, title: "Сети", audience: "Студенты 3 курса" };
    course.modules = [
      {
        id: "m1",
        title: "Коммутация",
        hours: 16,
        lectureHours: 4,
        practiceHours: 8,
        labHours: 2,
        selfStudyHours: 2,
        topics: ["VLAN"],
        plan: [],
        learningOutcomes: ["Настраивает VLAN"],
        competencyIds: [],
      },
    ];
    const copy = duplicateCourse(course);
    copy.brief.audience = "Преподаватели";

    expect(copy.id).not.toBe(course.id);
    expect(copy.brief.title).toBe("Сети — копия");
    expect(course.brief.audience).toBe("Студенты 3 курса");
    expect(course.modules[0].title).toBe("Коммутация");
    expect(copy.modules[0].title).toBe("Коммутация");
  });

  it("копия под новую аудиторию пересчитывает часы и не меняет тексты", () => {
    const course = createEmptyCourse();
    course.brief = {
      ...course.brief,
      title: "Сети",
      audience: "Студенты 3 курса",
      durationHours: 16,
      attestationHours: 0,
    };
    course.frameworkApproved = true;
    course.frameworkFingerprint = "old";
    course.modules = [
      {
        id: "m1",
        title: "Коммутация",
        hours: 10,
        lectureHours: 4,
        practiceHours: 4,
        labHours: 0,
        selfStudyHours: 2,
        topics: ["VLAN"],
        plan: [],
        learningOutcomes: ["Настраивает VLAN"],
        competencyIds: ["c1"],
      },
      {
        id: "m2",
        title: "Маршрутизация",
        hours: 6,
        lectureHours: 2,
        practiceHours: 2,
        labHours: 0,
        selfStudyHours: 2,
        topics: ["OSPF"],
        plan: [],
        learningOutcomes: ["Строит маршрут"],
        competencyIds: ["c1"],
      },
    ];
    course.lectures = [
      {
        moduleId: "m1",
        durationMin: 40,
        outline: ["Тема", "Практика", "Итог"],
        slides: [
          { title: "VLAN", bullets: ["Сегмент", "Порт"] },
          { title: "Практика", bullets: ["Стенд", "Проверка"] },
          { title: "Схема", bullets: ["До", "После"] },
          { title: "Итог", bullets: ["Вопрос", "Ответ"] },
        ],
      },
    ];

    const adapted = adaptCourseCopy(course, {
      audience: "Преподаватели колледжа",
      durationHours: 36,
      attestationHours: 2,
    });

    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    const moduleHours = adapted.course.modules.reduce((total, item) => total + item.hours, 0);
    expect(adapted.course.id).not.toBe(course.id);
    expect(adapted.course.brief.audience).toBe("Преподаватели колледжа");
    expect(adapted.course.brief.durationHours).toBe(36);
    expect(moduleHours + adapted.course.brief.attestationHours).toBe(36);
    expect(adapted.course.modules.map((item) => item.title)).toEqual(["Коммутация", "Маршрутизация"]);
    expect(adapted.course.modules[0].topics).toEqual(["VLAN"]);
    expect(adapted.course.lectures[0].slides[0].title).toBe("VLAN");
    expect(adapted.course.frameworkApproved).toBe(false);
    expect(course.brief.audience).toBe("Студенты 3 курса");
    expect(course.brief.durationHours).toBe(16);
    expect(course.modules[0].hours).toBe(10);
    expect(adaptCourseCopy(course, { audience: "", durationHours: 36, attestationHours: 2 }).ok).toBe(false);
    expect(adaptCourseCopy(course, { audience: "Преподаватели", durationHours: 15, attestationHours: 0 }).ok).toBe(
      false,
    );
    expect(adaptCourseCopy(course, { audience: "Преподаватели", durationHours: 16.2, attestationHours: 0 }).ok).toBe(
      false,
    );
    expect(adaptCourseCopy(course, { audience: "Преподаватели", durationHours: 16, attestationHours: 20 }).ok).toBe(
      false,
    );
    expect(adaptCourseCopy(course, { audience: "Преподаватели", durationHours: 16, attestationHours: 16 }).ok).toBe(
      false,
    );
  });

  it("пропускает битую запись и молчит, если хранилище не пишет", () => {
    const storage = memory();
    storage.setItem(LIBRARY_KEY, "{");
    expect(readLibrary(storage)).toEqual({});
    storage.setItem(LIBRARY_KEY, JSON.stringify(["нет"]));
    expect(readLibrary(storage)).toEqual({});
    storage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        bad: "строка",
        other: { course: { id: "wrong" }, messages: "нет" },
      }),
    );
    expect(listLibrary(storage)).toEqual([]);

    const full = memory();
    const original = full.setItem;
    full.setItem = () => {
      throw new Error("quota");
    };
    const course = createEmptyCourse();
    rememberCourse(course, [], full);
    full.setItem = original;
    expect(loadLibraryCourse(full, course.id)).toBeNull();
  });
});
