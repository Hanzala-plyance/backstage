import { useEffect, useRef, useState } from "react";
import type { LoadedSong } from "../types";
import { SongAudio } from "../core/audio";
import { keyboardLanes } from "../core/input";
import { activateFocused, focusFirst, moveFocus } from "../core/menu";
import { isPad } from "../core/players";
import ButtonHints, { type Hint } from "../ButtonHints";
import Stars from "../Stars";
import { defaultLook, instrumentFor, slotName } from "../core/avatars";
import { createStage, type Stage } from "./stage3d";
import { baseScore, starsFor } from "../core/stars";
import {
  PlayerRuntime,
  drumNotes,
  type MidiPort,
  type PlayerInit,
  type PlayerStats,
} from "./player";
export type { MidiPort } from "./player";
const audioMessages = {
  file: "This song’s audio could not be played. Check the file or choose another song.",
  blocked: "Audio was blocked. Press Start playing again.",
  device: "Audio could not start. Check your output device and try again.",
};
const emptyStats = (): PlayerStats => ({
  score: 0,
  combo: 0,
  hits: 0,
  misses: 0,
  maxCombo: 0,
  accuracy: 100,
  last: "Ready",
  multiplier: 1,
  power: 0,
  powerActive: false,
});
const tier = (combo: number) => Math.min(3, Math.floor(combo / 10));
export default function Game({
  song,
  players,
  midi,
  offset,
  mode,
  backTo = "Library",
  onExit,
}: {
  song: LoadedSong;
  players: PlayerInit[];
  midi?: MidiPort;
  offset: number;
  mode: "tap" | "strum";
  /** Where leaving the stage returns to. */
  backTo?: string;
  onExit: () => void;
}) {
  const multi = players.length > 1;
  const anyPad = players.some((p) => isPad(p.device));
  const keyboardPlayer = players.findIndex((p) => p.device === "keyboard");
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const runtimes = useRef<PlayerRuntime[]>([]);
  const audio = useRef<SongAudio | null>(null);
  const status = useRef("ready");
  const missing = useRef<string | null>(null);
  const [phase, setPhase] = useState("ready"),
    [message, setMessage] = useState(""),
    [stats, setStats] = useState<PlayerStats[]>(() => players.map(emptyStats)),
    [time, setTime] = useState(0),
    [results, setResults] = useState<{ stars: number; best: boolean }[]>([]),
    [volume, setVolume] = useState(0.65);
  // The band on stage, and comic captions that pop up over each performer.
  const stageCanvas = useRef<HTMLCanvasElement | null>(null);
  const stage = useRef<Stage | null>(null);
  const [anchors, setAnchors] = useState<{ x: number; y: number }[]>([]);
  const [captions, setCaptions] = useState<
    { id: number; player: number; text: string; kind: string }[]
  >([]);
  const captionId = useRef(0);
  const caption = (player: number, text: string, kind: string) => {
    const id = ++captionId.current;
    setCaptions((c) => [...c.slice(-5), { id, player, text, kind }]);
    setTimeout(() => setCaptions((c) => c.filter((x) => x.id !== id)), 1100);
  };
  const shown = useRef<PlayerStats[]>(players.map(emptyStats));
  const show = (next: PlayerStats[]) => {
    next.forEach((s, i) => {
      const before = shown.current[i];
      if (s.powerActive && !before.powerActive)
        caption(i, "SUPER STAR!", "power");
      else if (s.misses > before.misses)
        caption(i, ["OOF!", "WHOOPS!", "YIKES!"][s.misses % 3], "miss");
      else if (
        s.combo >= 10 &&
        Math.floor(s.combo / 10) > Math.floor(before.combo / 10)
      )
        caption(
          i,
          ["NICE!", "YEAH!", "ROCK ON!", "SHRED!", "UNSTOPPABLE!"][
            Math.min(4, Math.floor(s.combo / 10) - 1)
          ],
          "streak",
        );
    });
    shown.current = next;
    setStats(next);
  };
  const setState = (value: string) => {
    status.current = value;
    setPhase(value);
  };
  const pause = (reason = "") => {
    if (status.current === "playing") {
      audio.current?.pause();
      runtimes.current.forEach((r) => r.release());
      setState("paused");
      setMessage(reason);
    }
  };
  const starting = useRef(false);
  const start = async () => {
    if (!["ready", "paused"].includes(status.current) || starting.current)
      return;
    if (missing.current) {
      setMessage(
        multi
          ? `Reconnect ${missing.current}’s controller to continue.`
          : "Reconnect your selected input, or return to Controllers to choose another.",
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
  // Rate each player and keep their best result for this chart.
  const saveResults = async (final: PlayerStats[]) => {
    setResults(
      await Promise.all(
        players.map(async (p, i) => {
          const s = final[i];
          const stars = starsFor(s.score, baseScore(p.chart), p.chart.part);
          try {
            const saved = await window.backstage.saveScore({
              id: song.id,
              part: p.chart.part,
              level: p.chart.level,
              score: s.score,
              stars,
              accuracy: Math.round(s.accuracy),
              maxCombo: s.maxCombo,
            });
            return { stars, best: saved.best };
          } catch {
            return { stars, best: false };
          }
        }),
      ),
    );
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
    runtimes.current.forEach((r) => r.reset());
    shown.current = players.map(emptyStats);
    setStats(players.map(emptyStats));
    setResults([]);
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
    const ratio = [1.5, 1.5, 1.25, 1, 1][players.length];
    try {
      runtimes.current = players.map(
        (p, i) =>
          new PlayerRuntime(
            p,
            canvases.current[i]!,
            mode,
            song.duration,
            ratio,
          ),
      );
    } catch {
      runtimes.current.forEach((r) => r.dispose());
      runtimes.current = [];
      setMessage(
        "Graphics could not start. Enable hardware acceleration or try another computer.",
      );
      setState("error");
      return;
    }
    const all = runtimes.current;
    // The 3D band is decoration: if it can't start, the game plays on.
    let alive = true;
    const beat = 60 / (players[0].chart.tempos?.[0]?.bpm || 120);
    if (stageCanvas.current)
      createStage(
        stageCanvas.current,
        players.map((p, i) => ({
          look: p.look ?? defaultLook(i),
          instrument: instrumentFor(p.chart.part),
          gear: p.gear,
        })),
        { pixelRatio: 1 },
      )
        .then((s) => {
          if (!alive) return s.dispose();
          stage.current = s;
          setAnchors(s.anchors());
        })
        .catch((error) => console.warn("Backstage stage unavailable", error));
    const resized = () => {
      stage.current?.resize();
      if (stage.current) setAnchors(stage.current.anchors());
    };
    window.addEventListener("resize", resized);
    const music = new SongAudio(song.audioUrl);
    audio.current = music;
    const clock = () => music.time - offset / 1000;
    const keys = all[keyboardPlayer];
    const drums = all.find((r) => r.device === "midi");
    let frame = 0,
      lastUI = 0;
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
      if (status.current === "playing") keys?.keyDown(event.code, clock());
    };
    const keyup = (event: KeyboardEvent) => {
      if (status.current === "playing") keys?.keyUp(event.code, clock());
      else keys?.keys.delete(event.code);
    };
    const blur = () => pause("Paused while Backstage was in the background.");
    const hidden = () => {
      if (document.hidden) blur();
    };
    const midiMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || !drums || status.current !== "playing") return;
      if ((data[0] & 0xf0) !== 0x90 || data[2] === 0) return;
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
      if (lane !== undefined) drums.midiHit(lane, clock());
    };
    if (drums && midi) midi.input.addEventListener("midimessage", midiMessage);
    const snapshot = () =>
      all.map((r) => r.stats(status.current === "finished"));
    const ended = () => {
      all.forEach((r) => r.judge.finish(clock()));
      setState("finished");
      const final = snapshot();
      setStats(final);
      void saveResults(final);
    };
    music.element.addEventListener("ended", ended);
    const failed = () => {
      pause();
      setMessage(audioMessages.file);
    };
    music.element.addEventListener("error", failed);
    const tick = (now: number) => {
      const t = clock();
      let lost: string | null = null,
        lostMidi = false;
      for (const r of all) {
        const edges = r.poll(t, status.current === "playing");
        if (!edges.connected) lost ??= r.init.label;
        if (edges.start) {
          if (status.current === "playing") pause();
          else void start();
        } else if (status.current !== "playing") {
          // Any player's controller can drive the pause and results menus.
          if (edges.up) moveFocus(-1);
          else if (edges.down) moveFocus(1);
          else if (edges.green) activateFocused();
          else if (edges.red) back();
        }
      }
      if (drums && !(midi && midi.input.state === "connected")) {
        lost ??= drums.init.label;
        lostMidi = true;
      }
      missing.current = lost;
      if (lost)
        pause(
          multi
            ? `${lost}’s controller disconnected. Reconnect it to continue.`
            : lostMidi
              ? "MIDI device disconnected. Reconnect it to continue."
              : "Controller disconnected. Reconnect it to continue.",
        );
      for (const r of all) r.frame(t, status.current === "playing", now);
      const live = status.current === "playing";
      stage.current?.frame(
        live ? t : now / 1000,
        all.map((r) => ({
          hits: r.judge.hits,
          misses: r.judge.misses,
          combo: r.judge.combo,
          powerActive: r.judge.powerActive,
          lanes: r.judge.lastLanes,
        })),
        live,
        beat,
      );
      if (now - lastUI > 80) {
        show(snapshot());
        setTime(music.time);
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
      alive = false;
      stage.current?.dispose();
      stage.current = null;
      window.removeEventListener("resize", resized);
      music.dispose();
      all.forEach((r) => r.dispose());
      runtimes.current = [];
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
      midi?.input.removeEventListener("midimessage", midiMessage);
    };
  }, []);
  const solo = stats[0];
  // Solo performers stand beside the highway, on the side they chose.
  const soloSide = multi
    ? ""
    : ` solo side-${players[0].gear?.side ?? "right"}`;
  const band = (
    <>
      <canvas
        ref={stageCanvas}
        className={"band-stage" + soloSide}
        aria-hidden="true"
      />
      <div className={"band-tags" + soloSide}>
        {players.map((p, i) =>
          anchors[i] ? (
            <span
              key={i}
              className={"performer-tag p" + (i + 1)}
              style={{
                left: `${anchors[i].x * 100}%`,
                top: `${anchors[i].y * 100}%`,
              }}
              data-hits={stats[i].hits}
              data-mood={stage.current?.moods[i] ?? "groove"}
            >
              {p.name ?? slotName(i)}
            </span>
          ) : null,
        )}
        {captions.map((c) =>
          anchors[c.player] ? (
            <b
              key={c.id}
              className={"comic-caption " + c.kind}
              style={{
                left: `${anchors[c.player].x * 100}%`,
                top: `${anchors[c.player].y * 100}%`,
              }}
            >
              {c.text}
            </b>
          ) : null,
        )}
      </div>
    </>
  );
  const chart = players[0].chart;
  const duration = audio.current?.duration || song.duration;
  const clock = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const meter = (s: PlayerStats) => (
    <div
      role="meter"
      aria-label="Star Power"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(s.power * 100)}
    >
      <span style={{ width: `${s.power * 100}%` }} />
    </div>
  );
  return (
    <div
      className={
        "game-screen" +
        (multi ? " multi players-" + players.length : "") +
        (!multi && solo.powerActive ? " power-active" : "")
      }
    >
      {band}
      <header className="game-header">
        <button className="quiet" onClick={exit}>
          ← {backTo}
        </button>
        <div>
          <strong>{song.title}</strong>
          <small>
            {song.artist} ·{" "}
            {multi
              ? `${players.length} players`
              : `${chart.part} / ${chart.level}`}
          </small>
        </div>
        <button className="quiet" onClick={() => pause()}>
          Pause ⏸
        </button>
      </header>
      {multi ? (
        <div className="player-grid">
          {players.map((p, i) => {
            const s = stats[i];
            return (
              <section
                key={i}
                className={
                  "player-lane" + (s.powerActive ? " power-active" : "")
                }
                aria-label={p.label}
              >
                <canvas
                  ref={(el) => {
                    canvases.current[i] = el;
                  }}
                  className="highway-mp"
                />
                <header className="player-tag">
                  <b>{p.name ?? slotName(i)}</b>
                  <span>
                    {p.chart.part} · {p.chart.level}
                  </span>
                </header>
                <div className="player-hud" data-tier={tier(s.combo)}>
                  <div className="player-score">
                    <b>{s.score.toLocaleString()}</b>
                    <small>
                      {s.combo}× streak · {s.accuracy}%
                    </small>
                  </div>
                  <strong className="player-mult">
                    {s.multiplier}
                    <i>×</i>
                  </strong>
                  <div
                    className={
                      "power-meter mini" + (s.power >= 0.5 ? " charged" : "")
                    }
                  >
                    {meter(s)}
                  </div>
                </div>
                <div className={"hit-label " + s.last.toLowerCase()}>
                  {phase === "playing" ? s.last : ""}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <div className="game-metrics">
            <div>
              <small>SCORE</small>
              <b>{solo.score.toLocaleString()}</b>
            </div>
            <div>
              <small>STREAK</small>
              <b>
                {solo.combo}
                <em>×</em>
              </b>
            </div>
            <div>
              <small>ACCURACY</small>
              <b>
                {solo.accuracy}
                <em>%</em>
              </b>
            </div>
          </div>
          <aside
            className="amplifier"
            aria-label="Guitar scoring"
            data-tier={tier(solo.combo)}
          >
            <span className="eyebrow">MULTIPLIER</span>
            <strong>
              {solo.multiplier}
              <i>×</i>
            </strong>
            <div className="streak-pips">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  key={i}
                  className={
                    solo.combo >= 30 || i < solo.combo % 10 ? "lit" : ""
                  }
                />
              ))}
            </div>
            <span>
              {solo.combo >= 30
                ? "MAXIMUM GAIN"
                : `${10 - (solo.combo % 10)} TO NEXT MULTIPLIER`}
            </span>
            <div
              className={"power-meter" + (solo.power >= 0.5 ? " charged" : "")}
            >
              <label>
                ϟ STAR POWER <b>{Math.round(solo.power * 100)}%</b>
              </label>
              {meter(solo)}
              <button
                disabled={
                  phase !== "playing" || solo.power < 0.5 || solo.powerActive
                }
                onClick={() =>
                  runtimes.current[0]?.judge.activate(
                    (audio.current?.time ?? 0) - offset / 1000,
                  )
                }
              >
                {solo.powerActive
                  ? "LIVE · DOUBLE SCORE"
                  : solo.power >= 0.5
                    ? "IGNITE · SHIFT"
                    : "HIT GLOWING PHRASES"}
              </button>
            </div>
          </aside>
          <canvas
            ref={(el) => {
              canvases.current[0] = el;
            }}
            className="highway"
          />
          <div className={"hit-label " + solo.last.toLowerCase()}>
            {phase === "playing" ? solo.last : ""}
          </div>
        </>
      )}
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
                  ? multi
                    ? `${players.length} PLAYERS READY`
                    : "YOUR STAGE IS READY"
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
                  ? multi
                    ? "Each player scores on their own highway. Any player’s Start pauses the band."
                    : mode === "strum" && chart.part !== "Drums"
                      ? "Strum solid gems. White caps are HOPOs; hollow caps are taps. Hold long notes and complete glowing phrases to earn Star Power."
                      : "Tap the matching controls as notes cross the line."
                  : "Your song and score are right where you left them.")}
            </p>
            {keyboardPlayer >= 0 && phase !== "finished" && (
              <div className="key-row">
                {multi && <kbd>P{keyboardPlayer + 1} KEYBOARD</kbd>}
                {["A", "S", "D", "F", "G"].map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
                {mode === "strum" &&
                  players[keyboardPlayer].chart.part !== "Drums" && (
                    <>
                      <kbd>SPACE · STRUM</kbd>
                      <kbd>SHIFT · STAR POWER</kbd>
                      <kbd>W · WHAMMY</kbd>
                    </>
                  )}
              </div>
            )}
            {phase === "finished" &&
              (multi ? (
                <div className="band-results">
                  {players.map((p, i) => (
                    <div key={i}>
                      <span>{p.name ?? slotName(i)}</span>
                      <small>
                        {p.chart.part} · {p.chart.level}
                      </small>
                      <b>{stats[i].score.toLocaleString()}</b>
                      {results[i] && (
                        <>
                          <Stars count={results[i].stars} small />
                          {results[i].best && (
                            <em className="new-best">NEW BEST</em>
                          )}
                        </>
                      )}
                      <small>
                        {stats[i].accuracy}% · best streak {stats[i].maxCombo}
                      </small>
                    </div>
                  ))}
                  <div className="band-total">
                    <span>BAND</span>
                    <b>
                      {stats
                        .reduce((sum, s) => sum + s.score, 0)
                        .toLocaleString()}
                    </b>
                  </div>
                </div>
              ) : (
                <>
                  {results[0] && (
                    <div className="result-stars">
                      <Stars count={results[0].stars} />
                      {results[0].best && (
                        <em className="new-best">NEW BEST</em>
                      )}
                    </div>
                  )}
                  <div className="results">
                    <b>
                      {solo.score.toLocaleString()}
                      <small>points</small>
                    </b>
                    <b>
                      {solo.accuracy}%<small>accuracy</small>
                    </b>
                    <b>
                      {solo.maxCombo}
                      <small>best streak</small>
                    </b>
                  </div>
                </>
              ))}
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
                Back to {backTo === "Library" ? "library" : backTo}
              </button>
            </div>
            <ButtonHints
              pad={anyPad}
              hints={
                [
                  { button: "up", label: "Up / Down" },
                  { button: "green", label: "Select" },
                  { button: "red", label: "Back", key: "Esc" },
                  ...(phase === "ready" || phase === "paused"
                    ? [
                        {
                          button: "start",
                          label: phase === "ready" ? "Start" : "Resume",
                          key: "Enter",
                          extra: true,
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
          {multi
            ? `${players.length} players`
            : `${chart.part} · ${chart.level}`}
        </span>
        <ButtonHints
          pad={anyPad}
          hints={[{ button: "start", label: "Pause", key: "Esc" }]}
        />
        <span>
          {clock(time)} / {clock(duration)}
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
