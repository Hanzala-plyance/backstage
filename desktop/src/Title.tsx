import ButtonHints from "./ButtonHints";
export type MenuChoice =
  "quickplay" | "soundcheck" | "avatars" | "search" | "controllers" | "settings" | "quit";
const items: [MenuChoice, string, string][] = [
  [
    "quickplay",
    "Quickplay",
    "Pick a song and take the stage — up to 4 players",
  ],
  ["soundcheck", "Soundcheck", "Learn to play, step by step"],
  ["avatars", "Avatars", "Your name and on-stage look"],
  ["search", "Add songs", "Search and prepare new music"],
  ["controllers", "Controllers", "Connect and map guitars, pads and drums"],
  ["settings", "Settings", "Timing, playing style and library"],
  ["quit", "Quit", "Close Backstage"],
];
function Stage() {
  return (
    <div className="title-stage" aria-hidden="true">
      <i className="beam b1" />
      <i className="beam b2" />
      <i className="beam b3" />
      <i className="beam b4" />
      <div className="title-floor">
        {[0, 1, 2, 3, 4].map((lane) => (
          <span key={lane} className={"floor-gem gem-lane-" + lane} />
        ))}
      </div>
    </div>
  );
}
export function TitleScreen({
  pad,
  onStart,
}: {
  pad: boolean;
  onStart: () => void;
}) {
  return (
    <div className="title-screen" data-menu-scope onClick={onStart}>
      <Stage />
      <div className="title-center">
        <img src="/wordmark.png" alt="Backstage" className="title-logo" />
        <span className="title-tag">YOUR NEXT ENCORE</span>
        {/* Clicks and Enter bubble to the screen's handler. */}
        <button className="press-start" autoFocus>
          {pad ? "Press Start" : "Press Enter"}
        </button>
      </div>
      <ButtonHints
        className="title-hints"
        pad={pad}
        hints={[
          { button: "start", label: "Start", key: "Enter" },
          { button: "green", label: "Start" },
        ]}
      />
      <span className="title-build">BACKSTAGE / 0.2 · DEVELOPMENT</span>
    </div>
  );
}
export function MainMenu({
  pad,
  onChoose,
}: {
  pad: boolean;
  onChoose: (choice: MenuChoice) => void;
}) {
  return (
    <div className="title-screen main-menu" data-menu-scope>
      <Stage />
      <div className="menu-side">
        <img src="/wordmark.png" alt="Backstage" className="menu-logo" />
        <nav className="main-menu-list" aria-label="Main menu">
          {items.map(([key, label, hint], i) => (
            <button
              key={key}
              className={"menu-item" + (key === "quit" ? " quit" : "")}
              data-menu-default={i === 0 ? "" : undefined}
              onClick={() => onChoose(key)}
            >
              <span>{label}</span>
              <small>{hint}</small>
            </button>
          ))}
        </nav>
      </div>
      <ButtonHints
        className="title-hints"
        pad={pad}
        hints={[
          { button: "up", label: "Up / Down" },
          { button: "green", label: "Select" },
          { button: "red", label: "Back", key: "Esc" },
        ]}
      />
    </div>
  );
}
