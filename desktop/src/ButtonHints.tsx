import type { MenuButton } from "./core/menu";
export type Hint = { button: MenuButton; label: string; key?: string };
const keys: Partial<Record<MenuButton, string>> = {
  green: "Enter",
  red: "Esc",
  up: "↑↓",
  down: "↑↓",
};
const strum = (b: MenuButton) => b === "up" || b === "down";
export default function ButtonHints({
  hints,
  pad,
  className = "",
}: {
  hints: Hint[];
  pad: boolean;
  className?: string;
}) {
  // Keyboard players only see actions that have a key, once per key.
  const keyOf = (h: Hint) => h.key ?? keys[h.button];
  const shown = pad
    ? hints
    : hints.filter(
        (h, i) =>
          keyOf(h) && hints.findIndex((o) => keyOf(o) === keyOf(h)) === i,
      );
  return (
    <div
      className={"button-hints " + className}
      aria-label="Controls"
      data-menu-skip
    >
      {shown.map((h) => (
        <span key={h.button + h.label}>
          {!pad ? (
            <kbd>{keyOf(h)}</kbd>
          ) : strum(h.button) ? (
            <i className="hint-strum" aria-hidden="true">
              <b />
            </i>
          ) : h.button === "start" ? (
            <i className="hint-start" aria-hidden="true">
              ≡
            </i>
          ) : (
            <i className={"hint-gem gem-" + h.button} aria-hidden="true" />
          )}
          {pad && (
            <span className="sr-only">
              {strum(h.button) ? "Strum" : h.button}
            </span>
          )}
          {h.label}
        </span>
      ))}
    </div>
  );
}
