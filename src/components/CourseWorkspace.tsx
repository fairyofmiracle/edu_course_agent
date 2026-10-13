"use client";

import { CompetencyMap } from "@/components/CompetencyMap";
import { LectureDeck } from "@/components/LectureDeck";
import { MermaidBlock } from "@/components/MermaidBlock";
import { structureMermaid } from "@/lib/export";
import { contentGaps, frameworkItems, isFrameworkApproved, outcomeGaps } from "@/lib/framework-check";
import {
  BLOOM_LABELS,
  FORMAT_LABELS,
  LEVEL_LABELS,
  PROGRAM_KIND_LABELS,
  QUESTION_LABELS,
  courseCompleteness,
  isCourseEmpty,
  type CourseDocument,
} from "@/lib/course-schema";

export type WorkspaceTab =
  | "overview"
  | "structure"
  | "competencies"
  | "lectures"
  | "seminars"
  | "tests";

const TABS: { id: WorkspaceTab; label: string; hint: string }[] = [
  { id: "overview", label: "Обзор", hint: "Шаблон, аудитория и проверка часов. Каркас утверждают здесь." },
  { id: "structure", label: "План", hint: "Модули и темы: лекции, практика, лабораторные, самостоятельная работа." },
  { id: "competencies", label: "Компетенции", hint: "Знания, умения и навыки. Каждая компетенция входит в модуль." },
  { id: "lectures", label: "Лекции", hint: "Планы и слайды. Появляются после кнопки «Утвердить каркас»." },
  { id: "seminars", label: "Семинары", hint: "Задания с критериями. Тоже после утверждения каркаса." },
  { id: "tests", label: "Тесты", hint: "Вопросы с ключами и привязкой к результату обучения." },
];

type CourseWorkspaceProps = {
  course: CourseDocument;
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
};

export function CourseWorkspace({ course, tab, onTabChange }: CourseWorkspaceProps) {
  const empty = isCourseEmpty(course);
  const completeness = courseCompleteness(course);

  return (
    <section className="workspace">
      <nav className="tabs" aria-label="Разделы курса">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "tab active" : "tab"}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <p className="kicker section-hint">{TABS.find((item) => item.id === tab)?.hint}</p>

      <div className="workspace-body">
        {empty && tab === "overview" ? (
          <EmptyState />
        ) : (
          <>
            {tab === "overview" ? <Overview course={course} score={completeness.score} /> : null}
            {tab === "structure" ? <Structure course={course} /> : null}
            {tab === "competencies" ? <CompetencyMap course={course} /> : null}
            {tab === "lectures" ? <LectureDeck course={course} /> : null}
            {tab === "seminars" ? <Seminars course={course} /> : null}
            {tab === "tests" ? <Tests course={course} /> : null}
          </>
        )}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="hero-empty">
      <p className="kicker">Студия методиста</p>
      <h2>Курс ещё не собран</h2>
      <p>
        Опишите в чате тему, аудиторию, часы и источники. Агент сначала задаст
        недостающие вопросы и соберёт каркас. Тесты, задания и лекции появятся
        только после того, как вы утвердите каркас.
      </p>
      <ol>
        <li>Запрос и уточняющие вопросы</li>
        <li>Каркас: компетенции и учебный план, часы сходятся</li>
        <li>После утверждения — программа, тесты, задания и слайды</li>
      </ol>
    </div>
  );
}

function FrameworkCheck({ course }: { course: CourseDocument }) {
  const items = frameworkItems(course);
  const approved = isFrameworkApproved(course);
  const gaps = contentGaps(course);
  return (
    <article>
      <h3>Проверка каркаса</h3>
      <ul className="check-list">
        {items.map((item) => (
          <li key={item.id} className={item.ok ? "ok" : "bad"}>
            {item.label}
          </li>
        ))}
      </ul>
      <p className="muted">
        {approved
          ? "Каркас утверждён. Можно собирать тесты, задания и лекции."
          : "Содержание откроется после кнопки «Утвердить каркас»."}
      </p>
      {course.assessments.length > 0 && gaps.length > 0 ? (
        <p className="voice-error">
          Вопросы не закрывают компетенции: {gaps.join(", ")}
        </p>
      ) : null}
      {course.assessments.length > 0 && outcomeGaps(course).length > 0 ? (
        <p className="voice-error">
          Нет вопроса на результат: {outcomeGaps(course).join("; ")}
        </p>
      ) : null}
    </article>
  );
}

function Overview({ course, score }: { course: CourseDocument; score: number }) {
  const { brief } = course;
  return (
    <div className="overview">
      <header className="overview-head">
        <div>
          <p className="kicker">Программа</p>
          <h2>{brief.title || "Без названия"}</h2>
        </div>
        <p className="score">{Math.round(score * 100)}% комплекта</p>
      </header>
      <dl className="meta-grid">
        <div>
          <dt>Аудитория</dt>
          <dd>{brief.audience || "—"}</dd>
        </div>
        <div>
          <dt>Уровень</dt>
          <dd>{LEVEL_LABELS[brief.level]}</dd>
        </div>
        <div>
          <dt>Объём</dt>
          <dd>{brief.durationHours ? `${brief.durationHours} ч` : "—"}</dd>
        </div>
        <div>
          <dt>Формат</dt>
          <dd>{FORMAT_LABELS[brief.format]}</dd>
        </div>
        <div>
          <dt>Шаблон</dt>
          <dd>{PROGRAM_KIND_LABELS[brief.programKind]}</dd>
        </div>
        <div>
          <dt>Аттестация</dt>
          <dd>
            {brief.attestationHours ? `${brief.attestationHours} ч` : "0 ч"}
            {brief.attestationForm ? ` · ${brief.attestationForm}` : ""}
          </dd>
        </div>
      </dl>
      {course.modules.length > 0 ? (
        <table className="hours-table">
          <thead>
            <tr>
              <th>Модуль</th>
              <th>Лекции</th>
              <th>Практика</th>
              <th>Лаб.</th>
              <th>Самост.</th>
              <th>Всего</th>
            </tr>
          </thead>
          <tbody>
            {course.modules.map((courseModule) => (
              <tr key={courseModule.id}>
                <td>{courseModule.title}</td>
                <td>{courseModule.lectureHours}</td>
                <td>{courseModule.practiceHours}</td>
                <td>{courseModule.labHours}</td>
                <td>{courseModule.selfStudyHours}</td>
                <td>{courseModule.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="two-col">
        <article>
          <h3>Цели</h3>
          <ul>
            {brief.goals.length ? brief.goals.map((item) => <li key={item}>{item}</li>) : <li>—</li>}
          </ul>
        </article>
        <article>
          <h3>Ограничения</h3>
          <ul>
            {brief.constraints.length ? (
              brief.constraints.map((item) => <li key={item}>{item}</li>)
            ) : (
              <li>—</li>
            )}
          </ul>
        </article>
      </div>
      <FrameworkCheck course={course} />
      <article>
        <h3>Референсы</h3>
        <ul>
          {brief.references.length ? (
            brief.references.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                {item.source ? ` · ${item.source}` : ""}
                {item.note ? ` — ${item.note}` : ""}
              </li>
            ))
          ) : (
            <li>—</li>
          )}
        </ul>
      </article>
    </div>
  );
}

function Structure({ course }: { course: CourseDocument }) {
  if (course.modules.length === 0) {
    return <p className="empty-hint">Структура появится, когда агент соберёт модули.</p>;
  }
  const chart = structureMermaid(course);
  return (
    <div className="structure">
      {chart ? <MermaidBlock chart={chart} /> : null}
      <ol className="module-list">
        {course.modules.map((courseModule) => (
          <li key={courseModule.id}>
            <header>
              <span className="mono">{courseModule.id}</span>
              <h3>{courseModule.title}</h3>
              <span className="hours">{courseModule.hours} ч</span>
            </header>
            <p className="muted">Компетенции: {courseModule.competencyIds.join(", ")}</p>
            <h4>Темы</h4>
            <ul>
              {(courseModule.plan.length ? courseModule.plan : courseModule.topics.map((topic) => ({
                title: topic,
                lectureHours: 0,
                practiceHours: 0,
                labHours: 0,
                selfStudyHours: 0,
              }))).map((topic) => (
                <li key={topic.title}>
                  {topic.title}
                  {courseModule.plan.length
                    ? ` — л ${topic.lectureHours}, п ${topic.practiceHours}, лаб ${topic.labHours}, срс ${topic.selfStudyHours}`
                    : ""}
                </li>
              ))}
            </ul>
            <h4>Результаты</h4>
            <ul>
              {courseModule.learningOutcomes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Seminars({ course }: { course: CourseDocument }) {
  if (course.seminars.length === 0) {
    return <p className="empty-hint">Семинары появятся, когда агент соберёт задания.</p>;
  }
  return (
    <div className="stack-blocks">
      {course.seminars.map((seminar) => {
        const courseModule = course.modules.find((item) => item.id === seminar.moduleId);
        return (
          <article key={seminar.moduleId} className="block">
            <h3>{courseModule?.title ?? seminar.moduleId}</h3>
            {seminar.tasks.map((task) => (
              <div key={task.title} className="task">
                <header>
                  <h4>{task.title}</h4>
                  <span>
                    {task.timeMin} мин · {task.competencyId}
                  </span>
                </header>
                <p>{task.prompt}</p>
                <h5>Ход</h5>
                <ol>
                  {task.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <h5>Критерии</h5>
                <ul>
                  {task.criteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </article>
        );
      })}
    </div>
  );
}

function Tests({ course }: { course: CourseDocument }) {
  if (course.assessments.length === 0) {
    return <p className="empty-hint">Тесты появятся, когда агент соберёт вопросы.</p>;
  }
  return (
    <div className="stack-blocks">
      {course.assessments.map((assessment) => {
        const courseModule = course.modules.find((item) => item.id === assessment.moduleId);
        return (
          <article key={assessment.moduleId} className="block">
            <h3>{courseModule?.title ?? assessment.moduleId}</h3>
            <ol className="questions">
              {assessment.questions.map((question, index) => (
                <li key={`${question.stem}-${index}`}>
                  <p>
                    <span className="qtype">{QUESTION_LABELS[question.type]}</span> {question.stem}
                  </p>
                  {question.options?.length ? (
                    <ul>
                      {question.options.map((option) => (
                        <li
                          key={option}
                          className={option === question.answer ? "correct" : undefined}
                        >
                          {option}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="answer">Ответ: {question.answer}</p>
                  )}
                  <p className="muted">
                    Ключ: {question.answer}
                    {question.learningOutcome ? ` · результат: ${question.learningOutcome}` : ""}
                    {" · "}
                    {question.explanation} · {BLOOM_LABELS[
                      course.competencies.nodes.find((node) => node.id === question.competencyId)
                        ?.bloomLevel ?? "apply"
                    ]}{" "}
                    ({question.competencyId})
                  </p>
                </li>
              ))}
            </ol>
          </article>
        );
      })}
    </div>
  );
}
