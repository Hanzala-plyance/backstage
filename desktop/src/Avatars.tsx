import {
  createRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Portrait } from "./AvatarView";
import NamePad from "./NamePad";
import type { MenuButton } from "./core/menu";
import { isPad, type PlayerSetup } from "./core/players";
import {
  defaultLook,
  drumKits,
  finishes,
  gearOf,
  guitarStyles,
  type Gear,
  handZones,
  motion,
  presets,
  stylize,
  type Look,
  type Slot,
} from "./core/avatars";
const SIZE = 256;
const FINISH_NAMES = [
  "Hot pink",
  "Cyan",
  "Yellow",
  "Green",
  "Purple",
  "Orange",
  "Red",
  "Pearl",
  "Black",
];
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
type Tile = { kind: "preset"; id: string; name: string } | { kind: "camera" };
const CARD_ROWS = ["name", "guitar", "kit", "side", "color", "avatar"] as const;
type CardRow = (typeof CARD_ROWS)[number];
const TILES: Tile[] = [
  ...presets.map((p) => ({ kind: "preset" as const, id: p.id, name: p.name })),
  { kind: "camera" },
];
const cycle = <T,>(list: readonly T[], value: T, step = 1) =>
  list[(list.indexOf(value) + step + list.length) % list.length];
/** Smash-style character select: every joined player moves their own token
 * over the avatars with their own controller and picks at the same time.
 * Cards along the bottom hold each player's name, gear and stage side. */
export default function Avatars({
  band,
  onSave,
  players,
  joinable,
  input,
}: {
  band: Slot[];
  onSave: (slot: number, value: Slot) => void;
  players: PlayerSetup[];
  joinable: boolean;
  /** App routes each joined player's controller presses here; returns
   * whether the press was used. */
  input: MutableRefObject<((slot: number, b: MenuButton) => boolean) | null>;
}) {
  const tileOf = (look: Look) =>
    Math.max(
      0,
      look.kind === "photo"
        ? TILES.length - 1
        : TILES.findIndex((t) => t.kind === "preset" && t.id === look.id),
    );
  const [cursors, setCursors] = useState(() => band.map((s) => tileOf(s.look)));
  const [naming, setNaming] = useState<boolean[]>([false, false, false, false]);
  const [camera, setCamera] = useState<number | null>(null);
  // Each player's controller is either on the avatar grid or on a row of
  // their own card.
  const [zones, setZones] = useState<("grid" | number)[]>([
    "grid",
    "grid",
    "grid",
    "grid",
  ]);
  const setZone = (i: number, zone: "grid" | number) =>
    setZones((z) => z.map((v, k) => (k === i ? zone : v)));
  const [mouse, setMouse] = useState(0);
  const nameInputs = useMemo(
    () => [0, 1, 2, 3].map(() => createRef<(b: MenuButton) => void>()),
    [],
  ) as MutableRefObject<((b: MenuButton) => void) | null>[];
  const slot = (i: number): Slot =>
    band[i] ?? { name: "", look: defaultLook(i) };
  const save = (i: number, value: Partial<Slot>) =>
    onSave(i, { ...slot(i), ...value });
  const setGear = (i: number, value: Partial<Gear>) =>
    save(i, { gear: { ...gearOf(i, slot(i)), ...value } });
  const nameMode = (i: number, on: boolean) =>
    setNaming((n) => n.map((v, k) => (k === i ? on : v)));
  const change = (i: number, row: CardRow, step: 1 | -1) => {
    const g = gearOf(i, slot(i));
    if (row === "name") nameMode(i, true);
    else if (row === "guitar")
      setGear(i, {
        guitar: cycle(
          guitarStyles.map((x) => x.id),
          g.guitar,
          step,
        ),
      });
    else if (row === "kit")
      setGear(i, {
        kit: cycle(
          drumKits.map((x) => x.id),
          g.kit,
          step,
        ),
      });
    else if (row === "side")
      setGear(i, { side: g.side === "left" ? "right" : "left" });
    else if (row === "color")
      setGear(i, { finish: cycle(finishes, g.finish, step) });
    else setZone(i, "grid");
  };
  const pick = (i: number, tile: number) => {
    const t = TILES[tile];
    // The player's token follows their pick (mouse picks too).
    setCursors((c) => c.map((v, k) => (k === i ? tile : v)));
    if (t.kind === "camera") setCamera(i);
    else save(i, { look: { kind: "preset", id: t.id } });
  };
  input.current = (i, b) => {
    if (naming[i]) {
      nameInputs[i].current?.(b);
      return true;
    }
    if (camera === i) {
      if (b === "green")
        document
          .querySelector<HTMLElement>(".camera-overlay [data-menu-default]")
          ?.click();
      else if (b === "red") setCamera(null);
      return b !== "start";
    }
    const move = (step: number) =>
      setCursors((c) =>
        c.map((v, k) =>
          k === i ? (v + step + TILES.length) % TILES.length : v,
        ),
      );
    const zone = zones[i];
    if (zone !== "grid") {
      // On the card: strum moves between rows, green/yellow change the row.
      const rows = CARD_ROWS.length;
      if (b === "up") setZone(i, (zone + rows - 1) % rows);
      else if (b === "down") setZone(i, (zone + 1) % rows);
      else if (b === "green") change(i, CARD_ROWS[zone], 1);
      else if (b === "yellow") change(i, CARD_ROWS[zone], -1);
      else if (b === "red") setZone(i, "grid");
      else if (b === "orange") nameMode(i, true);
      else return false;
      return true;
    }
    if (b === "up") move(-1);
    else if (b === "down") move(1);
    else if (b === "green") {
      pick(i, cursors[i]);
      // Like Smash: after picking, the cursor drops onto your card.
      if (TILES[cursors[i]].kind !== "camera") setZone(i, 1);
    } else if (b === "yellow")
      setGear(i, { finish: cycle(finishes, gearOf(i, slot(i)).finish) });
    else if (b === "blue")
      setGear(i, {
        guitar: cycle(
          guitarStyles.map((g) => g.id),
          gearOf(i, slot(i)).guitar,
        ),
      });
    else if (b === "orange") nameMode(i, true);
    else return false; // red goes back, Start opens the player's pop-up
    return true;
  };
  return (
    <div className="avatars-page select-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR BAND</span>
          <h1>Who’s on stage?</h1>
          <p>
            Every player picks at once with their own controller: strum to move
            your token, green to pick, then set up your card row by row. With a
            mouse, choose a card, then an avatar.
          </p>
        </div>
      </div>
      <div className="select-grid" role="group" aria-label="Avatars">
        {TILES.map((t, k) => {
          const here = players.map((_, i) => i).filter((i) => cursors[i] === k);
          const chosenBy = players
            .map((_, i) => i)
            .filter((i) => {
              const look = slot(i).look;
              return t.kind === "camera"
                ? look.kind === "photo"
                : look.kind === "preset" && look.id === t.id;
            });
          return (
            <button
              key={t.kind === "camera" ? "camera" : t.id}
              className={"select-tile" + (chosenBy.length ? " chosen" : "")}
              aria-label={t.kind === "camera" ? "Camera avatar" : t.name}
              onClick={() => pick(mouse, k)}
            >
              {t.kind === "camera" ? (
                <span className="camera-tile">📷</span>
              ) : (
                <Portrait
                  look={{ kind: "preset", id: t.id }}
                  className="tile-portrait"
                />
              )}
              <span className="tile-name">
                {t.kind === "camera" ? "Camera" : t.name}
              </span>
              <span className="tokens">
                {here.map((i) => (
                  <b key={i} className={`token p${i + 1}`}>
                    P{i + 1}
                  </b>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="select-cards">
        {[0, 1, 2, 3].map((i) => {
          if (!players[i])
            return (
              <div key={i} className={`select-card empty p${i + 1}`}>
                <b>P{i + 1}</b>
                <small>
                  {i === players.length && joinable
                    ? "Press START to join"
                    : "Open"}
                </small>
              </div>
            );
          const s = slot(i),
            gear = gearOf(i, s),
            style = guitarStyles.find((g) => g.id === gear.guitar)!,
            kit = drumKits.find((k) => k.id === gear.kit)!;
          return (
            <div
              key={i}
              className={
                `select-card p${i + 1}` +
                (mouse === i ? " mouse" : "") +
                (naming[i] ? " naming" : "")
              }
              aria-label={`Player ${i + 1} card`}
              onClick={() => setMouse(i)}
            >
              <Portrait look={s.look} gear={gear} className="card-portrait" />
              {naming[i] ? (
                <NamePad
                  label={`Player ${i + 1}`}
                  value={s.name}
                  onChange={(name) => save(i, { name })}
                  onDone={() => nameMode(i, false)}
                  input={nameInputs[i]}
                />
              ) : (
                <div className="card-rows">
                  {CARD_ROWS.map((r, k) => {
                    const here = zones[i] === k;
                    const value =
                      r === "name"
                        ? s.name || `P${i + 1}`
                        : r === "guitar"
                          ? style.name
                          : r === "kit"
                            ? kit.name
                            : r === "side"
                              ? gear.side === "left"
                                ? "Left"
                                : "Right"
                              : "";
                    const label = {
                      name: "Name",
                      guitar: "Guitar",
                      kit: "Drum kit",
                      side: "Stage",
                      color: "Color",
                      avatar: "Avatar",
                    }[r];
                    const aria = {
                      name: "name",
                      guitar: "guitar style",
                      kit: "drum kit",
                      side: "stage side",
                      color: "finish",
                      avatar: "avatar",
                    }[r];
                    return (
                      <div
                        key={r}
                        className={`card-row ${r}` + (here ? " current" : "")}
                      >
                        <span className="row-label">{label}</span>
                        {r === "color" ? (
                          <div
                            className="card-colors"
                            role="group"
                            aria-label={`Player ${i + 1} finish`}
                          >
                            {finishes.map((f, n) => (
                              <button
                                key={f}
                                aria-label={FINISH_NAMES[n]}
                                aria-pressed={gear.finish === f}
                                className={
                                  "swatch" +
                                  (gear.finish === f ? " chosen" : "")
                                }
                                style={{ background: f }}
                                onClick={() => setGear(i, { finish: f })}
                              />
                            ))}
                          </div>
                        ) : r === "avatar" ? (
                          <button
                            className="row-value"
                            onClick={() => setZone(i, "grid")}
                          >
                            ▲ Pick another
                          </button>
                        ) : (
                          <>
                            {r !== "name" && (
                              <button
                                className="row-arrow"
                                aria-label={`Player ${i + 1} previous ${aria}`}
                                onClick={() => change(i, r, -1)}
                              >
                                ◀
                              </button>
                            )}
                            <button
                              className="row-value"
                              aria-label={`Player ${i + 1} ${aria}`}
                              title={
                                r === "guitar"
                                  ? style.hint
                                  : r === "kit"
                                    ? kit.hint
                                    : undefined
                              }
                              onClick={() => change(i, r, 1)}
                            >
                              {r === "name" ? <b>{value}</b> : value}
                              {r === "name" && <small>✎</small>}
                            </button>
                            {r !== "name" && (
                              <button
                                className="row-arrow"
                                aria-label={`Player ${i + 1} next ${aria}`}
                                onClick={() => change(i, r, 1)}
                              >
                                ▶
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {players[i] && isPad(players[i].device) && (
                    <small className="card-hint">
                      {zones[i] === "grid"
                        ? "Strum to choose · green to pick"
                        : "Strum to move · green changes · red: avatars"}
                    </small>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {camera !== null && (
        <div
          className="camera-overlay"
          role="dialog"
          aria-label={`Player ${camera + 1} camera`}
        >
          <h3>Player {camera + 1} · camera avatar</h3>
          <Camera
            onUse={(image) => {
              save(camera, { look: { kind: "photo", image } });
              setCamera(null);
            }}
          />
          <button className="secondary" onClick={() => setCamera(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
