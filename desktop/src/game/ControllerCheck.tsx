import { useEffect, useRef, useState } from "react";
import type { Profile } from "../types";
import { readPad } from "../core/input";
import { deviceLabel, isPad } from "../core/players";
import { checkItemsFor, keyItem, padActive } from "../core/lessons";
import ButtonHints from "../ButtonHints";
import { drumNotes, type MidiPort } from "./player";
export type CheckPlayer = { device: string; profile: Profile; name: string };
/** Soundcheck step one: every player presses each of their inputs once, at
 * the same time, so the band knows every controller works before the
 * lessons. Each panel lights only from its own player's controller. Menu
 * buttons are part of the check, so green and red only navigate once every
 * panel has passed. */
export default function ControllerCheck({
  players,
  pads = [],
  midi,
  onPassed,
  onNext,
  onExit,
}: {
  players: CheckPlayer[];
  pads?: readonly Gamepad[];
  midi?: MidiPort;
  onPassed: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const items = players.map((p) => checkItemsFor(p.device));
  const [seen, setSeen] = useState<string[][]>(() => players.map(() => [])),
    [held, setHeld] = useState<string[][]>(() => players.map(() => [])),
    [connected, setConnected] = useState<boolean[]>(() =>
      players.map(() => true),
    );
  const passed = items.map((list, i) =>
    list.every((it) => seen[i].includes(it.id)),
  );
  const done = passed.every(Boolean);
  const state = useRef({ done, onNext, onExit, onPassed });
  state.current = { done, onNext, onExit, onPassed };
  const mark = (i: number, ids: string[]) =>
    ids.length &&
    setSeen((all) =>
      all.map((s, k) =>
        k !== i || ids.every((id) => s.includes(id))
          ? s
          : [...new Set([...s, ...ids])],
      ),
    );
  const hold = (i: number, ids: string[]) =>
    setHeld((all) =>
      all.map((h, k) => (k === i && h.join() !== ids.join() ? ids : h)),
    );
  useEffect(() => {
    if (done) {
      onPassed();
      setTimeout(
        () =>
          document
            .querySelector<HTMLElement>(".check-screen [data-menu-default]")
            ?.focus(),
        40,
      );
    }
  }, [done]);
  useEffect(() => {
    const keyboard = players.findIndex((p) => p.device === "keyboard");
    const drumKit = players.findIndex((p) => p.device === "midi");
    const keys = new Set<string>();
    const sync = () =>
      keyboard >= 0 &&
      hold(
        keyboard,
        [...keys].map(keyItem).filter((id): id is string => !!id),
      );
    const keydown = (e: KeyboardEvent) => {
      if (e.code === "Escape") return state.current.onExit();
      if (e.code === "Enter" && state.current.done) {
        if (!(e.target as HTMLElement)?.closest?.("button"))
          state.current.onNext();
        return;
      }
      const id = keyItem(e.code);
      if (!id || keyboard < 0) return;
      e.preventDefault();
      keys.add(e.code);
      mark(keyboard, [id]);
      sync();
    };
    const keyup = (e: KeyboardEvent) => {
      keys.delete(e.code);
      sync();
    };
    const midiMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || drumKit < 0 || (data[0] & 0xf0) !== 0x90 || data[2] === 0)
        return;
      const lane = drumNotes[data[1]];
      if (lane !== undefined) mark(drumKit, [`lane${lane}`]);
    };
    if (drumKit >= 0 && midi)
      midi.input.addEventListener("midimessage", midiMessage);
    let frame = 0;
    const before: (string[] | null)[] = players.map(() => null);
    const tick = () => {
      players.forEach((p, i) => {
        if (!isPad(p.device)) return;
        const index = Number(p.device.split(":")[1]);
        const pad = navigator.getGamepads()[index];
        const valid =
          pad && p.device === `pad:${pad.index}:${pad.id}` ? pad : null;
        const now = readPad(valid, p.profile);
        setConnected((c) =>
          c[i] === now.connected
            ? c
            : c.map((v, k) => (k === i ? now.connected : v)),
        );
        const active = now.connected ? padActive(now) : [];
        // Ignore inputs already held when the check opened.
        const prev = before[i];
        if (prev) {
          const fresh = active.filter((id) => !prev.includes(id));
          if (state.current.done) {
            if (fresh.includes("lane0")) state.current.onNext();
            else if (fresh.includes("lane1")) state.current.onExit();
          } else mark(i, fresh);
        }
        before[i] = active;
        hold(i, active);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      midi?.input.removeEventListener("midimessage", midiMessage);
    };
  }, []);
  const multi = players.length > 1;
  return (
    <div className="game-screen check-screen">
      <header className="game-header">
        <button className="quiet" onClick={onExit}>
          ← Soundcheck
        </button>
        <div>
          <strong>Controller check</strong>
          <small>
            Step 1 ·{" "}
            {multi
              ? `${players.length} players`
              : deviceLabel(players[0].device, pads)}
          </small>
        </div>
        <span />
      </header>
      <main className={"check-body" + (multi ? " multi" : "")}>
        <span className="eyebrow">
          {done ? "ALL INPUTS WORKING" : "TEST EVERY INPUT"}
        </span>
        <h1>
          {done
            ? multi
              ? "Band’s all set."
              : "You’re all set."
            : "Press everything once."}
        </h1>
        <p>
          {done
            ? "Every controller answered. Next: the lessons."
            : multi
              ? "Everyone at once: each panel lights up from its own player’s controller. If a tile never lights, remap it in Controllers."
              : "Each tile lights up when Backstage hears it. If one never lights, remap it in Controllers."}
        </p>
        <div className="check-panels">
          {players.map((p, i) => (
            <section
              key={i}
              className={`check-panel p${i + 1}` + (passed[i] ? " passed" : "")}
              aria-label={`${p.name} check`}
            >
              {multi && (
                <header>
                  <b className={`player-badge p${i + 1}`}>{p.name}</b>
                  <span>{deviceLabel(p.device, pads)}</span>
                </header>
              )}
              <ul className="check-grid" aria-label="Inputs">
                {items[i].map((item) => (
                  <li
                    key={item.id}
                    className={
                      "check-tile " +
                      item.id +
                      (seen[i].includes(item.id) ? " seen" : "") +
                      (held[i].includes(item.id) ? " held" : "")
                    }
                  >
                    <i aria-hidden="true">
                      {seen[i].includes(item.id) ? "✓" : ""}
                    </i>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </li>
                ))}
              </ul>
              <p className="check-count" aria-live="polite">
                {!connected[i]
                  ? "Disconnected: reconnect it"
                  : `${items[i].filter((it) => seen[i].includes(it.id)).length} of ${items[i].length} working`}
              </p>
            </section>
          ))}
        </div>
        <div className="menu-list">
          {done ? (
            <button className="primary" data-menu-default onClick={onNext}>
              Start the lessons →
            </button>
          ) : (
            <button className="secondary" onClick={onNext}>
              Skip check
            </button>
          )}
          <button className="secondary" onClick={onExit}>
            Back to Soundcheck
          </button>
        </div>
        {done && (
          <ButtonHints
            pad={players.some((p) => isPad(p.device))}
            hints={[
              { button: "green", label: "Select" },
              { button: "red", label: "Back", key: "Esc" },
            ]}
          />
        )}
      </main>
    </div>
  );
}
