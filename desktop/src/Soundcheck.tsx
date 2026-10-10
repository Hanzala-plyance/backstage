import { goalText, lessons } from "./core/lessons";
const KEY = "backstage:soundcheck";
/** Passed lesson IDs; a per-computer convenience, so losing it only means
 * lessons show as not yet passed. */
export function loadProgress(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}
export function saveProgress(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {}
}
export const CHECK_ID = "controller-check";
/** Soundcheck: a controller check, the lessons in order, then the full
 * practice track. Start runs the first step not yet done and each step leads to
 * the next, so one button takes a new player through everything. */
export default function Soundcheck({
  done,
  onStart,
  onCheck,
  onLesson,
  onFullTrack,
}: {
  done: string[];
  onStart: () => void;
  onCheck: () => void;
  onLesson: (index: number) => void;
  onFullTrack: () => void;
}) {
  const checked = done.includes(CHECK_ID);
  const passed = lessons.filter((l) => done.includes(l.id)).length;
  const next = !checked ? -1 : lessons.findIndex((l) => !done.includes(l.id));
  const finished = checked && next < 0;
  const steps = lessons.length + 1;
  const card = (
    key: string,
    n: string,
    title: string,
    summary: string,
    detail: string,
    state: "passed" | "next" | "",
    onClick: () => void,
    extra = "",
  ) => (
    <li key={key}>
      <button className={"lesson-card " + state + extra} onClick={onClick}>
        <span className="lesson-number">{n}</span>
        <span className="lesson-text">
          <strong>{title}</strong>
          <small>{summary}</small>
          <em>{detail}</em>
        </span>
        <span className="lesson-state">
          {state === "passed" ? "✓ Done" : state === "next" ? "Next up" : ""}
        </span>
      </button>
    </li>
  );
  return (
    <div className="soundcheck-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SOUNDCHECK</span>
          <h1>Learn the stage.</h1>
          <p>
            Test your controller, then learn one skill at a time: watch the
            demo, then take your turn.
          </p>
          <button
            className="primary soundcheck-start"
            data-menu-default
            onClick={onStart}
          >
            {finished
              ? "Play the full track"
              : checked || passed
                ? "Continue Soundcheck"
                : "Start Soundcheck"}{" "}
            →
          </button>
        </div>
        <div className="soundcheck-progress" aria-label="Steps done">
          <b>{passed + (checked ? 1 : 0)}</b>
          <span>/ {steps} done</span>
        </div>
      </div>
      <ol className="lesson-list">
        {card(
          CHECK_ID,
          "1",
          "Controller check",
          "Press every fret, strum and button once.",
          "Make sure everything works",
          checked ? "passed" : "next",
          onCheck,
        )}
        {lessons.map((lesson, i) =>
          card(
            lesson.id,
            String(i + 2),
            lesson.title,
            lesson.summary,
            goalText(lesson.goal, lesson.notes.length),
            done.includes(lesson.id) ? "passed" : i === next ? "next" : "",
            () => onLesson(i),
          ),
        )}
        {card(
          "full",
          "✦",
          "Full Soundcheck track",
          "Put it all together on the 32-second practice song.",
          "Easy · scores and stars are saved",
          finished ? "next" : "",
          onFullTrack,
          " finale",
        )}
      </ol>
    </div>
  );
}
