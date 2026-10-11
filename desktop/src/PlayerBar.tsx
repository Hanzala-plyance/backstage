import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Portrait } from "./AvatarView";
import {
  defaultLook,
  drumKits,
  finishes,
  gearOf,
  guitarStyles,
  type Gear,
  type Slot,
} from "./core/avatars";
import NamePad from "./NamePad";
const cycle = <T,>(list: readonly T[], value: T, step = 1) =>
  list[(list.indexOf(value) + step + list.length) % list.length];
import type { Profile } from "./types";
import { readPad } from "./core/input";
import type { MenuButton } from "./core/menu";
import {
  MAX_PLAYERS,
  cycleSetting,
  deviceLabel,
  isPad,
  leavePlayer,
  toggleStrum,
  type PlayerSetup,
} from "./core/players";
type Row =
  | "name"
  | "part"
  | "level"
  | "strum"
  | "guitar"
  | "finish"
  | "kit"
  | "leave"
  | "done";
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
  defaultStrum,
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
  /** The Settings choice, for players who haven't picked their own. */
  defaultStrum: boolean;
}) {
  const [row, setRow] = useState(0);
  const player = open === null ? null : players[open];
  const drums = player?.part === "Drums";
  const rows: Row[] = [
    "name",
    "part",
    "level",
    // Drums don't strum; drummers pick a kit instead of a guitar.
    ...((drums ? ["kit"] : ["strum", "guitar", "finish"]) as Row[]),
    ...(open ? (["leave"] as Row[]) : []),
    "done",
  ];
  const [naming, setNaming] = useState(false);
  const nameInput = useRef<((b: MenuButton) => void) | null>(null);
  useEffect(() => {
    setRow(0);
    setNaming(false);
  }, [open]);
  const slotOf = (i: number): Slot =>
    slots[i] ?? { name: "", look: defaultLook(i) };
  const gear = open === null ? null : gearOf(open, slotOf(open));
  const setGear = (value: Partial<Gear>) =>
    open !== null &&
    onSlot(open, {
      ...slotOf(open),
      gear: { ...gearOf(open, slotOf(open)), ...value },
    });
  // A player who left (or whose slot vanished) closes their pop-up.
  useEffect(() => {
    if (open !== null && !players[open]) setOpen(null);
  }, [players, open]);
  const act = (r: Row, step: 1 | -1 = 1) => {
    if (open === null) return;
    const g = gearOf(open, slotOf(open));
    if (r === "name") setNaming(true);
    else if (r === "guitar")
      setGear({
        guitar: cycle(
          guitarStyles.map((x) => x.id),
          g.guitar,
          step,
        ),
      });
    else if (r === "finish")
      setGear({ finish: cycle(finishes, g.finish, step) });
    else if (r === "kit")
      setGear({
        kit: cycle(
          drumKits.map((x) => x.id),
          g.kit,
          step,
        ),
      });
    else if (r === "strum")
      onChange(toggleStrum(players, open, players[open].strum ?? defaultStrum));
    else if (r === "part" || r === "level")
      onChange(cycleSetting(players, open, r, step));
    else if (r === "leave") {
      onChange(leavePlayer(players, open));
      setOpen(null);
    } else setOpen(null);
  };
  input.current = (b) => {
    if (naming) return nameInput.current?.(b);
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
          {naming && (
            <NamePad
              label={`Player ${open + 1}`}
              value={slotOf(open).name}
              onChange={(name) => onSlot(open, { ...slotOf(open), name })}
              onDone={() => setNaming(false)}
              input={nameInput}
            />
          )}
          {!naming &&
            rows.map((r, i) => (
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
                {r === "name" ? (
                  <>
                    <span>Name</span>
                    <span className="setup-avatar">
                      <Portrait
                        look={slotOf(open).look}
                        gear={gear!}
                        className="avatar-mini"
                      />
                      <strong>{slotOf(open).name || `P${open + 1}`}</strong>
                    </span>
                  </>
                ) : r === "guitar" ? (
                  <>
                    <span>Guitar</span>
                    <strong>
                      {guitarStyles.find((x) => x.id === gear!.guitar)?.name}
                    </strong>
                  </>
                ) : r === "finish" ? (
                  <>
                    <span>Color</span>
                    <i
                      className="setup-swatch"
                      style={{ background: gear!.finish }}
                    />
                  </>
                ) : r === "kit" ? (
                  <>
                    <span>Drum kit</span>
                    <strong>
                      {drumKits.find((x) => x.id === gear!.kit)?.name}
                    </strong>
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
                ) : r === "strum" ? (
                  <>
                    <span>Strumming</span>
                    <strong>
                      {(player.strum ?? defaultStrum)
                        ? "On · strum to hit"
                        : "Off · frets only"}
                    </strong>
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
