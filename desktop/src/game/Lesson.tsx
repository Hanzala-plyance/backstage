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
  type Lesson,
} from "../core/lessons";
import ButtonHints from "../ButtonHints";
import { PlayerRuntime } from "./player";
type Phase = "intro" | "demo" | "turn" | "try" | "result" | "error";
const running = (p: string) => p === "demo" || p === "try";
/** The player's own controls, named in lesson text. */
function controls(device: string, mode: "tap" | "strum") {
  const pad = isPad(device);
  return {
    frets: pad ? "the fret buttons" : "keys A S D F G",
    strum:
      mode === "tap"
        ? "press it in time (tap mode needs no strum)"
        : pad
          ? "strum"
          : "press Space to strum",
    power: pad ? "the Star Power button (or tilt)" : "Shift",
  };
}
/** One Soundcheck lesson: explanation, a demo the game plays itself on the
 * real highway, then the player's turn graded against the lesson goal. */
export default function LessonRun({
  lesson,
  device,
  profile,
  mode,
  offset,
  nextLabel,
  onPassed,
  onNext,
  onExit,
}: {
  lesson: Lesson;
  device: string;
  profile: Profile;
  mode: "tap" | "strum";
  offset: number;
  /** What comes after a pass: the next lesson or the full track. */
  nextLabel: string;
  onPassed: (id: string) => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const number = lessons.indexOf(lesson) + 1;
  const pad = isPad(device);
  const words = controls(device, mode);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const runtime = useRef<PlayerRuntime | null>(null);
  const audio = useRef<SongAudio | null>(null);
  const status = useRef<Phase>("intro");
  const actions = useRef({ run: (_: "demo" | "try") => {}, stop: () => {} });
  const [phase, setPhase] = useState<Phase>("intro"),
    [message, setMessage] = useState(""),
    [cue, setCue] = useState({ text: "", soon: false }),
    [hud, setHud] = useState({
      combo: 0,
      multiplier: 1,
      power: 0,
      powerActive: false,
      hits: 0,
    }),
    [result, setResult] = useState<ReturnType<typeof lessonResult> | null>(
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
    const chart = lessonChart(lesson);
    const strumMode = mode === "strum";
    let r: PlayerRuntime;
    try {
      r = new PlayerRuntime(
        { device, chart, profile, label: "You" },
        canvas.current!,
        mode,
        32,
        1.5,
      );
    } catch {
      setMessage(
        "Graphics could not start. Enable hardware acceleration or try another computer.",
      );
      setState("error");
      return;
    }
    runtime.current = r;
    const music = new SongAudio();
    audio.current = music;
    const clock = () => music.time - offset / 1000;
    const end = lessonEnd(lesson);
    let demo = new DemoPlayer(chart.notes, strumMode, false),
      usedPower = false,
      frame = 0,
      lastUI = 0;
    const stop = (reason = "") => {
      if (!running(status.current)) return;
      music.pause();
      r.release();
      setMessage(reason);
      setState("turn");
    };
    const run = async (kind: "demo" | "try") => {
      music.pause();
      music.element.currentTime = 0;
      r.reset();
      demo = new DemoPlayer(
        chart.notes,
        strumMode,
        lesson.goal.kind === "power",
      );
      usedPower = false;
      setResult(null);
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
      r.judge.finish(t);
      if (status.current === "demo") {
        setState("turn");
        return;
      }
      const graded = lessonResult(lesson, {
        hits: r.judge.hits,
        score: r.judge.score,
        maxCombo: r.judge.maxCombo,
        usedPower,
      });
      setResult(graded);
      if (graded.passed) onPassed(lesson.id);
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
        if (device === "keyboard") r.keyDown(event.code, clock());
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
      if (status.current === "try" && device === "keyboard")
        r.keyUp(event.code, clock());
      else r.keys.delete(event.code);
    };
    const away = () => stop("Paused while Backstage was in the background.");
    const hidden = () => {
      if (document.hidden) away();
    };
    const tick = (now: number) => {
      const t = clock();
      const playing = status.current === "try";
      const edges = r.poll(t, playing);
      if (!edges.connected && running(status.current))
        stop("Controller disconnected. Reconnect it to continue.");
      else if (status.current === "demo") {
        // Any menu button skips the demo; the game is playing, not the player.
        if (edges.start || edges.red) stop();
      } else if (playing) {
        if (edges.start) stop();
      } else if (status.current !== "error") {
        if (edges.up) moveFocus(-1);
        else if (edges.down) moveFocus(1);
        else if (edges.green || edges.start) activateFocused();
        else if (edges.red) onExit();
      }
      if (status.current === "demo") r.demo(t, demo.input(t));
      else r.frame(t, playing, now);
      usedPower ||= r.judge.powerActive;
      if (running(status.current) && t >= end) finish(t);
      if (now - lastUI > 80) {
        const next = chart.notes.find((n) => n.time > t - 0.05);
        setCue(
          running(status.current) && next
            ? { text: cueFor(next, strumMode), soon: next.time - t < 0.6 }
            : { text: "", soon: false },
        );
        setHud({
          combo: r.judge.combo,
          multiplier: r.judge.multiplier,
          power: r.judge.power,
          powerActive: r.judge.powerActive,
          hits: r.judge.hits,
        });
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
      r.dispose();
      runtime.current = null;
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const fill = (text: string) =>
    text
      .replace("{frets}", words.frets)
      .replace("{strum}", words.strum)
      .replace("{power}", words.power);
  const goal = goalText(lesson.goal, lesson.notes.length);
  const hints = (
    <ButtonHints
      pad={pad}
      hints={[
        { button: "up", label: "Up / Down" },
        { button: "green", label: "Select" },
        { button: "red", label: "Back", key: "Esc" },
      ]}
    />
  );
  return (
    <div
      className={
        "game-screen lesson-screen" +
        (phase === "demo" ? " demo" : "") +
        (running(phase) && hud.powerActive ? " power-active" : "")
      }
    >
      <header className="game-header">
        <button className="quiet" onClick={onExit}>
          ← Soundcheck
        </button>
        <div>
          <strong>{lesson.title}</strong>
          <small>
            Lesson {number} of {lessons.length} · {goal}
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
      <canvas ref={canvas} className="highway" />
      {running(phase) && (
        <>
          <div className="lesson-badge">
            {phase === "demo" ? "▶ DEMO · WATCH THE FRETS" : "YOUR TURN"}
          </div>
          <div className={"lesson-cue" + (cue.soon ? " soon" : "")}>
            {cue.text}
          </div>
          <aside className="lesson-hud" aria-label="Lesson progress">
            <div>
              <small>STREAK</small>
              <b>{hud.combo}</b>
            </div>
            <div>
              <small>MULTIPLIER</small>
              <b>{hud.multiplier}×</b>
            </div>
            <div>
              <small>HIT</small>
              <b>
                {hud.hits}/{lesson.notes.length}
              </b>
            </div>
            {lesson.goal.kind === "power" && (
              <div className="lesson-power">
                <small>STAR POWER</small>
                <div
                  role="meter"
                  aria-label="Star Power"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(hud.power * 100)}
                >
                  <span style={{ width: `${hud.power * 100}%` }} />
                </div>
              </div>
            )}
          </aside>
        </>
      )}
      {!running(phase) && (
        <div className="game-overlay">
          <div
            className="game-dialog lesson-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={lesson.title}
          >
            {phase === "intro" && (
              <>
                <span className="eyebrow">
                  LESSON {number} OF {lessons.length}
                </span>
                <h1>{lesson.title}</h1>
                <ol className="lesson-steps">
                  {lesson.steps.map((s) => (
                    <li key={s}>{fill(s)}</li>
                  ))}
                </ol>
                <p className="lesson-goal">Goal: {goal}</p>
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
                    Skip to my turn
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
                <p>{message || fill(lesson.steps[lesson.steps.length - 1])}</p>
                <p className="lesson-goal">Goal: {goal}</p>
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
            {phase === "result" && result && (
              <>
                <span className="eyebrow">
                  {result.passed ? "LESSON COMPLETE" : "NOT QUITE"}
                </span>
                <h1>{result.passed ? "Nailed it." : "So close."}</h1>
                <p
                  className={"lesson-score" + (result.passed ? " passed" : "")}
                >
                  {result.value}
                </p>
                <p className="lesson-goal">Goal: {goal}</p>
                <div className="menu-list">
                  {result.passed && (
                    <button
                      className="primary"
                      data-menu-default
                      onClick={onNext}
                    >
                      {nextLabel} →
                    </button>
                  )}
                  <button
                    className={result.passed ? "secondary" : "primary"}
                    data-menu-default={result.passed ? undefined : ""}
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
