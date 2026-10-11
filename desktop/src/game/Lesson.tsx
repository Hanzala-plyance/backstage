import { useEffect, useRef, useState } from "react";
import type { Profile } from "../types";
import { SongAudio } from "../core/audio";
import { keyboardLanes } from "../core/input";
import { activateFocused, focusFirst, moveFocus } from "../core/menu";
import { isPad } from "../core/players";
import {
  DemoPlayer,
  cueFor,
  goalText,
  lessonChart,
  lessonEnd,
  lessonResult,
  lessons,
  lessonsFor,
  type Lesson,
} from "../core/lessons";
import ButtonHints from "../ButtonHints";
import { PlayerRuntime, drumNotes, type MidiPort } from "./player";
type Phase = "intro" | "demo" | "turn" | "try" | "result" | "error";
const running = (p: string) => p === "demo" || p === "try";
/** One player in a lesson: their controller and the instrument they play. */
export type LessonPlayer = {
  device: string;
  profile: Profile;
  part: string;
  mode: "tap" | "strum";
  name: string;
};
type Hud = {
  combo: number;
  multiplier: number;
  power: number;
  powerActive: boolean;
  hits: number;
  cue: string;
  soon: boolean;
};
const emptyHud = (): Hud => ({
  combo: 0,
  multiplier: 1,
  power: 0,
  powerActive: false,
  hits: 0,
  cue: "",
  soon: false,
});
/** The player's own controls, named in lesson text. */
function controls(p: LessonPlayer) {
  const pad = isPad(p.device);
  if (p.part === "Drums")
    return {
      frets: "",
      strum: "",
      pads:
        p.device === "midi"
          ? "your kit's pads and kick pedal"
          : pad
            ? "your controller's pad buttons"
            : "keys A S D F G (A is the kick)",
      power:
        p.device === "midi"
          ? "Shift on the keyboard"
          : pad
            ? "the Star Power button"
            : "Shift",
    };
  return {
    frets: pad ? "the fret buttons" : "keys A S D F G",
    strum:
      p.mode === "tap"
        ? "press it in time (tap mode needs no strum)"
        : pad
          ? "strum"
          : "press Space to strum",
    pads: "",
    power: pad ? "the Star Power button (or tilt)" : "Shift",
  };
}
const fill = (text: string, p: LessonPlayer) => {
  const w = controls(p);
  return text
    .replace("{frets}", w.frets)
    .replace("{strum}", w.strum)
    .replace("{pads}", w.pads)
    .replace("{power}", w.power);
};
/** A Soundcheck lesson for the whole band: an explanation for each
 * instrument, a demo the game plays itself on every player's highway, then
 * everyone's turn, each graded against their own lesson's goal. */
export default function LessonRun({
  step,
  players,
  midi,
  offset,
  nextLabel,
  onPassed,
  onNext,
  onExit,
}: {
  /** Which lesson in each instrument's set. */
  step: number;
  players: LessonPlayer[];
  midi?: MidiPort;
  offset: number;
  /** What comes after a pass: the next lesson or the full track. */
  nextLabel: string;
  /** Called with the guitar lesson id when every player passes. */
  onPassed: (id: string) => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const multi = players.length > 1;
  const own: Lesson[] = players.map((p) => lessonsFor(p.part)[step]);
  const anyPad = players.some((p) => isPad(p.device));
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const status = useRef<Phase>("intro");
  const actions = useRef({ run: (_: "demo" | "try") => {}, stop: () => {} });
  const [phase, setPhase] = useState<Phase>("intro"),
    [message, setMessage] = useState(""),
    [huds, setHuds] = useState<Hud[]>(() => players.map(emptyHud)),
    [results, setResults] = useState<ReturnType<typeof lessonResult>[] | null>(
      null,
    );
  const setState = (value: Phase) => {
    status.current = value;
    setPhase(value);
  };
  useEffect(() => {
    if (!running(phase)) setTimeout(() => focusFirst(), 40);
  }, [phase]);
  useEffect(() => {
    const charts = own.map(lessonChart);
    const strum = players.map((p) => p.part !== "Drums" && p.mode === "strum");
    let all: PlayerRuntime[];
    try {
      const ratio = [1.5, 1.5, 1.25, 1, 1][players.length];
      all = players.map(
        (p, i) =>
          new PlayerRuntime(
            {
              device: p.device,
              chart: charts[i],
              profile: p.profile,
              label: p.name,
            },
            canvases.current[i]!,
            strum[i] ? "strum" : "tap",
            32,
            ratio,
          ),
      );
    } catch {
      setMessage(
        "Graphics could not start. Enable hardware acceleration or try another computer.",
      );
      setState("error");
      return;
    }
    const music = new SongAudio();
    const clock = () => music.time - offset / 1000;
    const end = Math.max(...own.map(lessonEnd));
    const keys = all.find((r) => r.device === "keyboard");
    const drums = all.filter((r) => r.device === "midi");
    let demos = charts.map((c, i) => new DemoPlayer(c.notes, strum[i], false)),
      usedPower = players.map(() => false),
      frame = 0,
      lastUI = 0;
    const stop = (reason = "") => {
      if (!running(status.current)) return;
      music.pause();
      all.forEach((r) => r.release());
      setMessage(reason);
      setState("turn");
    };
    const run = async (kind: "demo" | "try") => {
      music.pause();
      music.element.currentTime = 0;
      all.forEach((r) => r.reset());
      demos = charts.map(
        (c, i) =>
          new DemoPlayer(c.notes, strum[i], own[i].goal.kind === "power"),
      );
      usedPower = players.map(() => false);
      setResults(null);
      try {
        await music.play();
        setMessage("");
        setState(kind);
      } catch (error) {
        console.error("Backstage lesson audio failed", error);
        setMessage(
          "Audio could not start. Check your output device and try again.",
        );
      }
    };
    actions.current = { run: (k) => void run(k), stop };
    const finish = (t: number) => {
      music.pause();
      all.forEach((r) => r.judge.finish(t));
      if (status.current === "demo") {
        setState("turn");
        return;
      }
      const graded = all.map((r, i) =>
        lessonResult(own[i], {
          hits: r.judge.hits,
          score: r.judge.score,
          maxCombo: r.judge.maxCombo,
          usedPower: usedPower[i],
        }),
      );
      setResults(graded);
      if (graded.every((g) => g.passed)) onPassed(lessons[step].id);
      setState("result");
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        [
          "Space",
          "Escape",
          "ShiftLeft",
          "ShiftRight",
          "KeyW",
          ...keyboardLanes,
          "ArrowUp",
          "ArrowDown",
        ].includes(event.code)
      )
        event.preventDefault();
      if (event.repeat) return;
      const now = status.current;
      if (event.code === "Escape") {
        if (running(now)) stop();
        else onExit();
        return;
      }
      if (now === "try") {
        keys?.keyDown(event.code, clock());
        return;
      }
      if (now === "demo") return;
      if (event.code === "ArrowUp" || event.code === "ArrowDown")
        moveFocus(event.code === "ArrowUp" ? -1 : 1);
      else if (
        event.code === "Enter" &&
        !(event.target as HTMLElement)?.closest?.("button")
      )
        activateFocused();
    };
    const keyup = (event: KeyboardEvent) => {
      if (status.current === "try") keys?.keyUp(event.code, clock());
      else keys?.keys.delete(event.code);
    };
    const midiMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || status.current !== "try") return;
      if ((data[0] & 0xf0) !== 0x90 || data[2] === 0) return;
      const lane = drumNotes[data[1]];
      if (lane !== undefined) drums.forEach((r) => r.midiHit(lane, clock()));
    };
    if (drums.length && midi)
      midi.input.addEventListener("midimessage", midiMessage);
    const away = () => stop("Paused while Backstage was in the background.");
    const hidden = () => {
      if (document.hidden) away();
    };
    const tick = (now: number) => {
      const t = clock();
      const playing = status.current === "try";
      let lost = "";
      for (const r of all) {
        const edges = r.poll(t, playing);
        if (!edges.connected) lost ||= r.init.label;
        if (status.current === "demo") {
          // Any menu button skips the demo; the game is playing, not the band.
          if (edges.start || edges.red) stop();
        } else if (playing) {
          if (edges.start) stop();
        } else if (status.current !== "error") {
          // Any player's controller drives the lesson menus.
          if (edges.up) moveFocus(-1);
          else if (edges.down) moveFocus(1);
          else if (edges.green || edges.start) activateFocused();
          else if (edges.red) onExit();
        }
      }
      if (lost && running(status.current))
        stop(`${lost}’s controller disconnected. Reconnect it to continue.`);
      all.forEach((r, i) => {
        if (status.current === "demo") r.demo(t, demos[i].input(t));
        else r.frame(t, playing, now);
        usedPower[i] ||= r.judge.powerActive;
      });
      if (running(status.current) && t >= end) finish(t);
      if (now - lastUI > 80) {
        setHuds(
          all.map((r, i) => {
            const next = charts[i].notes.find((n) => n.time > t - 0.05);
            return {
              combo: r.judge.combo,
              multiplier: r.judge.multiplier,
              power: r.judge.power,
              powerActive: r.judge.powerActive,
              hits: r.judge.hits,
              cue:
                running(status.current) && next
                  ? cueFor(next, strum[i], players[i].part === "Drums")
                  : "",
              soon: !!next && next.time - t < 0.6,
            };
          }),
        );
        lastUI = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame);
      music.dispose();
      all.forEach((r) => r.dispose());
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", hidden);
      midi?.input.removeEventListener("midimessage", midiMessage);
    };
  }, []);
  // One explanation per instrument in the band.
  const groups = [...new Set(own)].map((lesson) => ({
    lesson,
    who: players.filter((_, i) => own[i] === lesson),
  }));
  const title = groups.map((g) => g.lesson.title).join(" · ");
  const goalOf = (l: Lesson) => goalText(l.goal, l.notes.length);
  const passedAll = !!results && results.every((r) => r.passed);
  const hints = (
    <ButtonHints
      pad={anyPad}
      hints={[
        { button: "up", label: "Up / Down" },
        { button: "green", label: "Select" },
        { button: "red", label: "Back", key: "Esc" },
      ]}
    />
  );
  const hud = (i: number) => {
    const h = huds[i],
      l = own[i];
    return (
      <>
        <div className={"lesson-cue" + (h.soon ? " soon" : "")}>{h.cue}</div>
        <aside
          className="lesson-hud"
          aria-label={`${players[i].name} progress`}
        >
          <div>
            <small>STREAK</small>
            <b>{h.combo}</b>
          </div>
          <div>
            <small>MULTIPLIER</small>
            <b>{h.multiplier}×</b>
          </div>
          <div>
            <small>HIT</small>
            <b>
              {h.hits}/{l.notes.length}
            </b>
          </div>
          {l.goal.kind === "power" && (
            <div className="lesson-power">
              <small>STAR POWER</small>
              <div
                role="meter"
                aria-label="Star Power"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(h.power * 100)}
              >
                <span style={{ width: `${h.power * 100}%` }} />
              </div>
            </div>
          )}
        </aside>
      </>
    );
  };
  return (
    <div
      className={
        "game-screen lesson-screen" +
        (multi ? ` multi players-${players.length}` : "") +
        (phase === "demo" ? " demo" : "") +
        (!multi && running(phase) && huds[0].powerActive ? " power-active" : "")
      }
    >
      <header className="game-header">
        <button className="quiet" onClick={onExit}>
          ← Soundcheck
        </button>
        <div>
          <strong>{title}</strong>
          <small>
            Lesson {step + 1} of {lessons.length}
            {multi ? ` · ${players.length} players` : ` · ${goalOf(own[0])}`}
          </small>
        </div>
        {running(phase) ? (
          <button className="quiet" onClick={() => actions.current.stop()}>
            {phase === "demo" ? "Skip demo ⏭" : "Stop ⏹"}
          </button>
        ) : (
          <span />
        )}
      </header>
      {running(phase) && (
        <div className="lesson-badge">
          {phase === "demo" ? "▶ DEMO · WATCH AND LISTEN" : "YOUR TURN"}
        </div>
      )}
      {multi ? (
        <div className="player-grid">
          {players.map((p, i) => (
            <section
              key={i}
              className={
                "player-lane" +
                (running(phase) && huds[i].powerActive ? " power-active" : "")
              }
              aria-label={`${p.name} lesson`}
            >
              <canvas
                ref={(el) => {
                  canvases.current[i] = el;
                }}
                className="highway-mp"
              />
              <header className="player-tag">
                <b>{p.name}</b>
                <span>{own[i].title}</span>
              </header>
              {running(phase) && hud(i)}
            </section>
          ))}
        </div>
      ) : (
        <>
          <canvas
            ref={(el) => {
              canvases.current[0] = el;
            }}
            className="highway"
          />
          {running(phase) && hud(0)}
        </>
      )}
      {!running(phase) && (
        <div className="game-overlay">
          <div
            className="game-dialog lesson-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            {phase === "intro" && (
              <>
                <span className="eyebrow">
                  LESSON {step + 1} OF {lessons.length}
                </span>
                <h1>{title}</h1>
                {groups.map((g) => (
                  <div key={g.lesson.id} className="lesson-group">
                    {groups.length > 1 && (
                      <h3>
                        {g.lesson.instrument === "drums" ? "Drums" : "Guitar"}
                        {" · "}
                        {g.who.map((p) => p.name).join(", ")}
                      </h3>
                    )}
                    <ol className="lesson-steps">
                      {g.lesson.steps.map((s) => (
                        <li key={s}>{fill(s, g.who[0])}</li>
                      ))}
                    </ol>
                    <p className="lesson-goal">Goal: {goalOf(g.lesson)}</p>
                  </div>
                ))}
                {message && <p>{message}</p>}
                <div className="menu-list">
                  <button
                    className="primary"
                    data-menu-default
                    onClick={() => actions.current.run("demo")}
                  >
                    Watch the demo →
                  </button>
                  <button
                    className="secondary"
                    onClick={() => actions.current.run("try")}
                  >
                    Skip to {multi ? "our" : "my"} turn
                  </button>
                  <button className="secondary" onClick={onExit}>
                    Back to Soundcheck
                  </button>
                </div>
              </>
            )}
            {phase === "turn" && (
              <>
                <span className="eyebrow">YOUR TURN</span>
                <h1>Now you try.</h1>
                {message && <p>{message}</p>}
                {groups.map((g) => (
                  <p key={g.lesson.id} className="lesson-goal">
                    {groups.length > 1 &&
                      `${g.lesson.instrument === "drums" ? "Drums" : "Guitar"}: `}
                    {goalOf(g.lesson)}
                  </p>
                ))}
                <div className="menu-list">
                  <button
                    className="primary"
                    data-menu-default
                    onClick={() => actions.current.run("try")}
                  >
                    Start →
                  </button>
                  <button
                    className="secondary"
                    onClick={() => actions.current.run("demo")}
                  >
                    Watch the demo again
                  </button>
                  <button className="secondary" onClick={onExit}>
                    Back to Soundcheck
                  </button>
                </div>
              </>
            )}
            {phase === "result" && results && (
              <>
                <span className="eyebrow">
                  {passedAll ? "LESSON COMPLETE" : "NOT QUITE"}
                </span>
                <h1>{passedAll ? "Nailed it." : "So close."}</h1>
                <div className="lesson-results">
                  {results.map((r, i) => (
                    <p
                      key={i}
                      className={"lesson-score" + (r.passed ? " passed" : "")}
                    >
                      {multi && <b>{players[i].name} · </b>}
                      {r.value}
                    </p>
                  ))}
                </div>
                <div className="menu-list">
                  {passedAll && (
                    <button
                      className="primary"
                      data-menu-default
                      onClick={onNext}
                    >
                      {nextLabel} →
                    </button>
                  )}
                  <button
                    className={passedAll ? "secondary" : "primary"}
                    data-menu-default={passedAll ? undefined : ""}
                    onClick={() => actions.current.run("try")}
                  >
                    Try again
                  </button>
                  <button
                    className="secondary"
                    onClick={() => actions.current.run("demo")}
                  >
                    Watch the demo
                  </button>
                  <button className="secondary" onClick={onExit}>
                    Back to Soundcheck
                  </button>
                </div>
              </>
            )}
            {phase === "error" && (
              <>
                <span className="eyebrow">STAGE UNAVAILABLE</span>
                <h1>Can’t start.</h1>
                <p>{message}</p>
                <div className="menu-list">
                  <button
                    className="secondary"
                    data-menu-default
                    onClick={onExit}
                  >
                    Back to Soundcheck
                  </button>
                </div>
              </>
            )}
            {hints}
          </div>
        </div>
      )}
    </div>
  );
}
