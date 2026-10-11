import { useRef, useState, type MutableRefObject } from "react";
import { cleanName } from "./core/avatars";
import type { MenuButton } from "./core/menu";
import { KEYPAD, MAX_NAME, tapKey, type LastTap } from "./core/namepad";
/** Name entry for guitars: a phone keypad with multi-tap. The player's own
 * controller drives it through `input`: strum moves (yellow/blue jump a row),
 * green presses, red deletes, Start or orange finishes. Keyboards type in the
 * field directly. */
export default function NamePad({
  value,
  onChange,
  onDone,
  input,
  label,
}: {
  value: string;
  onChange: (name: string) => void;
  onDone: () => void;
  input: MutableRefObject<((b: MenuButton) => void) | null>;
  label: string;
}) {
  const [cursor, setCursor] = useState(1);
  const last = useRef<LastTap>(null);
  const press = (index: number) => {
    const result = tapKey(value, index, last.current, performance.now());
    last.current = result.last;
    if (result.name !== value) onChange(result.name);
    if (result.done) onDone();
  };
  const move = (step: number) =>
    setCursor((c) => (c + step + KEYPAD.length) % KEYPAD.length);
  input.current = (b) => {
    if (b === "up") move(-1);
    else if (b === "down") move(1);
    else if (b === "yellow") move(-3);
    else if (b === "blue") move(3);
    else if (b === "green") press(cursor);
    else if (b === "red") {
      last.current = null;
      onChange(value.slice(0, -1));
    } else if (b === "start" || b === "orange") onDone();
  };
  return (
    <div className="name-pad" role="group" aria-label={`${label} name`}>
      <input
        className="name-pad-field"
        aria-label={`${label} name`}
        value={value}
        placeholder="NAME"
        maxLength={MAX_NAME}
        spellCheck={false}
        onChange={(e) => {
          last.current = null;
          onChange(cleanName(e.target.value));
        }}
        onKeyDown={(e) => e.key === "Enter" && onDone()}
      />
      <div className="name-pad-keys">
        {KEYPAD.map((k, i) => (
          <button
            key={k.label}
            className={"pad-key" + (i === cursor ? " current" : "")}
            onClick={() => {
              setCursor(i);
              press(i);
            }}
          >
            {k.label
              .split(" ")
              .map((part, j) =>
                j ? <small key={j}>{part}</small> : <b key={j}>{part}</b>,
              )}
          </button>
        ))}
      </div>
      <small className="setup-hint">
        Strum to move · green to type (tap again for the next letter) · red
        deletes · Start when done
      </small>
    </div>
  );
}
