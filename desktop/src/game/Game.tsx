import { useEffect, useRef, useState } from "react";
import type { LoadedSong, Profile } from "../types";
import { SongAudio } from "../core/audio";
import { Judgment } from "../core/judgment";
import { keyboardLanes, readPad } from "../core/input";
import { createHighway } from "./highway";
import { activateFocused, focusFirst, moveFocus } from "../core/menu";
import ButtonHints, { type Hint } from "../ButtonHints";
export type MidiPort = { id: string; name: string; input: MIDIInput };
const drumNotes: Record<number, number> = {
  35: 0,
  36: 0,
  38: 1,
  40: 1,
  42: 2,
  44: 2,
  46: 2,
  45: 3,
  47: 3,
  48: 3,
  50: 3,
  49: 4,
  51: 4,
  52: 4,
  55: 4,
  57: 4,
  59: 4,
};
const audioMessages = {
  file: "This song’s audio could not be played. Check the file or choose another song.",
  blocked: "Audio was blocked. Press Start playing again.",
  device: "Audio could not start. Check your output device and try again.",
};
export default function Game({
  song,
  device,
  profile,
  midi,
  offset,
  mode,
  onExit,
}: {
  song: LoadedSong;
  device: string;
  profile: Profile;
  midi?: MidiPort;
  offset: number;
  mode: "tap" | "strum";
  onExit: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<SongAudio | null>(null);
  const highway = useRef<ReturnType<typeof createHighway> | null>(null);
  const judge = useRef(new Judgment(song.chart.notes, 0.14, song.chart));
  const status = useRef("ready");
  const [phase, setPhase] = useState("ready"),
    [message, setMessage] = useState(""),
    [stats, setStats] = useState({
      score: 0,
      combo: 0,
      accuracy: 100,
      last: "Ready",
      time: 0,
      multiplier: 1,
      power: 0,
      powerActive: false,
    }),
    [volume, setVolume] = useState(0.65);
  const setState = (value: string) => {
    status.current = value;
    setPhase(value);
  };
  const keyboard = useRef(new Set<string>()),
    pulse = useRef([0, 0, 0, 0, 0]);
  const connected = useRef(true);
  const pause = (reason = "") => {
    if (status.current === "playing") {
      audio.current?.pause();
      keyboard.current.clear();
      pulse.current.fill(0);
      setState("paused");
      setMessage(reason);
    }
  };
  const starting = useRef(false);
  const start = async () => {
    if (!["ready", "paused"].includes(status.current) || starting.current)
      return;
    if (!connected.current) {
      setMessage(
        "Reconnect your selected input, or return to Controllers to choose another.",
      );
      return;
    }
    const music = audio.current;
    if (!music) return;
    starting.current = true;
    try {
      await music.play();
      setMessage("");
      setState("playing");
    } catch (error) {
      console.error("Backstage audio start failed", error, music.element.error);
      setMessage(audioMessages[music.failure(error)]);
    } finally {
      starting.current = false;
    }
  };
  const exit = () => {
    pause();
    onExit();
  };
  const restart = () => {
    const music = audio.current;
    if (!music) return;
    music.pause();
    music.element.currentTime = 0;
    judge.current = new Judgment(song.chart.notes, 0.14, song.chart);
    highway.current?.reset();
    keyboard.current.clear();
    setState("ready");
    void start();
  };
  // Red backs out of a menu: resume from pause, otherwise leave the stage.
  const back = () => {
    if (status.current === "paused") void start();
    else if (status.current !== "playing") exit();
  };
  useEffect(() => {
    if (phase !== "playing") setTimeout(() => focusFirst(), 40);
  }, [phase]);
  useEffect(() => {
    let visual: ReturnType<typeof createHighway>;
    try {
      const last = song.chart.notes[song.chart.notes.length - 1];
      visual = createHighway(
        canvas.current!,
        song.chart.notes,
        judge.current.timeline.beatGrid(
          (last ? last.time + last.duration : song.duration) + 5,
        ),
      );
    } catch {
      setMessage(
        "Graphics could not start. Enable hardware acceleration or try another computer.",
      );
      setState("error");
      return;
    }
    highway.current = visual;
    const music = new SongAudio(song.audioUrl);
    audio.current = music;
    let seeded = false;
    let frame = 0,
      lastUI = 0,
      prev = {
        lanes: [false, false, false, false, false],
        strum: false,
        pause: false,
        strumUp: false,
        strumDown: false,
        starPower: false,
      };
    const strike = (held: boolean[]) =>
      judge.current.strike(
        music.time - offset / 1000,
        held,
        mode === "strum" && song.chart.part !== "Drums",
      );
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
      if (
        event.code === "Enter" &&
        status.current !== "playing" &&
        !(event.target as HTMLElement)?.closest?.("button")
      ) {
        event.preventDefault();
        void start();
        return;
      }
      if (event.code === "Escape") {
        if (status.current === "playing") pause();
        else back();
        return;
      }
      if (
        status.current !== "playing" &&
        (event.code === "ArrowUp" || event.code === "ArrowDown")
      ) {
        moveFocus(event.code === "ArrowUp" ? -1 : 1);
        return;
      }
      keyboard.current.add(event.code);
      if (status.current !== "playing" || device !== "keyboard") return;
      const lanes = keyboardLanes.map((k) => keyboard.current.has(k));
      const time = music.time - offset / 1000;
      if (event.code.startsWith("Shift")) judge.current.activate(time);
      if (event.code === "KeyW") judge.current.update(time, lanes, true);
      if (mode === "strum" && song.chart.part !== "Drums") {
        if (["Space", "ArrowUp", "ArrowDown"].includes(event.code))
          strike(lanes);
        else if (keyboardLanes.includes(event.code))
          judge.current.fret(time, lanes);
      } else if (keyboardLanes.includes(event.code)) strike(lanes);
    };
    const keyup = (event: KeyboardEvent) => {
      keyboard.current.delete(event.code);
      if (status.current !== "playing" || device !== "keyboard") return;
      const held = keyboardLanes.map((k) => keyboard.current.has(k));
      const time = music.time - offset / 1000;
      if (
        mode === "strum" &&
        song.chart.part !== "Drums" &&
        keyboardLanes.includes(event.code)
      )
        judge.current.fret(time, held);
      else judge.current.update(time, held, keyboard.current.has("KeyW"));
    };
    const blur = () => pause("Paused while Backstage was in the background.");
    const hidden = () => {
      if (document.hidden) blur();
    };
    const midiMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || status.current !== "playing") return;
      const command = data[0] & 0xf0;
      if (command !== 0x90 || data[2] === 0) return;
      let map = drumNotes;
      try {
        map = {
          ...drumNotes,
          ...JSON.parse(
            localStorage.getItem("backstage:midi:" + midi?.id) || "{}",
          ),
        };
      } catch {}
      const lane = map[data[1]];
      if (lane === undefined) return;
      pulse.current[lane] = performance.now() + 80;
      const lanes = pulse.current.map((t) => t > performance.now());
      strike(lanes);
    };
    if (device === "midi" && midi)
      midi.input.addEventListener("midimessage", midiMessage);
    const ended = () => {
      judge.current.finish(music.time - offset / 1000);
      setState("finished");
      setStats((s) => ({
        ...s,
        score: judge.current.score,
        combo: judge.current.maxCombo,
        accuracy: judge.current.accuracy,
      }));
    };
    music.element.addEventListener("ended", ended);
    const failed = () => {
      pause();
      setMessage(audioMessages.file);
    };
    music.element.addEventListener("error", failed);
    const tick = (now: number) => {
      let held = keyboardLanes.map((k) => keyboard.current.has(k));
      connected.current = true;
      if (device.startsWith("pad:")) {
        const index = Number(device.split(":")[1]);
        const pad = navigator.getGamepads()[index];
        const valid =
          pad && device === `pad:${pad.index}:${pad.id}` ? pad : null;
        const state = readPad(valid, profile);
        connected.current = state.connected;
        if (!state.connected) {
          pause("Controller disconnected. Reconnect it to continue.");
          seeded = false;
          prev = {
            lanes: [false, false, false, false, false],
            strum: false,
            pause: false,
            strumUp: false,
            strumDown: false,
            starPower: false,
          };
        } else {
          held = state.lanes;
          // Ignore buttons already held when the stage opened.
          if (!seeded) {
            prev = state;
            seeded = true;
          }
          if (state.pause && !prev.pause) {
            if (status.current === "playing") pause();
            else void start();
          } else if (status.current !== "playing") {
            if (state.strumUp && !prev.strumUp) moveFocus(-1);
            else if (state.strumDown && !prev.strumDown) moveFocus(1);
            else if (state.lanes[0] && !prev.lanes[0]) activateFocused();
            else if (state.lanes[1] && !prev.lanes[1]) back();
          }
          if (status.current === "playing") {
            if (mode === "strum" && song.chart.part !== "Drums") {
              if (
                (state.strumUp && !prev.strumUp) ||
                (state.strumDown && !prev.strumDown)
              )
                strike(held);
              else if (held.some((v, i) => v !== prev.lanes[i]))
                judge.current.fret(music.time - offset / 1000, held);
            } else if (held.some((v, i) => v && !prev.lanes[i])) strike(held);
            if (state.starPower && !prev.starPower)
              judge.current.activate(music.time - offset / 1000);
            judge.current.update(
              music.time - offset / 1000,
              held,
              state.whammy,
            );
          }
          prev = state;
        }
      } else if (device === "midi") {
        connected.current = !!midi && midi.input.state === "connected";
        held = pulse.current.map((t) => t > now);
        if (!connected.current)
          pause("MIDI device disconnected. Reconnect it to continue.");
      }
      const time = music.time - offset / 1000;
      if (status.current === "playing") {
        if (device === "keyboard")
          judge.current.update(time, held, keyboard.current.has("KeyW"));
        else judge.current.advance(time);
      }
      const j = judge.current;
      visual.render(time, j.state, held, {
        power: j.powerActive,
        lastHit: j.lastHit,
        lanes: j.lastLanes,
        tailActive: (index, lane) => j.sustainActive(index, lane),
        streak: j.combo,
      });
      if (now - lastUI > 80) {
        const j = judge.current;
        setStats({
          score: j.score,
          combo: status.current === "finished" ? j.maxCombo : j.combo,
          accuracy: j.accuracy,
          last: j.last,
          time: music.time,
          multiplier: j.multiplier,
          power: j.power,
          powerActive: j.powerActive,
        });
        lastUI = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame);
      music.dispose();
      visual.dispose();
      highway.current = null;
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
      midi?.input.removeEventListener("midimessage", midiMessage);
    };
  }, []);
  return (
    <div className={"game-screen" + (stats.powerActive ? " power-active" : "")}>
      <header className="game-header">
        <button
          className="quiet"
          onClick={() => {
            pause();
            onExit();
          }}
        >
          ← Library
        </button>
        <div>
          <strong>{song.title}</strong>
          <small>
            {song.artist} · {song.chart.part} / {song.chart.level}
          </small>
        </div>
        <button className="quiet" onClick={() => pause()}>
          Pause ⏸
        </button>
      </header>
      <div className="game-metrics">
        <div>
          <small>SCORE</small>
          <b>{stats.score.toLocaleString()}</b>
        </div>
        <div>
          <small>STREAK</small>
          <b>
            {stats.combo}
            <em>×</em>
          </b>
        </div>
        <div>
          <small>ACCURACY</small>
          <b>
            {stats.accuracy}
            <em>%</em>
          </b>
        </div>
      </div>
      <aside
        className="amplifier"
        aria-label="Guitar scoring"
        data-tier={Math.min(3, Math.floor(stats.combo / 10))}
      >
        <span className="eyebrow">MULTIPLIER</span>
        <strong>
          {stats.multiplier}
          <i>×</i>
        </strong>
        <div className="streak-pips">
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className={stats.combo >= 30 || i < stats.combo % 10 ? "lit" : ""}
            />
          ))}
        </div>
        <span>
          {stats.combo >= 30
            ? "MAXIMUM GAIN"
            : `${10 - (stats.combo % 10)} TO NEXT MULTIPLIER`}
        </span>
        <div className={"power-meter" + (stats.power >= 0.5 ? " charged" : "")}>
          <label>
            ϟ STAR POWER <b>{Math.round(stats.power * 100)}%</b>
          </label>
          <div
            role="meter"
            aria-label="Star Power"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(stats.power * 100)}
          >
            <span style={{ width: `${stats.power * 100}%` }} />
          </div>
          <button
            disabled={
              phase !== "playing" || stats.power < 0.5 || stats.powerActive
            }
            onClick={() =>
              judge.current.activate((audio.current?.time ?? 0) - offset / 1000)
            }
          >
            {stats.powerActive
              ? "LIVE · DOUBLE SCORE"
              : stats.power >= 0.5
                ? "IGNITE · SHIFT"
                : "HIT GLOWING PHRASES"}
          </button>
        </div>
      </aside>
      <canvas ref={canvas} className="highway" />
      <div className={"hit-label " + stats.last.toLowerCase()}>
        {phase === "playing" ? stats.last : ""}
      </div>
      {phase !== "playing" && (
        <div className="game-overlay">
          <div
            className="game-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Song menu"
          >
            <span className="eyebrow">
              {phase === "finished"
                ? "SET COMPLETE"
                : phase === "ready"
                  ? "YOUR STAGE IS READY"
                  : phase === "error"
                    ? "STAGE UNAVAILABLE"
                    : "TAKE A BREATH"}
            </span>
            <h1>
              {phase === "finished"
                ? "Nice set."
                : phase === "ready"
                  ? song.title
                  : phase === "error"
                    ? "Can’t start."
                    : "Paused."}
            </h1>
            <p>
              {message ||
                (phase === "ready"
                  ? mode === "strum" && song.chart.part !== "Drums"
                    ? "Strum solid gems. White caps are HOPOs; hollow caps are taps. Hold long notes and complete glowing phrases to earn Star Power."
                    : "Tap the matching controls as notes cross the line."
                  : "Your song and score are right where you left them.")}
            </p>
            {device === "keyboard" && (
              <div className="key-row">
                {["A", "S", "D", "F", "G"].map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
                {mode === "strum" && song.chart.part !== "Drums" && (
                  <>
                    <kbd>SPACE · STRUM</kbd>
                    <kbd>SHIFT · STAR POWER</kbd>
                    <kbd>W · WHAMMY</kbd>
                  </>
                )}
              </div>
            )}
            {phase === "finished" && (
              <div className="results">
                <b>
                  {stats.score.toLocaleString()}
                  <small>points</small>
                </b>
                <b>
                  {stats.accuracy}%<small>accuracy</small>
                </b>
                <b>
                  {judge.current.maxCombo}
                  <small>best streak</small>
                </b>
              </div>
            )}
            <div className="menu-list">
              {phase === "finished" ? (
                <button className="primary" data-menu-default onClick={restart}>
                  Play again
                </button>
              ) : phase !== "error" ? (
                <button className="primary" data-menu-default onClick={start}>
                  {phase === "ready" ? "Start playing" : "Resume song"} →
                </button>
              ) : null}
              {phase === "paused" && (
                <button className="secondary" onClick={restart}>
                  Restart song
                </button>
              )}
              <button
                className="secondary"
                data-menu-default={phase === "error" ? "" : undefined}
                onClick={exit}
              >
                Back to library
              </button>
            </div>
            <ButtonHints
              pad={device.startsWith("pad:")}
              hints={
                [
                  { button: "up", label: "Browse" },
                  { button: "green", label: "Select" },
                  {
                    button: "red",
                    label: phase === "paused" ? "Resume" : "Library",
                    key: "Esc",
                  },
                  ...(phase === "ready" || phase === "paused"
                    ? [
                        {
                          button: "start",
                          label: phase === "ready" ? "Start" : "Resume",
                          key: "Enter",
                        },
                      ]
                    : []),
                ] as Hint[]
              }
            />
          </div>
        </div>
      )}
      <footer className="game-footer">
        <span>
          {song.chart.part} · {song.chart.level}
        </span>
        <ButtonHints
          pad={device.startsWith("pad:")}
          hints={[{ button: "start", label: "Pause", key: "Esc" }]}
        />
        <span>
          {Math.floor(stats.time / 60)}:
          {String(Math.floor(stats.time % 60)).padStart(2, "0")} /{" "}
          {Math.floor((audio.current?.duration || song.duration) / 60)}:
          {String(
            Math.floor((audio.current?.duration || song.duration) % 60),
          ).padStart(2, "0")}
        </span>
        <label>
          Volume
          <input
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => {
              const value = Number(e.target.value);
              setVolume(value);
              audio.current?.volume(value);
            }}
          />
        </label>
      </footer>
    </div>
  );
}
