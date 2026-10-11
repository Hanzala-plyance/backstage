import { useEffect, useState } from "react";
import {
  asGamepad,
  onRiff,
  riffName,
  riffNumber,
  type RiffPad,
  type RiffReport,
  type RiffStatus,
} from "./core/riff";
const message = (e: unknown) =>
  String((e as Error).message || e).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
const RIFF = 16;
/** One light per port: green playing, yellow waiting, grey released, red
 * held or failed. */
const light = (p: RiffPad) =>
  p.connected
    ? "on"
    : p.state === "released"
      ? "off"
      : p.state === "held" || p.state === "error"
        ? "bad"
        : "wait";
const portLabel = (key: string) => `USB ${key.replace(/^usb:/, "")}`;
const ago = (ms: number) =>
  ms < 1500 ? "just now" : `${Math.round(ms / 1000)} s ago`;
/** Controller tools: a pull-out drawer that shows every controller as the
 * computer sees it, lets a person release or reconnect a Riffmaster port,
 * and copies a debug report. Staff tools (Shift-click the title) hold the
 * recovery steps that need administrator approval. */
export default function ControllerTools({
  players,
  onRelease,
  onClose,
}: {
  /** Joined players: who each controller belongs to. */
  players: { device: string; name: string }[];
  /** Takes a controller away from its player (Player 1 falls back to the
   * keyboard). */
  onRelease: (device: string) => void;
  onClose: () => void;
}) {
  const [ports, setPorts] = useState<RiffPad[]>([]),
    [status, setStatus] = useState<RiffStatus | null>(null),
    [pads, setPads] = useState<Gamepad[]>([]),
    [busy, setBusy] = useState(""),
    [note, setNote] = useState(""),
    [report, setReport] = useState(""),
    [staff, setStaff] = useState(false),
    [readers, setReaders] = useState<RiffReport["macriff"]>([]);
  const refresh = () =>
    window.backstage
      .riffStatus()
      .then(setStatus)
      .catch(() => {});
  useEffect(() => {
    void refresh();
    const stop = onRiff(setPorts);
    // Other controllers, as Chromium reports them.
    const timer = setInterval(() => {
      setPads(
        Array.from(navigator.getGamepads()).filter(
          (p): p is Gamepad => !!p && p.index < RIFF,
        ),
      );
      void refresh();
    }, 250);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!staff) return;
    const load = () =>
      window.backstage
        .riffReport()
        .then((r) => setReaders(r.macriff))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [staff]);
  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setNote("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setNote(message(e));
    } finally {
      setBusy("");
    }
  };
  const ownerOf = (device: string) => {
    const i = players.findIndex((p) => p.device === device);
    if (i < 0) return null;
    const name = players[i].name;
    return `Player ${i + 1}` + (name === `P${i + 1}` ? "" : ` · ${name}`);
  };
  const riffDevice = (p: RiffPad) =>
    players.find((l) => l.device === `pad:${p.index}:${asGamepad(p).id}`)
      ?.device ?? null;
  const copyReport = async () => {
    const text = JSON.stringify(
      {
        ...(await window.backstage.riffReport()),
        app: navigator.userAgent,
        gamepads: Array.from(navigator.getGamepads())
          .filter((p): p is Gamepad => !!p)
          .map((p) => ({
            index: p.index,
            id: p.id,
            connected: p.connected,
            mapping: p.mapping,
            pressed: p.buttons.flatMap((b, i) => (b.pressed ? [i] : [])),
          })),
        players: players.map((p, i) => ({ player: i + 1, device: p.device })),
      },
      null,
      2,
    );
    setReport(text);
    try {
      await window.backstage.copyText(text);
      setNote("Debug report copied. Paste it into a message or issue.");
    } catch {
      setNote("Couldn’t reach the clipboard; the report is shown below.");
    }
  };
  const stale = readers.filter((r) => r.stale);
  const admin = status?.mode === "admin";
  return (
    <div className="tools-backdrop" onClick={onClose}>
      <aside
        className="tools-drawer"
        role="dialog"
        aria-label="Controller tools"
        data-menu-scope
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2
            title="Shift-click for staff tools"
            onClick={(e) => e.shiftKey && setStaff((s) => !s)}
          >
            Controller tools
          </h2>
          <button className="secondary" onClick={onClose} data-menu-default>
            Close
          </button>
        </header>
        <section aria-label="Riffmaster ports">
          <h3>Riffmaster receivers</h3>
          {!ports.length && (
            <p className="muted">
              No Riffmaster receivers plugged in. Plug the guitar’s USB receiver
              into this computer.
            </p>
          )}
          {ports.map((p) => {
            const device = riffDevice(p);
            const name = riffName(riffNumber(p));
            const input = p.packets?.["0x20"] ?? 0;
            return (
              <article
                key={p.key}
                className="tools-row"
                aria-label={`${name} on ${portLabel(p.key)}`}
              >
                <i className={`tools-light ${light(p)}`} />
                <div>
                  <strong>{name}</strong>
                  <small>
                    {portLabel(p.key)}
                    {device && ` · ${ownerOf(device)}`}
                  </small>
                  <p className="tools-reason">{p.reason}</p>
                  {p.state === "open" && (
                    <small className="muted">
                      {input} input packet{input === 1 ? "" : "s"}
                      {p.quietFor != null && ` · last ${ago(p.quietFor)}`}
                    </small>
                  )}
                </div>
                <div className="tools-actions">
                  {p.state === "open" || p.state === "opening" ? (
                    <>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          run("reconnect", () =>
                            window.backstage.riffReconnect(p.key),
                          )
                        }
                      >
                        Reconnect
                      </button>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          run("release", () =>
                            window.backstage.riffRelease(p.key),
                          )
                        }
                      >
                        Release
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary"
                      disabled={!!busy || admin}
                      onClick={() =>
                        run("connect", () =>
                          window.backstage.riffConnectPort(p.key),
                        )
                      }
                    >
                      Connect
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          <small className="muted">
            Release lets this computer’s other apps use a receiver; it stays
            released, even if replugged, until you connect it. Reconnect fixes a
            guitar whose light stays yellow.
          </small>
        </section>
        <section aria-label="Other controllers">
          <h3>Other controllers</h3>
          {!pads.length && (
            <p className="muted">
              No other controllers. Plug one in and press a button so the
              computer reports it.
            </p>
          )}
          {pads.map((p) => {
            const device = `pad:${p.index}:${p.id}`;
            const owner = ownerOf(device);
            const pressed = p.buttons.flatMap((b, i) => (b.pressed ? [i] : []));
            return (
              <article
                key={device}
                className="tools-row"
                aria-label={`Controller ${p.index}: ${p.id}`}
              >
                <i className={`tools-light ${p.connected ? "on" : "bad"}`} />
                <div>
                  <strong>{p.id}</strong>
                  <small>
                    Slot {p.index} ·{" "}
                    {p.mapping === "standard"
                      ? "standard layout"
                      : "custom layout"}
                    {owner && ` · ${owner}`}
                  </small>
                  <small className="muted">
                    {pressed.length
                      ? `Pressed: ${pressed.join(", ")}`
                      : "Press a button to test"}
                  </small>
                </div>
                <div className="tools-actions">
                  {owner && (
                    <button
                      className="secondary"
                      onClick={() => onRelease(device)}
                    >
                      Unassign
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
        <section aria-label="Debug">
          <div className="tools-buttons">
            <button
              className="secondary"
              disabled={!!busy || admin}
              onClick={() => run("all", () => window.backstage.riffConnect())}
            >
              {busy === "all" ? "Connecting…" : "Connect all receivers"}
            </button>
            <button className="secondary" onClick={() => void copyReport()}>
              Copy debug report
            </button>
          </div>
          {note && (
            <p className="tools-note" role="status">
              {note}
            </p>
          )}
          {report && (
            <textarea
              className="tools-report"
              readOnly
              aria-label="Debug report"
              value={report}
            />
          )}
        </section>
        {staff && (
          <section className="tools-staff" aria-label="Staff tools">
            <h3>Staff tools</h3>
            <p className="muted">
              These need administrator approval on this Mac. Don’t use them
              during a customer’s set.
            </p>
            <h4>MacRiff readers</h4>
            {!readers.length && (
              <p className="muted">No MacRiff readers are running.</p>
            )}
            {readers.map((r) => (
              <div key={r.pid} className="tools-reader">
                <i className={`tools-light ${r.stale ? "bad" : "wait"}`} />
                <span>
                  {r.kind === "reader" ? "Reader" : "Supervisor"} {r.pid}
                  {r.device && ` · ${r.device}`} · started {r.started}
                  <small>{r.reason}</small>
                </span>
              </div>
            ))}
            {!!stale.length && (
              <button
                className="secondary wide"
                disabled={!!busy}
                onClick={() =>
                  run("stop", async () => {
                    const result = await window.backstage.riffStopReaders(
                      stale.map((r) => r.pid),
                    );
                    if (result.error) throw new Error(result.error);
                    setNote(
                      `Stopped ${result.stopped.length} reader${result.stopped.length === 1 ? "" : "s"}. Reconnecting…`,
                    );
                  })
                }
              >
                {busy === "stop"
                  ? "Waiting for approval…"
                  : `Stop ${stale.length} stale reader${stale.length === 1 ? "" : "s"} (asks for the Mac password)`}
              </button>
            )}
            <h4>Administrator reader</h4>
            <small className="muted">
              Only if a receiver still can’t be opened after stale readers are
              stopped.
            </small>
            <button
              className="secondary wide"
              disabled={!!busy}
              onClick={() =>
                run("admin", () =>
                  admin
                    ? window.backstage.riffDisconnect()
                    : window.backstage.riffAdmin(),
                )
              }
            >
              {busy === "admin"
                ? "Waiting for approval…"
                : admin
                  ? "Stop administrator reader"
                  : "Use administrator reader"}
            </button>
          </section>
        )}
      </aside>
    </div>
  );
}
