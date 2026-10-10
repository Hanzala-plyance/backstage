import { useId } from "react";
import {
  presetFor,
  type Instrument,
  type Look,
  type Mood,
  type Preset,
} from "./core/avatars";
// A 2D performer: premade look or camera photo, holding the player's
// instrument. `hits` re-triggers one strum or stick hit per note; `beat` sets
// the groove to the song's tempo; `mood` sets the expression.
function Hair({ p }: { p: Preset }) {
  const c = p.hair;
  switch (p.style) {
    case "spikes":
      return (
        <path
          d="M64 66 L70 30 L82 50 L90 22 L100 46 L112 20 L118 48 L132 30 L136 66 Q100 44 64 66Z"
          fill={c}
        />
      );
    case "mohawk":
      return <path d="M92 70 L88 18 Q100 6 112 18 L108 70Z" fill={c} />;
    case "long":
      return (
        <path
          d="M64 70 Q62 30 100 30 Q138 30 136 70 L142 128 L124 120 L122 72 Q100 56 78 72 L76 120 L58 128Z"
          fill={c}
        />
      );
    case "bob":
      return (
        <path
          d="M62 92 Q56 30 100 30 Q144 30 138 92 L124 92 L124 64 Q100 52 76 64 L76 92Z"
          fill={c}
        />
      );
    case "buzz":
      return (
        <path d="M68 62 Q70 34 100 34 Q130 34 132 62 Q100 50 68 62Z" fill={c} />
      );
    case "afro":
      return <circle cx="100" cy="56" r="46" fill={c} />;
    case "bun":
      return (
        <>
          <circle cx="100" cy="24" r="14" fill={c} />
          <path
            d="M66 66 Q66 32 100 32 Q134 32 134 66 Q100 50 66 66Z"
            fill={c}
          />
        </>
      );
    case "cap":
      return (
        <>
          <path d="M64 60 Q66 30 100 30 Q134 30 136 60Z" fill={c} />
          <path d="M120 58 L152 62 L136 66Z" fill={c} />
        </>
      );
    case "pony":
      return (
        <>
          <path d="M128 50 Q156 60 146 110 Q138 84 126 72Z" fill={c} />
          <path
            d="M66 66 Q66 32 100 32 Q134 32 134 66 Q110 46 66 66Z"
            fill={c}
          />
        </>
      );
    case "swoop":
      return (
        <path
          d="M64 70 Q60 28 108 30 Q144 34 136 62 Q110 40 84 56 Q74 62 64 70Z"
          fill={c}
        />
      );
  }
}
function Extra({ p }: { p: Preset }) {
  switch (p.extra) {
    case "shades":
      return (
        <path
          d="M74 64 H126 V72 Q122 80 110 78 L104 70 H96 L90 78 Q78 80 74 72Z"
          fill="#07060b"
        />
      );
    case "visor":
      return (
        <rect
          x="70"
          y="60"
          width="60"
          height="12"
          rx="6"
          fill={p.accent}
          opacity="0.85"
        />
      );
    case "headphones":
      return (
        <>
          <path
            d="M66 70 Q66 26 100 26 Q134 26 134 70"
            fill="none"
            stroke="#07060b"
            strokeWidth="6"
          />
          <rect x="58" y="62" width="14" height="22" rx="5" fill={p.accent} />
          <rect x="128" y="62" width="14" height="22" rx="5" fill={p.accent} />
        </>
      );
    case "bandana":
      return (
        <path
          d="M66 52 Q100 40 134 52 L134 60 Q100 50 66 60Z M132 54 L148 48 L144 62Z"
          fill={p.accent}
        />
      );
    case "none":
      return null;
  }
}
function Face({ mood }: { mood: Mood }) {
  const ink = "#160d1c";
  const eyes =
    mood === "miss" ? (
      <path
        d="M80 62 l10 10 M90 62 l-10 10 M110 62 l10 10 M120 62 l-10 10"
        stroke={ink}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    ) : mood === "hyped" ? (
      <path
        d="M80 70 q5 -8 10 0 M110 70 q5 -8 10 0"
        stroke={ink}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
    ) : mood === "power" ? (
      <path
        d="M85 60 l2 5 5 1 -4 3 1 5 -4 -3 -4 3 1 -5 -4 -3 5 -1Z M115 60 l2 5 5 1 -4 3 1 5 -4 -3 -4 3 1 -5 -4 -3 5 -1Z"
        fill="#ffe03a"
        stroke={ink}
        strokeWidth="1"
      />
    ) : (
      <>
        <circle cx="86" cy="68" r="4" fill={ink} />
        <circle cx="114" cy="68" r="4" fill={ink} />
      </>
    );
  const mouth =
    mood === "miss" ? (
      <ellipse cx="100" cy="90" rx="6" ry="7" fill={ink} />
    ) : mood === "groove" ? (
      <path
        d="M90 86 q10 8 20 0"
        stroke={ink}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
    ) : (
      <path d="M86 84 q14 18 28 0Z" fill={ink} />
    );
  return (
    <g className="avatar-face">
      {eyes}
      {mouth}
    </g>
  );
}
function Guitar({ bass, accent }: { bass: boolean; accent: string }) {
  return (
    <g className="avatar-instrument">
      {/* Neck reaches up-left toward the fretting hand. */}
      <rect
        x={bass ? 18 : 34}
        y="146"
        width={bass ? 92 : 76}
        height="9"
        rx="3"
        fill="#2b2238"
        transform="rotate(24 110 150)"
      />
      <rect
        x={bass ? 12 : 28}
        y="142"
        width="14"
        height="17"
        rx="3"
        fill="#0c0a12"
        transform="rotate(24 110 150)"
      />
      <path
        d="M98 150 Q96 132 116 134 Q130 128 140 140 Q158 146 150 166 Q148 186 126 182 Q108 188 100 172 Q88 164 98 150Z"
        fill={bass ? "#2f8cff" : accent}
        stroke="#07060b"
        strokeWidth="3"
      />
      <circle cx="124" cy="160" r="6" fill="#07060b" />
    </g>
  );
}
function Drums({ accent }: { accent: string }) {
  return (
    <g className="avatar-instrument">
      <line
        x1="40"
        y1="150"
        x2="62"
        y2="132"
        stroke="#9b95a8"
        strokeWidth="3"
      />
      <ellipse
        cx="66"
        cy="130"
        rx="22"
        ry="5"
        fill="#ffe03a"
        stroke="#07060b"
        strokeWidth="2"
      />
      <rect
        x="62"
        y="176"
        width="76"
        height="40"
        rx="8"
        fill={accent}
        stroke="#07060b"
        strokeWidth="3"
      />
      <ellipse
        cx="100"
        cy="176"
        rx="38"
        ry="8"
        fill="#e8e5f2"
        stroke="#07060b"
        strokeWidth="3"
      />
      <ellipse
        cx="146"
        cy="160"
        rx="16"
        ry="5"
        fill="#e8e5f2"
        stroke="#07060b"
        strokeWidth="2"
      />
    </g>
  );
}
export default function Avatar({
  look,
  instrument,
  mood = "groove",
  hits = 0,
  beat = 0.5,
  playing = true,
  className = "",
}: {
  look: Look;
  instrument: Instrument;
  mood?: Mood;
  hits?: number;
  beat?: number;
  playing?: boolean;
  className?: string;
}) {
  const clip = useId().replace(/:/g, "");
  const photo = look.kind === "photo" ? look.image : null;
  const p = presetFor(look.kind === "preset" ? look.id : "");
  const skin = photo ? "#f1c7a8" : p.skin;
  const outfit = photo ? "#1b1530" : p.outfit;
  const accent = photo ? "#ff2e88" : p.accent;
  const drums = instrument === "drums";
  // Alternate sticks on drums; one strum per hit on strings.
  const side = hits % 2 ? "left" : "right";
  return (
    <div
      className={`avatar inst-${instrument} mood-${mood} ${playing ? "playing" : ""} ${className}`}
      style={
        {
          "--beat": `${Math.max(0.25, Math.min(1.5, beat))}s`,
        } as React.CSSProperties
      }
      data-mood={mood}
      data-hits={hits}
    >
      <svg viewBox="0 0 200 240" role="img" aria-label={`Avatar, ${mood}`}>
        <defs>
          <clipPath id={clip}>
            <circle cx="100" cy="70" r="34" />
          </clipPath>
          <radialGradient id={clip + "aura"}>
            <stop offset="0" stopColor="#38e8ff" stopOpacity="0.7" />
            <stop offset="1" stopColor="#38e8ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle
          className="avatar-aura"
          cx="100"
          cy="120"
          r="100"
          fill={`url(#${clip}aura)`}
        />
        <g className="avatar-body">
          <path
            d="M84 196 L80 236 H94 L100 204 L106 236 H120 L116 196Z"
            fill="#0c0a12"
          />
          <path
            d="M70 116 Q100 100 130 116 L136 198 H64Z"
            fill={outfit}
            stroke={accent}
            strokeWidth="3"
          />
          <path
            d="M92 106 L100 128 L108 106"
            fill="none"
            stroke={accent}
            strokeWidth="3"
          />
          {drums && <Drums accent={accent} />}
          {!drums && <Guitar bass={instrument === "bass"} accent={accent} />}
          {/* Fretting (or left stick) arm. */}
          <g
            key={drums ? `l${side === "left" ? hits : "rest"}` : "fret"}
            className={
              "avatar-arm left" +
              (drums && side === "left" && hits ? " hit" : "")
            }
          >
            <path
              d={drums ? "M72 122 Q56 140 66 156" : "M72 122 Q58 140 52 126"}
              stroke={skin}
              strokeWidth="11"
              fill="none"
              strokeLinecap="round"
            />
            {drums && (
              <line
                x1="66"
                y1="156"
                x2="96"
                y2="168"
                stroke="#f0d9a8"
                strokeWidth="4"
                strokeLinecap="round"
              />
            )}
          </g>
          {/* Strumming (or right stick) arm: re-mounted per hit to replay. */}
          <g
            key={drums ? `r${side === "right" ? hits : "rest"}` : `s${hits}`}
            className={
              "avatar-arm right" +
              (hits && (!drums || side === "right") ? " hit" : "")
            }
          >
            <path
              d={
                drums
                  ? "M128 122 Q146 140 134 156"
                  : "M128 122 Q142 140 128 156"
              }
              stroke={skin}
              strokeWidth="11"
              fill="none"
              strokeLinecap="round"
            />
            {drums && (
              <line
                x1="134"
                y1="156"
                x2="104"
                y2="168"
                stroke="#f0d9a8"
                strokeWidth="4"
                strokeLinecap="round"
              />
            )}
          </g>
          <g className="avatar-head">
            {!photo && p.style === "afro" && <Hair p={p} />}
            {!photo && p.style === "long" && <Hair p={p} />}
            {photo ? (
              <>
                <image
                  href={photo}
                  x="66"
                  y="36"
                  width="68"
                  height="68"
                  clipPath={`url(#${clip})`}
                  preserveAspectRatio="xMidYMid slice"
                />
                <circle
                  cx="100"
                  cy="70"
                  r="34"
                  fill="none"
                  stroke={accent}
                  strokeWidth="4"
                />
              </>
            ) : (
              <>
                <circle cx="100" cy="70" r="34" fill={skin} />
                {p.style !== "afro" && p.style !== "long" && <Hair p={p} />}
                <Face mood={mood} />
                <Extra p={p} />
              </>
            )}
          </g>
          {photo && (
            <text className="avatar-react" x="146" y="40" textAnchor="middle">
              {mood === "miss"
                ? "!!"
                : mood === "power"
                  ? "★"
                  : mood === "hyped"
                    ? "♪♪"
                    : "♪"}
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}
