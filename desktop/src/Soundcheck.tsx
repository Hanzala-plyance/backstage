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
/** Soundcheck: lessons in order, then the full practice track. */
export default function Soundcheck({
  done,
  onLesson,
  onFullTrack,
}: {
  done: string[];
  onLesson: (index: number) => void;
  onFullTrack: () => void;
}) {
  const next = lessons.findIndex((l) => !done.includes(l.id));
  return (
    <div className="soundcheck-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SOUNDCHECK</span>
          <h1>Learn the stage.</h1>
          <p>
            Short lessons, one skill at a time. Watch the demo, then take your
            turn.
          </p>
        </div>
        <div className="soundcheck-progress" aria-label="Lessons passed">
          <b>{done.filter((id) => lessons.some((l) => l.id === id)).length}</b>
          <span>/ {lessons.length} passed</span>
        </div>
      </div>
      <ol className="lesson-list">
        {lessons.map((lesson, i) => {
          const passed = done.includes(lesson.id);
          return (
            <li key={lesson.id}>
              <button
                className={
                  "lesson-card" +
                  (passed ? " passed" : "") +
                  (i === next ? " next" : "")
                }
                data-menu-default={i === Math.max(0, next) ? "" : undefined}
                onClick={() => onLesson(i)}
              >
                <span className="lesson-number">{i + 1}</span>
                <span className="lesson-text">
                  <strong>{lesson.title}</strong>
                  <small>{lesson.summary}</small>
                  <em>{goalText(lesson.goal, lesson.notes.length)}</em>
                </span>
                <span className="lesson-state">
                  {passed ? "✓ Passed" : i === next ? "Next up" : "Lesson"}
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            className={"lesson-card finale" + (next < 0 ? " next" : "")}
            data-menu-default={next < 0 ? "" : undefined}
            onClick={onFullTrack}
          >
            <span className="lesson-number">✦</span>
            <span className="lesson-text">
              <strong>Full Soundcheck track</strong>
              <small>Put it all together on the 32-second practice song.</small>
              <em>Scores and stars are saved</em>
            </span>
            <span className="lesson-state">Play the full track</span>
          </button>
        </li>
      </ol>
    </div>
  );
}
