import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import {
  cleanName,
  handZones,
  motion,
  presets,
  slotName,
  stylize,
  type Instrument,
  type Look,
  type Mood,
  type Slot,
} from "./core/avatars";
const SIZE = 256;
/** Live preview: the avatar plays to a steady beat and runs through moods. */
function Preview({ look, instrument }: { look: Look; instrument: Instrument }) {
  const [hits, setHits] = useState(0);
  const [mood, setMood] = useState<Mood>("groove");
  useEffect(() => {
    const strum = setInterval(() => setHits((h) => h + 1), 500);
    const moods: Mood[] = ["groove", "hyped", "power", "miss"];
    let i = 0;
    const cycle = setInterval(() => setMood(moods[++i % moods.length]), 2200);
    return () => {
      clearInterval(strum);
      clearInterval(cycle);
    };
  }, []);
  return (
    <Avatar
      look={look}
      instrument={instrument}
      hits={hits}
      mood={mood}
      beat={0.5}
      className="avatar-preview"
    />
  );
}
type CameraState =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "live"; countdown: number | null }
  | { step: "review"; image: string }
  | { step: "error"; message: string };
/** Camera avatar: raise a hand (or press Take photo), 3-2-1, then the photo is
 * restyled to the stage palette. Nothing leaves this computer. */
function Camera({ onUse }: { onUse: (image: string) => void }) {
  const [state, setState] = useState<CameraState>({ step: "idle" });
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);
  const counting = useRef(false);
  const stop = () => {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
    counting.current = false;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => stop, []);
  // Attach the stream once the live view (and its video element) is on screen.
  useEffect(() => {
    const v = video.current;
    if (
      state.step === "live" &&
      v &&
      stream.current &&
      v.srcObject !== stream.current
    ) {
      v.srcObject = stream.current;
      void v.play().catch(() => {});
    }
  }, [state]);
  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    // Centre square, mirrored like the preview the player sees.
    const side = Math.min(v.videoWidth, v.videoHeight);
    ctx.translate(SIZE, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      v,
      (v.videoWidth - side) / 2,
      (v.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      SIZE,
      SIZE,
    );
    const pixels = ctx.getImageData(0, 0, SIZE, SIZE);
    pixels.data.set(stylize(pixels.data));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(pixels, 0, 0);
    const image = canvas.toDataURL("image/png");
    stop();
    setState({ step: "review", image });
  };
  const countdown = () => {
    if (counting.current) return;
    counting.current = true;
    let n = 3;
    setState({ step: "live", countdown: n });
    const t = window.setInterval(() => {
      n--;
      if (n > 0) setState({ step: "live", countdown: n });
      else {
        clearInterval(t);
        capture();
      }
    }, 800);
    timers.current.push(t);
  };
  const start = async () => {
    stop();
    setState({ step: "starting" });
    try {
      if (!(await window.backstage.cameraAccess()))
        throw Object.assign(Error("denied"), { name: "NotAllowedError" });
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      stream.current = media;
      setState({ step: "live", countdown: null });
      // Watch the upper corners for a raised hand.
      const small = document.createElement("canvas");
      small.width = 64;
      small.height = 48;
      const sctx = small.getContext("2d", { willReadFrequently: true })!;
      let previous: Uint8ClampedArray | null = null,
        streak = 0;
      const opened = performance.now();
      const watch = window.setInterval(() => {
        const v = video.current;
        if (!v || !v.videoWidth || counting.current) return;
        sctx.drawImage(v, 0, 0, 64, 48);
        const frame = sctx.getImageData(0, 0, 64, 48).data;
        // Skip the first second while the camera settles its exposure.
        if (previous && performance.now() - opened > 1000) {
          const moved = handZones.some(
            (z) => motion(previous!, frame, 64, 48, z) > 0.12,
          );
          streak = moved ? streak + 1 : 0;
          if (streak >= 2) countdown();
        }
        previous = frame;
      }, 120);
      timers.current.push(watch);
    } catch (error) {
      stop();
      const name = (error as DOMException)?.name;
      setState({
        step: "error",
        message:
          name === "NotAllowedError"
            ? "Camera access is off. Allow Backstage in System Settings → Privacy & Security → Camera, or choose a premade avatar."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No camera found. Choose a premade avatar instead."
              : "The camera could not start. Close other apps using it, or choose a premade avatar.",
      });
    }
  };
  return (
    <div className="camera-panel">
      {state.step === "idle" || state.step === "error" ? (
        <>
          <p>
            Take a photo and Backstage turns it into a stage avatar. Camera
            avatars can’t be customized; your photo stays on this computer.
          </p>
          {state.step === "error" && (
            <p className="dialog-error" role="alert">
              {state.message}
            </p>
          )}
          <button className="primary" data-menu-default onClick={start}>
            Turn on camera
          </button>
        </>
      ) : state.step === "starting" ? (
        <p>Starting the camera…</p>
      ) : state.step === "live" ? (
        <>
          <div className="camera-view">
            <video ref={video} muted playsInline aria-label="Camera preview" />
            <i className="hand-zone left" />
            <i className="hand-zone right" />
            {state.countdown !== null && (
              <b className="camera-count" aria-live="assertive">
                {state.countdown}
              </b>
            )}
          </div>
          <p className="camera-tip">✋ Raise your hand to take the picture</p>
          <div className="menu-list">
            <button className="primary" data-menu-default onClick={countdown}>
              Take photo
            </button>
            <button
              className="secondary"
              onClick={() => {
                stop();
                setState({ step: "idle" });
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <img
            className="camera-result"
            src={state.image}
            alt="Your avatar photo"
          />
          <div className="menu-list">
            <button
              className="primary"
              data-menu-default
              onClick={() => {
                onUse(state.image);
                setState({ step: "idle" });
              }}
            >
              Use this photo
            </button>
            <button className="secondary" onClick={start}>
              Retake
            </button>
          </div>
        </>
      )}
    </div>
  );
}
/** Avatars: a name and look for each of the four player slots. */
export default function Avatars({
  band,
  onSave,
}: {
  band: Slot[];
  onSave: (slot: number, value: Slot) => void;
}) {
  const [slot, setSlot] = useState(0);
  const [instrument, setInstrument] = useState<Instrument>("guitar");
  const current = band[slot];
  const [mode, setMode] = useState<"preset" | "camera">(
    current?.look.kind === "photo" ? "camera" : "preset",
  );
  useEffect(() => {
    setMode(band[slot]?.look.kind === "photo" ? "camera" : "preset");
  }, [slot]);
  if (!current) return null;
  const save = (value: Partial<Slot>) => onSave(slot, { ...current, ...value });
  return (
    <div className="avatars-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR BAND</span>
          <h1>Who’s on stage?</h1>
          <p>
            Pick a name and an avatar for each player. Avatars play your
            instrument and react to every note you hit or miss.
          </p>
        </div>
      </div>
      <div className="slot-tabs" role="tablist" aria-label="Players">
        {band.map((s, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === slot}
            className={"slot-tab" + (i === slot ? " active" : "")}
            data-menu-default={i === slot ? "" : undefined}
            onClick={() => setSlot(i)}
          >
            <Avatar
              look={s.look}
              instrument="guitar"
              playing={false}
              className="avatar-mini"
            />
            <span>
              <small>PLAYER {i + 1}</small>
              <strong>{slotName(i, s)}</strong>
            </span>
          </button>
        ))}
      </div>
      <div className="avatar-editor">
        <section className="avatar-stage">
          <Preview
            key={current.look.kind === "photo" ? "photo" : current.look.id}
            look={current.look}
            instrument={instrument}
          />
          <div className="avatar-stage-name">{slotName(slot, current)}</div>
          <div
            className="segmented"
            role="group"
            aria-label="Preview instrument"
          >
            {(["guitar", "bass", "drums"] as Instrument[]).map((i) => (
              <button
                key={i}
                aria-pressed={i === instrument}
                className={i === instrument ? "selected" : ""}
                onClick={() => setInstrument(i)}
              >
                {i}
              </button>
            ))}
          </div>
        </section>
        <section className="avatar-options">
          <label className="name-field">
            <span>Player name</span>
            <input
              aria-label="Player name"
              value={current.name}
              placeholder={`P${slot + 1}`}
              maxLength={8}
              spellCheck={false}
              onChange={(e) => save({ name: cleanName(e.target.value) })}
            />
            <small>
              Up to 8 letters or numbers. Shown instead of P{slot + 1}.
            </small>
          </label>
          <div className="segmented wide" role="group" aria-label="Avatar type">
            <button
              aria-pressed={mode === "preset"}
              className={mode === "preset" ? "selected" : ""}
              onClick={() => setMode("preset")}
            >
              Choose an avatar
            </button>
            <button
              aria-pressed={mode === "camera"}
              className={mode === "camera" ? "selected" : ""}
              onClick={() => setMode("camera")}
            >
              Use my camera
            </button>
          </div>
          {mode === "preset" ? (
            <div
              className="preset-grid"
              role="group"
              aria-label="Premade avatars"
            >
              {presets.map((p) => {
                const chosen =
                  current.look.kind === "preset" && current.look.id === p.id;
                return (
                  <button
                    key={p.id}
                    aria-pressed={chosen}
                    className={"preset" + (chosen ? " chosen" : "")}
                    onClick={() => save({ look: { kind: "preset", id: p.id } })}
                  >
                    <Avatar
                      look={{ kind: "preset", id: p.id }}
                      instrument="guitar"
                      playing={false}
                      className="avatar-mini"
                    />
                    <span>{p.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {current.look.kind === "photo" && (
                <p className="camera-current">
                  This player uses a camera avatar. Retake it any time, or
                  choose a premade avatar instead.
                </p>
              )}
              <Camera
                onUse={(image) => save({ look: { kind: "photo", image } })}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
