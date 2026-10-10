import { useEffect, useRef, useState } from "react";
import type { Profile } from "../types";
import { readPad } from "../core/input";
import { isPad } from "../core/players";
import { checkItems, keyItem, padActive } from "../core/lessons";
import ButtonHints from "../ButtonHints";
/** Soundcheck step one: press every input once so the player knows the whole
 * controller works before the lessons. Menu buttons are part of the check, so
 * green and red only navigate once everything has been pressed. */
export default function ControllerCheck({
  device,
  profile,
  onPassed,
  onNext,
  onExit,
}: {
  device: string;
  profile: Profile;
  onPassed: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const pad = isPad(device);
  const items = checkItems(pad);
  const [seen, setSeen] = useState<string[]>([]),
    [held, setHeld] = useState<string[]>([]),
    [connected, setConnected] = useState(true);
  const done = items.every((i) => seen.includes(i.id));
  const state = useRef({ done, onNext, onExit, onPassed });
  state.current = { done, onNext, onExit, onPassed };
  const mark = (ids: string[]) =>
    ids.length &&
    setSeen((s) =>
      ids.every((id) => s.includes(id)) ? s : [...new Set([...s, ...ids])],
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
    const keys = new Set<string>();
    const sync = () =>
      setHeld([...keys].map(keyItem).filter((id): id is string => !!id));
    const keydown = (e: KeyboardEvent) => {
      if (e.code === "Escape") return state.current.onExit();
      if (e.code === "Enter" && state.current.done) {
        if (!(e.target as HTMLElement)?.closest?.("button"))
          state.current.onNext();
        return;
      }
      const id = keyItem(e.code);
      if (!id || pad) return;
      e.preventDefault();
      keys.add(e.code);
      mark([id]);
      sync();
    };
    const keyup = (e: KeyboardEvent) => {
      keys.delete(e.code);
      sync();
    };
    let frame = 0,
      before: string[] | null = null;
    const tick = () => {
      if (pad) {
        const index = Number(device.split(":")[1]);
        const p = navigator.getGamepads()[index];
        const valid = p && device === `pad:${p.index}:${p.id}` ? p : null;
        const now = readPad(valid, profile);
        setConnected(now.connected);
        const active = now.connected ? padActive(now) : [];
        // Ignore inputs already held when the check opened.
        if (before) {
          const fresh = active.filter((id) => !before!.includes(id));
          if (state.current.done) {
            if (fresh.includes("lane0")) state.current.onNext();
            else if (fresh.includes("lane1")) state.current.onExit();
          } else mark(fresh);
        }
        before = active;
        setHeld((h) => (h.join() === active.join() ? h : active));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, []);
  return (
    <div className="game-screen check-screen">
      <header className="game-header">
        <button className="quiet" onClick={onExit}>
          ← Soundcheck
        </button>
        <div>
          <strong>Controller check</strong>
          <small>Step 1 · {pad ? "Your controller" : "Your keyboard"}</small>
        </div>
        <span />
      </header>
      <main className="check-body">
        <span className="eyebrow">
          {done ? "ALL INPUTS WORKING" : "TEST EVERY INPUT"}
        </span>
        <h1>{done ? "You’re all set." : "Press everything once."}</h1>
        <p>
          {!connected
            ? "Controller disconnected. Reconnect it, or choose another in Controllers."
            : done
              ? "Every fret, strum and button answered. Next: the lessons."
              : "Each tile lights up when Backstage hears it. If one never lights, remap it in Controllers."}
        </p>
        <ul className="check-grid" aria-label="Inputs">
          {items.map((item) => (
            <li
              key={item.id}
              className={
                "check-tile " +
                item.id +
                (seen.includes(item.id) ? " seen" : "") +
                (held.includes(item.id) ? " held" : "")
              }
            >
              <i aria-hidden="true">{seen.includes(item.id) ? "✓" : ""}</i>
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </li>
          ))}
        </ul>
        <p className="check-count" aria-live="polite">
          {items.filter((i) => seen.includes(i.id)).length} of {items.length}{" "}
          working
        </p>
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
            pad={pad}
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
