import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Portrait } from "./AvatarView";
import {
  defaultLook,
  presetFor,
  presets,
  type Look,
  type Slot,
} from "./core/avatars";
import type { Profile } from "./types";
import { readPad } from "./core/input";
import type { MenuButton } from "./core/menu";
import {
  MAX_PLAYERS,
  cycleSetting,
  deviceLabel,
  isPad,
  leavePlayer,
  type PlayerSetup,
} from "./core/players";
type Row = "avatar" | "part" | "level" | "leave" | "done";
/** Live fret/strum test for one controller. */
function InputTest({ device, profile }: { device: string; profile: Profile }) {
  const [state, setState] = useState(() => readPad(null, profile));
  useEffect(() => {
    if (!isPad(device)) return;
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      if (now - last > 50) {
        last = now;
        const index = Number(device.split(":")[1]);
        const pad = navigator.getGamepads()[index];
        const valid =
          pad && device === `pad:${pad.index}:${pad.id}` ? pad : null;
        setState(readPad(valid, profile));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [device, profile]);
  if (!isPad(device))
    return (
      <p className="setup-test muted">
        {device === "keyboard"
          ? "Keyboard: A S D F G, Space to strum."
          : "MIDI drums: hit a pad to test it in Controllers."}
      </p>
    );
  return (
    <div className="setup-test" aria-label="Input test">
      {state.lanes.map((on, i) => (
        <i key={i} className={`fret lane${i}${on ? " on" : ""}`} />
      ))}
      <b className={state.strumUp ? "on" : ""}>▲</b>
      <b className={state.strumDown ? "on" : ""}>▼</b>
      <b className={state.starPower ? "on" : ""}>★</b>
      {!state.connected && <small>Disconnected</small>}
    </div>
  );
}
/** Clone Hero-style players along the bottom: P1 is always there; another
 * controller joins by pressing Start, and the player's own controller drives
 * their setup pop-up (strum to move, green to change, red or Start to close). */
export default function PlayerBar({
  players,
  names,
  pads,
  profileOf,
  open,
  setOpen,
  onChange,
  input,
  joinable,
  slots,
  onSlot,
}: {
  players: PlayerSetup[];
  names: string[];
  pads: readonly Gamepad[];
  profileOf: (device: string) => Profile;
  open: number | null;
  setOpen: (slot: number | null) => void;
  onChange: (players: PlayerSetup[]) => void;
  /** The open pop-up's handler for its owner's controller. */
  input: MutableRefObject<(b: MenuButton) => void>;
  joinable: boolean;
  /** Player names and avatars (the Avatars section edits the same slots). */
  slots: Slot[];
  onSlot: (index: number, slot: Slot) => void;
}) {
  const [row, setRow] = useState(0);
  const player = open === null ? null : players[open];
  const rows: Row[] = [
    "avatar",
    "part",
    "level",
    ...(open ? (["leave"] as Row[]) : []),
    "done",
  ];
  // A camera photo stays one of the choices while the pop-up is open, so
  // cycling past it doesn't lose it.
  const photo = useRef<Look | null>(null);
  useEffect(() => {
    setRow(0);
    const look = open === null ? null : slots[open]?.look;
    photo.current = look?.kind === "photo" ? look : null;
  }, [open]);
  const looks = (): Look[] => [
    ...(photo.current ? [photo.current] : []),
    ...presets.map((p) => ({ kind: "preset", id: p.id }) as Look),
  ];
  const lookOf = (i: number) => slots[i]?.look ?? defaultLook(i);
  const same = (a: Look, b: Look) =>
    a.kind === b.kind &&
    (a.kind === "photo"
      ? b.kind === "photo"
      : b.kind === "preset" && a.id === b.id);
  // A player who left (or whose slot vanished) closes their pop-up.
  useEffect(() => {
    if (open !== null && !players[open]) setOpen(null);
  }, [players, open]);
  const act = (r: Row, step: 1 | -1 = 1) => {
    if (open === null) return;
    if (r === "avatar") {
      const list = looks();
      const at = list.findIndex((l) => same(l, lookOf(open)));
      const look = list[(at + step + list.length) % list.length];
      onSlot(open, { ...(slots[open] ?? { name: "" }), look });
    } else if (r === "part" || r === "level")
      onChange(cycleSetting(players, open, r, step));
    else if (r === "leave") {
      onChange(leavePlayer(players, open));
      setOpen(null);
    } else setOpen(null);
  };
  input.current = (b) => {
    if (b === "up") setRow((r) => (r + rows.length - 1) % rows.length);
    else if (b === "down") setRow((r) => (r + 1) % rows.length);
    else if (b === "green") act(rows[row]);
    else if (b === "yellow" && rows[row] !== "leave" && rows[row] !== "done")
      act(rows[row], -1);
    else if (b === "red" || b === "start") setOpen(null);
  };
  const label = (i: number) => names[i] || `P${i + 1}`;
  return (
    <>
      {player && open !== null && (
        <section
          className={`player-setup p${open + 1}`}
          role="group"
          aria-label={`Player ${open + 1} setup`}
        >
          <header>
            <b className={`player-badge p${open + 1}`}>{label(open)}</b>
            <span>{deviceLabel(player.device, pads)}</span>
          </header>
          <InputTest
            device={player.device}
            profile={profileOf(player.device)}
          />
          {rows.map((r, i) => (
            <button
              key={r}
              className={
                "setup-row" +
                (i === row ? " current" : "") +
                (r === "leave" ? " leave" : "")
              }
              onClick={() => {
                setRow(i);
                act(r);
              }}
            >
              {r === "avatar" ? (
                <>
                  <span>Avatar</span>
                  <span className="setup-avatar">
                    <Portrait look={lookOf(open)} className="avatar-mini" />
                    <strong>
                      {lookOf(open).kind === "photo"
                        ? "Camera"
                        : presetFor((lookOf(open) as { id: string }).id).name}
                    </strong>
                  </span>
                </>
              ) : r === "part" ? (
                <>
                  <span>Instrument</span>
                  <strong>{player.part}</strong>
                </>
              ) : r === "level" ? (
                <>
                  <span>Difficulty</span>
                  <strong>{player.level}</strong>
                </>
              ) : r === "leave" ? (
                <span>Leave</span>
              ) : (
                <span>Done</span>
              )}
            </button>
          ))}
          <small className="setup-hint">
            {isPad(player.device)
              ? "Strum to move · green to change · red or Start to close"
              : "Click to change · Done to close"}
          </small>
        </section>
      )}
      <div className="player-bar" aria-label="Players">
        {Array.from({ length: MAX_PLAYERS }, (_, i) => {
          const p = players[i];
          if (!p)
            return (
              <span key={i} className="player-slot empty">
                <b>P{i + 1}</b>
                <small>
                  {i === players.length && joinable
                    ? "Press START to join"
                    : "Open"}
                </small>
              </span>
            );
          return (
            <button
              key={i}
              className={`player-slot p${i + 1}` + (open === i ? " open" : "")}
              aria-label={`Player ${i + 1}: ${label(i)}, ${deviceLabel(p.device, pads)}, ${p.part} ${p.level}`}
              onClick={() => setOpen(open === i ? null : i)}
            >
              <b>{label(i)}</b>
              <small>
                {deviceLabel(p.device, pads)} · {p.part} · {p.level}
              </small>
            </button>
          );
        })}
      </div>
    </>
  );
}
