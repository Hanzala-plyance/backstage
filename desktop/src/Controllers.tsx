import { useEffect, useRef, useState } from "react";
import type { Action, Profile } from "./types";
import {
  actions,
  actionLabels,
  defaultProfile,
  loadProfile,
  newlyPressed,
} from "./core/input";
import type { MidiPort } from "./game/Game";
export default function Controllers({
  device,
  onDevice,
  profile,
  onProfile,
  midi,
  onMidi,
}: {
  device: string;
  onDevice: (s: string) => void;
  profile: Profile;
  onProfile: (p: Profile) => void;
  midi?: MidiPort;
  onMidi: (p: MidiPort) => void;
}) {
  const [pads, setPads] = useState<Gamepad[]>([]),
    [capture, setCapture] = useState<Action | null>(null),
    [ports, setPorts] = useState<MidiPort[]>([]),
    [error, setError] = useState(""),
    [midiLane, setMidiLane] = useState<number | null>(null),
    [lastMidi, setLastMidi] = useState("");
  const previous = useRef<Pick<Gamepad, "buttons" | "axes"> | null>(null);
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const access = useRef<MIDIAccess | null>(null);
  const current = pads.find((p) => device === `pad:${p.index}:${p.id}`);
  const persist = (p: Profile) => {
    onProfile(p);
    if (current)
      localStorage.setItem("backstage:pad:" + current.id, JSON.stringify(p));
  };
  useEffect(() => {
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      if (now - last > 70) {
        const connected = Array.from(navigator.getGamepads()).filter(
          (p): p is Gamepad => !!p?.connected,
        );
        setPads(connected);
        const pad = connected.find((p) => device === `pad:${p.index}:${p.id}`);
        if (pad) {
          if (captureRef.current && previous.current) {
            const binding = newlyPressed(pad, previous.current);
            if (binding) {
              const updated = {
                ...profile,
                bindings: {
                  ...profile.bindings,
                  [captureRef.current]: binding,
                },
              };
              onProfile(updated);
              localStorage.setItem(
                "backstage:pad:" + pad.id,
                JSON.stringify(updated),
              );
              setCapture(null);
            }
          }
          previous.current = {
            buttons: pad.buttons.map((b) => ({
              pressed: b.pressed,
              touched: b.touched,
              value: b.value,
            })),
            axes: [...pad.axes],
          };
        } else previous.current = null;
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [device, profile]);
  useEffect(() => {
    if (!midi) return;
    const handler = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || (data[0] & 0xf0) !== 0x90 || data[2] === 0) return;
      setLastMidi(`Note ${data[1]} · velocity ${data[2]}`);
      if (midiLane !== null) {
        let map = {};
        try {
          map = JSON.parse(
            localStorage.getItem("backstage:midi:" + midi.id) || "{}",
          );
        } catch {}
        localStorage.setItem(
          "backstage:midi:" + midi.id,
          JSON.stringify({ ...map, [data[1]]: midiLane }),
        );
        setMidiLane(null);
      }
    };
    midi.input.addEventListener("midimessage", handler);
    return () => midi.input.removeEventListener("midimessage", handler);
  }, [midi, midiLane]);
  useEffect(
    () => () => {
      if (access.current) access.current.onstatechange = null;
    },
    [],
  );
  async function connectMidi() {
    try {
      if (!navigator.requestMIDIAccess)
        throw Error("MIDI is unavailable on this system.");
      const a = await navigator.requestMIDIAccess({ sysex: false });
      access.current = a;
      const refresh = () =>
        setPorts(
          Array.from(a.inputs.values()).map((input) => ({
            id: input.id,
            name: input.name || "MIDI input",
            input,
          })),
        );
      a.onstatechange = refresh;
      refresh();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "MIDI access was denied.");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>Find your rhythm.</h1>
          <p>Connect a controller. Press a button. Make every input count.</p>
        </div>
        <span className="pill">
          <i />
          {pads.length} gamepad{pads.length === 1 ? "" : "s"} detected
        </span>
      </div>
      <div className="controller-layout">
        <section className="panel device-list">
          <h3>Your inputs</h3>
          <button
            className={"device " + (device === "keyboard" ? "selected" : "")}
            onClick={() => onDevice("keyboard")}
          >
            <span className="device-icon">⌨</span>
            <div>
              <strong>Keyboard</strong>
              <small>Always ready · A S D F G</small>
            </div>
          </button>
          {pads.map((p) => (
            <button
              className={
                "device " +
                (device === `pad:${p.index}:${p.id}` ? "selected" : "")
              }
              key={p.index}
              onClick={() => {
                onDevice(`pad:${p.index}:${p.id}`);
                onProfile(loadProfile(p.id));
                setCapture(null);
                previous.current = null;
              }}
            >
              <span className="device-icon">✣</span>
              <div>
                <strong>{p.id}</strong>
                <small>
                  {p.mapping === "standard"
                    ? "Standard gamepad"
                    : "Custom mapping"}{" "}
                  · {p.buttons.length} buttons / {p.axes.length} axes
                </small>
              </div>
            </button>
          ))}
          {!pads.length && (
            <p className="muted small">
              Plug in or pair a gamepad, then press one of its buttons. Devices
              must be visible to the operating system and Chromium.
            </p>
          )}
          <div className="divider" />
          <button className="secondary wide" onClick={connectMidi}>
            Connect MIDI drums
          </button>
          {ports.map((p) => (
            <button
              key={p.id}
              className={
                "device " +
                (device === "midi" && midi?.id === p.id ? "selected" : "")
              }
              onClick={() => {
                onDevice("midi");
                onMidi(p);
              }}
            >
              <span className="device-icon">◉</span>
              <div>
                <strong>{p.name}</strong>
                <small>{p.input.state}</small>
              </div>
            </button>
          ))}
          {error && <p className="error-text">{error}</p>}
        </section>
        <section className="panel mapping-panel">
          <div className="section-heading">
            <h3>
              {current
                ? "Map your controller"
                : device === "midi"
                  ? "MIDI drum pads"
                  : "Keyboard controls"}
            </h3>
            {current && (
              <button
                className="text-button"
                onClick={() => persist(defaultProfile())}
              >
                Reset mapping
              </button>
            )}
          </div>
          {current ? (
            <>
              <p className="muted">
                Choose an action, then press a button or move a stick. Settings
                are saved for this device.
              </p>
              <div className="mapping-grid">
                {actions.map((a, i) => {
                  const binding = profile.bindings[a];
                  return (
                    <div className="mapping-row" key={a}>
                      <span>
                        <i className={"lane-dot lane-" + i} />
                        {actionLabels[a]}
                      </span>
                      <button
                        className={capture === a ? "capture" : ""}
                        onClick={() => setCapture(capture === a ? null : a)}
                      >
                        {capture === a
                          ? "Listening…"
                          : binding.type === "button"
                            ? `Button ${binding.index}`
                            : `Axis ${binding.index} ${binding.direction === 1 ? "+" : "−"}`}
                      </button>
                    </div>
                  );
                })}
              </div>
              <label className="slider-label">
                Axis threshold <b>{Math.round(profile.deadzone * 100)}%</b>
                <input
                  type="range"
                  min=".15"
                  max=".9"
                  step=".05"
                  value={profile.deadzone}
                  onChange={(e) =>
                    persist({ ...profile, deadzone: Number(e.target.value) })
                  }
                />
              </label>
              <div className="section-heading">
                <h3>Live input</h3>
                <span className="tiny muted">Press and move to test</span>
              </div>
              <div className="button-meter">
                {current.buttons.map((b, i) => (
                  <span key={i} className={b.pressed ? "pressed" : ""}>
                    {i}
                  </span>
                ))}
              </div>
              <div className="axes">
                {current.axes.map((v, i) => (
                  <label key={i}>
                    Axis {i}
                    <meter min="-1" max="1" value={v} />
                    <code>{v.toFixed(2)}</code>
                  </label>
                ))}
              </div>
            </>
          ) : device === "midi" ? (
            <>
              <p className="muted">
                General MIDI drum notes work by default. Choose a lane and
                strike a pad to teach a different mapping.
              </p>
              <div className="mapping-grid">
                {[0, 1, 2, 3, 4].map((l) => (
                  <div className="mapping-row" key={l}>
                    <span>
                      <i className={"lane-dot lane-" + l} />
                      {actionLabels[`lane${l}` as Action]}
                    </span>
                    <button
                      onClick={() => setMidiLane(midiLane === l ? null : l)}
                    >
                      {midiLane === l ? "Strike a pad…" : "Learn pad"}
                    </button>
                  </div>
                ))}
              </div>
              <p className="live-message">
                {lastMidi || "Waiting for a drum hit…"}
              </p>
              <p className="muted small">
                Select the Drums track in your library to play.
              </p>
            </>
          ) : (
            <>
              <div className="keyboard-visual">
                {["A", "S", "D", "F", "G"].map((key, i) => (
                  <div key={key}>
                    <kbd>{key}</kbd>
                    <i className={"lane-dot lane-" + i} />
                  </div>
                ))}
              </div>
              <p className="muted">
                Tap mode: press the matching keys at the line. Strum mode: hold
                the keys and press Space or ↑ / ↓. Shift activates Star Power;
                hold W to whammy. Escape pauses.
              </p>
            </>
          )}
        </section>
      </div>
      <p className="footnote">
        Xbox, PlayStation, Switch-style and generic controllers can be mapped
        when Chromium exposes their inputs. Detection does not certify a model.
        The existing Xbox Riffmaster USB bridge is not part of this build.
      </p>
    </>
  );
}
