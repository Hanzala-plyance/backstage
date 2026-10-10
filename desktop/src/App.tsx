import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type {
  LoadedSong,
  Profile,
  QueueJob,
  SearchResult,
  Settings,
  Song,
  Part,
  Level,
} from "./types";
import { defaultProfile, loadProfile } from "./core/input";
import {
  MenuPad,
  activateFocused,
  focusFirst,
  moveFocus,
  type MenuButton,
} from "./core/menu";
import ButtonHints, { type Hint } from "./ButtonHints";
import {
  MAX_PLAYERS,
  addPlayer,
  cycleDevice,
  cycleLevel,
  cyclePart,
  deviceLabel,
  fitToSong,
  freeDevices,
  isPad,
  lineupProblem,
  type PlayerSetup,
} from "./core/players";
import { MainMenu, TitleScreen, type MenuChoice } from "./Title";
import { Preview } from "./core/preview";
import SongInfo, { artUrl, bestStars, type Scores } from "./SongInfo";
import Stars from "./Stars";
import type { PlayerInit } from "./game/player";
import Controllers from "./Controllers";
import type { MidiPort } from "./game/Game";
const Game = lazy(() => import("./game/Game"));
const pages = ["library", "search", "queue", "controllers", "settings"];
const levels: Level[] = ["Easy", "Medium", "Hard", "Expert"];
const duration = (seconds: number | null) =>
  seconds
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "—";
function Icon({ name }: { name: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "library" ? (
        <>
          <path d="M4 5h3v15H4zM10 5h3v15h-3zM16 4l3-1 4 15-3 1z" />
        </>
      ) : name === "search" ? (
        <>
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 5 5" />
        </>
      ) : name === "queue" ? (
        <>
          <path d="M4 6h16M4 12h11M4 18h8" />
          <path d="m17 15 4 3-4 3z" />
        </>
      ) : name === "controllers" ? (
        <>
          <path d="M7 7h10c3 0 4 3 4 7s-2 5-4 2l-1-1H8l-1 1c-2 3-4 2-4-2s1-7 4-7Z" />
          <path d="M6 11h4M8 9v4M16 10h.01M18 12h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="m9 3-1 3-3 1-2 3 2 3-1 3 3 2 3-1 3 2 3-2v-3l3-2-1-3-3-1-1-3Z" />
        </>
      )}
    </svg>
  );
}
export default function App() {
  const [page, setPage] = useState("library"),
    [songs, setSongs] = useState<Song[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [root, setRoot] = useState(""),
    [filter, setFilter] = useState(""),
    [selected, setSelected] = useState<Song | null>(null),
    [part, setPart] = useState<Part>("Guitar"),
    [level, setLevel] = useState<Level>("Easy"),
    [playing, setPlaying] = useState<{
      song: LoadedSong;
      players: PlayerInit[];
    } | null>(null),
    [screen, setScreen] = useState<"title" | "menu" | "app">("title"),
    [lineup, setLineup] = useState<PlayerSetup[]>([]),
    [pads, setPads] = useState<Gamepad[]>([]),
    [confirmRemove, setConfirmRemove] = useState(false);
  const preview = useRef(new Preview());
  const [scores, setScores] = useState<Scores>({}),
    [focusId, setFocusId] = useState<string | null>(null);
  const loadScores = () =>
    void window.backstage
      .scores()
      .then(setScores)
      .catch(() => {});
  const selectedRef = useRef<Song | null>(null);
  selectedRef.current = selected;
  const [query, setQuery] = useState(""),
    [provider, setProvider] = useState<"youtube" | "charts">("youtube"),
    [results, setResults] = useState<SearchResult[]>([]),
    [searched, setSearched] = useState(false),
    [jobs, setJobs] = useState<QueueJob[]>([]),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [settings, setSettings] = useState<Settings | null>(null);
  const [device, setDevice] = useState("keyboard"),
    [profile, setProfile] = useState<Profile>(defaultProfile),
    [midi, setMidi] = useState<MidiPort>(),
    [offset, setOffset] = useState(() =>
      Number(localStorage.getItem("backstage:offset") || 0),
    ),
    [mode, setMode] = useState<"tap" | "strum">(() =>
      localStorage.getItem("backstage:mode") === "tap" ? "tap" : "strum",
    );
  const [padHints, setPadHints] = useState(() =>
    Array.from(navigator.getGamepads?.() ?? []).some((p) => p?.connected),
  );
  const navigate = useRef<(b: MenuButton) => void>(() => {});
  const returnFocus = useRef<HTMLElement | null>(null);
  const later = (fn: () => void) => setTimeout(fn, 40);
  const back = () => {
    const el = document.activeElement as HTMLElement | null;
    if (confirmRemove) {
      setConfirmRemove(false);
      later(() => focusFirst());
    } else if (selected) setSelected(null);
    else if (el?.matches("input, select")) el.blur();
    else if (page !== "library") {
      setPage("library");
      setError("");
      void action("library", refresh);
      later(() => focusFirst());
    } else {
      setScreen("menu");
      later(() => focusFirst());
    }
  };
  const enterMenu = () => {
    setScreen("menu");
    later(() => focusFirst());
  };
  const chooseMenu = (choice: MenuChoice) => {
    if (choice === "quit") return window.close();
    setScreen("app");
    setError("");
    if (choice === "quickplay" || choice === "practice") {
      setPage("library");
      void action("library", refresh);
      const practice = songs.find((s) => s.practice);
      if (choice === "practice" && practice) choose(practice);
      else later(() => focusFirst());
    } else {
      setPage(choice);
      if (choice === "settings")
        void window.backstage.settings().then(setSettings);
      later(() => focusFirst());
    }
  };
  navigate.current = (b) => {
    setPadHints(true);
    if (screen === "title") {
      if (b === "green" || b === "start") enterMenu();
      return;
    }
    if (screen === "menu" && b === "red") {
      setScreen("title");
      return;
    }
    if (b === "up" || b === "down") moveFocus(b === "up" ? -1 : 1);
    else if (b === "green") activateFocused();
    else if (b === "red") back();
    else if (b === "blue" && !selected && screen === "app") askRemove();
    else if (b === "yellow" && !selected && screen === "app") {
      const next = pages[(pages.indexOf(page) + 1) % pages.length];
      setPage(next);
      setError("");
      if (next === "library") void action("library", refresh);
      if (next === "settings")
        void window.backstage.settings().then(setSettings);
      later(() => focusFirst());
    }
  };
  // Guitar and gamepad menu navigation, using each pad's saved mapping.
  useEffect(() => {
    if (playing) return;
    const menu = new MenuPad(),
      profiles = new Map<string, ReturnType<typeof loadProfile>>();
    const profileFor = (pad: Gamepad) => {
      if (device === `pad:${pad.index}:${pad.id}`) return profile;
      let p = profiles.get(pad.id);
      if (!p) profiles.set(pad.id, (p = loadProfile(pad.id)));
      return p;
    };
    let frame = 0,
      padKey = "";
    const tick = (now: number) => {
      const all = navigator.getGamepads();
      // Track connected pads for the player lobby.
      const connected = Array.from(all).filter(
        (p): p is Gamepad => !!p?.connected,
      );
      const key = connected.map((p) => `${p.index}:${p.id}`).join("|");
      if (key !== padKey) {
        padKey = key;
        setPads(connected);
      }
      const pressed = menu.poll(now, all, profileFor);
      // Controllers captures raw presses while remapping.
      if (!document.body.hasAttribute("data-capturing"))
        pressed.forEach((b) => navigate.current(b));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const connected = () => setPadHints(true);
    window.addEventListener("gamepadconnected", connected);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("gamepadconnected", connected);
    };
  }, [playing, device, profile]);
  useEffect(() => {
    if (playing) return;
    const keydown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (screen === "title") {
        if (e.key === "Enter" || e.key === " ") {
          setPadHints(false);
          e.preventDefault();
          enterMenu();
        }
        return;
      }
      if (e.key === "Escape" && screen === "menu") {
        setPadHints(false);
        setScreen("title");
      } else if (e.key === "Escape") {
        setPadHints(false);
        e.preventDefault();
        back();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (
          document.body.hasAttribute("data-capturing") ||
          el?.matches("select, input[type=number], input[type=range]")
        )
          return;
        setPadHints(false);
        e.preventDefault();
        moveFocus(e.key === "ArrowUp" ? -1 : 1);
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        el?.matches(".song-row")
      ) {
        setPadHints(false);
        e.preventDefault();
        askRemove();
      } else if (e.key === "Enter" && (!el || el === document.body)) {
        setPadHints(false);
        e.preventDefault();
        focusFirst();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  // Previews only play while choosing in the library.
  useEffect(() => {
    if (page !== "library" || screen !== "app" || playing)
      preview.current.stop();
  }, [page, screen, playing]);
  useEffect(() => {
    if (!selected) preview.current.stop();
  }, [selected]);
  useEffect(() => {
    if (confirmRemove) later(() => focusFirst());
  }, [confirmRemove]);
  useEffect(() => {
    if (selected) {
      returnFocus.current ??= document.activeElement as HTMLElement;
      later(() => focusFirst());
    } else if (returnFocus.current) {
      const el = returnFocus.current;
      returnFocus.current = null;
      if (el.isConnected) el.focus({ preventScroll: true });
    }
  }, [selected]);
  async function action<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(name);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy("");
    }
  }
  // Readable folder names and online covers, in the background. Starting a
  // song waits for it so a folder is never renamed under a loading song.
  const tidying = useRef<Promise<unknown>>(Promise.resolve());
  function tidy() {
    tidying.current = tidying.current
      .then(() => window.backstage.tidyLibrary())
      .then(async (result) => {
        if (!result.renamed && !result.covers) return;
        await refresh();
        if (result.covers)
          setNotice(
            `Found ${result.covers} album cover${result.covers === 1 ? "" : "s"}`,
          );
      })
      .catch(() => {});
  }
  async function findCover() {
    if (!selected) return;
    const ok = await action("cover", () =>
      window.backstage.findCover(selected.id),
    );
    if (!ok) return;
    const data = await window.backstage.library();
    setSongs(data.songs);
    setSelected(data.songs.find((s) => s.id === selected.id) ?? null);
    setNotice("Album cover updated");
  }
  async function refresh() {
    const data = await window.backstage.library();
    setSongs(data.songs);
    setWarnings(data.warnings);
    setRoot(data.root);
  }
  useEffect(() => {
    void action("library", async () => {
      await refresh();
      setSettings(await window.backstage.settings());
    }).then(tidy);
    loadScores();
  }, []);
  const installed = useRef(new Set<string>()),
    seeded = useRef(false);
  useEffect(() => {
    if (playing) return;
    let alive = true;
    const poll = async () => {
      try {
        const list = await window.backstage.queue();
        if (!alive) return;
        setJobs(list);
        // Show newly installed songs without a manual refresh.
        const fresh = list.filter(
          (j) =>
            j.library?.status === "installed" && !installed.current.has(j.id),
        );
        fresh.forEach((j) => installed.current.add(j.id));
        if (fresh.length && seeded.current) {
          void refresh().then(tidy);
          setNotice(
            fresh.length === 1
              ? `“${fresh[0].title}” is ready in your library`
              : `${fresh.length} songs added to your library`,
          );
        }
        seeded.current = true;
      } catch {}
    };
    void poll();
    const timer = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [playing]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const focusSong =
    songs.find((s) => s.id === focusId) ??
    songs.find((s) => !s.practice) ??
    songs[0];
  // Installed songs (and installed songs since removed) leave the queue.
  const queued = jobs.filter(
    (j) => !["installed", "missing"].includes(j.library?.status ?? ""),
  );
  const active = jobs.filter(
    (j) => !["complete", "error"].includes(j.status),
  ).length;
  const available = [
    "keyboard",
    ...(midi ? ["midi"] : []),
    ...pads.map((p) => `pad:${p.index}:${p.id}`),
  ];
  const padId = (d: string) => d.split(":").slice(2).join(":");
  const profileOf = (d: string) =>
    d === device
      ? profile
      : isPad(d)
        ? loadProfile(padId(d))
        : defaultProfile();
  const lineupAll = (): PlayerSetup[] => [{ device, part, level }, ...lineup];
  // Player 1 is the Controllers selection; changing it here changes that too.
  const applyLineup = (next: PlayerSetup[]) => {
    const [first, ...rest] = next;
    if (first.device !== device) {
      setDevice(first.device);
      setProfile(
        isPad(first.device)
          ? loadProfile(padId(first.device))
          : defaultProfile(),
      );
    }
    setPart(first.part);
    setLevel(first.level);
    setLineup(rest);
  };
  const choose = (song: Song) => {
    setSelected(song);
    setConfirmRemove(false);
    preview.current.hover(song);
    setFocusId(song.id);
    setLineup((l) => fitToSong(l, song));
    const chart =
      song.charts.find((c) => c.part === "Guitar" && c.level === "Easy") ||
      song.charts[0];
    setPart(chart.part);
    setLevel(chart.level);
  };
  const changePart = (p: Part) => {
    setPart(p);
    if (!selected?.charts.some((c) => c.part === p && c.level === level))
      setLevel(selected!.charts.find((c) => c.part === p)!.level);
  };
  // Blue (or Delete) on a focused song asks to remove it.
  const askRemove = () => {
    const id = (document.activeElement as HTMLElement | null)?.dataset?.songId;
    const song = songs.find((s) => s.id === id);
    if (!song || song.practice || page !== "library") return;
    choose(song);
    setConfirmRemove(true);
  };
  async function removeSong() {
    if (!selected || selected.practice) return;
    preview.current.stop();
    const removed = await action("remove", () =>
      window.backstage.removeSong(selected.id),
    );
    if (!removed) return;
    returnFocus.current = null;
    setConfirmRemove(false);
    setSelected(null);
    await refresh();
    setNotice(
      `Removed “${removed.title}”. It’s in the Trash if you change your mind.`,
    );
    later(() => focusFirst());
  }
  async function play() {
    if (!selected) return;
    preview.current.stop();
    const all = lineupAll();
    const problem = lineup.length ? lineupProblem(all, available) : null;
    if (problem) return setError(problem);
    await tidying.current;
    const loaded = await action("play", () =>
      Promise.all(
        all.map((p) => window.backstage.loadSong(selected.id, p.part, p.level)),
      ),
    );
    if (!loaded) return;
    setPlaying({
      song: loaded[0],
      players: all.map((p, i) => ({
        device: p.device,
        chart: loaded[i].chart,
        profile: profileOf(p.device),
        label: `Player ${i + 1}`,
      })),
    });
  }
  async function enqueue(result: SearchResult) {
    const job = await action(result.id, () =>
      window.backstage.enqueue(result.url, result.title),
    );
    if (job) {
      setNotice("Added to your preparation queue");
      setJobs(await window.backstage.queue());
    }
  }
  async function search() {
    setSearched(false);
    setResults([]);
    const data = await action("search", () =>
      window.backstage.search(query, provider),
    );
    if (data) {
      setResults(data.results);
      setSearched(true);
    }
  }
  async function importAudio() {
    const job = await action("import", () => window.backstage.importAudio());
    if (job) {
      setPage("queue");
      setJobs(await window.backstage.queue());
    }
  }
  if (playing)
    return (
      <Suspense
        fallback={<div className="loading">Getting your stage ready…</div>}
      >
        <Game
          song={playing.song}
          players={playing.players}
          midi={midi}
          offset={offset}
          mode={mode}
          onExit={() => {
            returnFocus.current = null;
            setPlaying(null);
            loadScores();
            setSelected(null);
            void refresh();
            later(() => focusFirst());
          }}
        />
      </Suspense>
    );
  if (screen === "title")
    return <TitleScreen pad={padHints} onStart={enterMenu} />;
  if (screen === "menu")
    return <MainMenu pad={padHints} onChoose={chooseMenu} />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="drag-region" />
        <div className="brand">
          <img src="/wordmark.png" alt="Backstage" />
        </div>
        <span className="sidebar-caption">YOUR NEXT ENCORE</span>
        <nav>
          {[
            ["library", "Song library"],
            ["search", "Add new songs"],
            ["queue", "Preparation queue"],
            ["controllers", "Controllers"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setPage(key);
                setError("");
                if (key === "library") void action("library", refresh);
              }}
              className={page === key ? "active" : ""}
            >
              <Icon name={key} />
              <span>{label}</span>
              {key === "queue" && active > 0 && (
                <b className="count">{active}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="ready-indicator">
            <i />
            <span>
              Local play ready
              <small>
                {device === "keyboard"
                  ? "Keyboard connected"
                  : device === "midi"
                    ? "MIDI input selected"
                    : "Gamepad selected"}
              </small>
            </span>
          </div>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => {
              setPage("settings");
              void window.backstage.settings().then(setSettings);
            }}
          >
            <Icon name="settings" />
            Settings
          </button>
          <span className="build-label">BACKSTAGE / 0.2 · DEVELOPMENT</span>
        </div>
      </aside>
      <main className="main-content" data-menu-scope>
        <div className="window-drag" />
        {notice && (
          <div className="toast" role="status">
            ✓ {notice}
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {page === "library" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">THE STAGE IS YOURS</span>
                <h1>
                  Good music.
                  <br />
                  Great company.
                </h1>
                <p>Your songs, your instruments, your next encore.</p>
              </div>
              <button className="primary" onClick={() => setPage("search")}>
                ＋ Add new songs
              </button>
            </div>
            <section className="practice-banner">
              <div className="record-art">
                <div />
                <span>B</span>
              </div>
              <div>
                <span className="eyebrow">A LITTLE SOUNDCHECK</span>
                <h2>Meet your new stage.</h2>
                <p>
                  A short original track. Get a feel for the notes
                  <br />
                  and check your controls before the main event.
                </p>
                <button
                  className="light-button"
                  onClick={() => choose(songs.find((s) => s.practice)!)}
                  disabled={!songs.length}
                >
                  Try the practice track <span>↗</span>
                </button>
              </div>
              <span className="banner-corner">
                32 SEC
                <br />
                ZERO PRESSURE
              </span>
            </section>
            <div className="section-heading library-heading">
              <h2>
                Your library{" "}
                <span>{songs.filter((s) => !s.practice).length}</span>
              </h2>
              <div className="inline-actions">
                <label className="filter">
                  <Icon name="search" />
                  <input
                    aria-label="Search your library"
                    placeholder="Find a song or artist"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label="Refresh library"
                  onClick={() => void action("library", refresh)}
                >
                  ↻
                </button>
              </div>
            </div>
            <div className="library-browse">
              <div className="song-table">
                <div className="song-table-head">
                  <span>TRACK / ARTIST</span>
                  <span>INSTRUMENTS</span>
                  <span>TIME</span>
                  <span />
                </div>
                {songs
                  .filter((s) =>
                    (s.title + " " + s.artist)
                      .toLowerCase()
                      .includes(filter.toLowerCase()),
                  )
                  .map((song, i) => (
                    <button
                      className="song-row"
                      key={song.id}
                      data-menu-default={i === 0 ? "" : undefined}
                      data-song-id={song.id}
                      onClick={() => choose(song)}
                      onMouseMove={(e) => {
                        // Rows scrolling under a resting cursor (controller
                        // or key navigation) fire moves with no movement;
                        // they must not steal the highlight.
                        if (!e.movementX && !e.movementY) return;
                        if (preview.current.playing === song.id) return;
                        preview.current.hover(song);
                        setFocusId(song.id);
                      }}
                      onFocus={() => {
                        preview.current.hover(song);
                        setFocusId(song.id);
                      }}
                      onMouseLeave={() => {
                        if (selectedRef.current?.id !== song.id)
                          preview.current.leave(song);
                      }}
                      onBlur={() =>
                        setTimeout(() => {
                          if (
                            selectedRef.current?.id !== song.id &&
                            !document.activeElement?.closest(".song-row")
                          )
                            preview.current.leave(song);
                        })
                      }
                    >
                      <div className="track-cell">
                        <span className={"cover cover-" + (i % 4)}>
                          {song.art ? (
                            <img src={artUrl(song)} alt="" loading="lazy" />
                          ) : song.practice ? (
                            "✦"
                          ) : (
                            song.title.charAt(0).toUpperCase()
                          )}
                        </span>
                        <div>
                          <strong>
                            {song.title}
                            {song.practice && <em>Practice</em>}
                          </strong>
                          <small>{song.artist}</small>
                          {bestStars(song, scores) >= 0 && (
                            <Stars count={bestStars(song, scores)} small />
                          )}
                        </div>
                      </div>
                      <span className="instrument-tags">
                        {[...new Set(song.charts.map((c) => c.part))].map(
                          (p) => (
                            <small key={p}>{p}</small>
                          ),
                        )}
                      </span>
                      <span className="duration">
                        {duration(song.duration)}
                      </span>
                      <span className="row-play">▶</span>
                    </button>
                  ))}
              </div>
              {focusSong && (
                <SongInfo
                  song={focusSong}
                  scores={scores}
                  length={duration(focusSong.duration)}
                />
              )}
            </div>
            {songs.length === 1 && (
              <div className="empty-library">
                <span>Room for your favorites.</span>
                <p>
                  Search for a song or add an audio file. Finished conversions
                  appear here.
                </p>
                <button className="text-button" onClick={importAudio}>
                  Add an audio file →
                </button>
              </div>
            )}
            {warnings.length > 0 && (
              <details className="warnings">
                <summary>
                  {warnings.length} song folder
                  {warnings.length === 1 ? "" : "s"} could not load
                </summary>
                {warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
            <p className="footnote">
              Songs stay on this computer. Supports five-lane MIDI charts and a
              complete song audio file.
            </p>
          </>
        )}
        {page === "search" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">BUILD YOUR SETLIST</span>
                <h1>One more song.</h1>
                <p>Find something you love. We’ll get it ready to play.</p>
              </div>
              <button
                className="secondary"
                onClick={importAudio}
                disabled={!!busy}
              >
                ＋ Add audio file
              </button>
            </div>
            <div className="search-card panel">
              <div className="segmented">
                <button
                  className={provider === "youtube" ? "selected" : ""}
                  onClick={() => {
                    setProvider("youtube");
                    setResults([]);
                    setSearched(false);
                  }}
                >
                  Find audio
                </button>
                <button
                  className={provider === "charts" ? "selected" : ""}
                  onClick={() => {
                    setProvider("charts");
                    setResults([]);
                    setSearched(false);
                  }}
                >
                  Community charts
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
                className="search-form"
              >
                <Icon name="search" />
                <input
                  autoFocus
                  aria-label="Search songs"
                  placeholder="Song title or artist…"
                  minLength={2}
                  maxLength={200}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={!!busy || query.trim().length < 2}
                >
                  {busy === "search" ? "Searching…" : "Search songs"}
                </button>
              </form>
              <p className="muted small">
                {provider === "youtube"
                  ? "Search YouTube audio, then queue a generated chart. Video and speech models are off for lighter preparation."
                  : "Discover community-authored charts on Chorus Encore. Downloads open in your browser."}
              </p>
            </div>
            <div className="section-heading">
              <h2>
                {searched
                  ? `${results.length} results`
                  : "Find your next favorite"}
              </h2>
              <span className="muted small">
                {provider === "youtube" ? "YouTube" : "Chorus Encore"}
              </span>
            </div>
            <div className="search-results">
              {results.map((result) => (
                <article className="search-result" key={result.id}>
                  {result.thumbnail ? (
                    <img src={result.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <div className="cover">♫</div>
                  )}
                  <div>
                    <strong>{result.title}</strong>
                    <p>{result.artist}</p>
                    <small>
                      {duration(result.duration)}
                      {result.charter && ` · Chart by ${result.charter}`}
                    </small>
                  </div>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      provider === "youtube"
                        ? void enqueue(result)
                        : void action(result.id, () =>
                            window.backstage.openChart(result.url),
                          )
                    }
                  >
                    {busy === result.id
                      ? "Adding…"
                      : provider === "youtube"
                        ? "＋ Queue song"
                        : "Open chart ↗"}
                  </button>
                </article>
              ))}
            </div>
            {searched && !results.length && (
              <div className="empty-state">
                No songs found. Try a different title or artist.
              </div>
            )}
            {provider === "youtube" && (
              <div className="panel link-import">
                <h3>Already have a link?</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem(
                      "url",
                    ) as HTMLInputElement;
                    void enqueue({
                      id: "link",
                      url: input.value,
                      title: "",
                      artist: "",
                      duration: null,
                    });
                  }}
                >
                  <input
                    type="url"
                    name="url"
                    placeholder="Paste a YouTube video link"
                    aria-label="YouTube video link"
                    required
                  />
                  <button className="secondary" disabled={!!busy}>
                    Add to queue
                  </button>
                </form>
              </div>
            )}
            <p className="footnote">
              Prepare music you’re authorized to use. Downloading or converting
              a track does not grant venue playback rights.
            </p>
          </>
        )}
        {page === "queue" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">BEHIND THE SCENES</span>
                <h1>Coming up next.</h1>
                <p>
                  Songs get ready here. Your finished tracks join the library.
                </p>
              </div>
              <span className="pill">{active} in progress</span>
            </div>
            {!queued.length ? (
              <div className="empty-state">
                <span className="empty-symbol">≋</span>
                <h2>A little quiet backstage.</h2>
                <p>Find a song to start preparing your next set.</p>
                <button className="primary" onClick={() => setPage("search")}>
                  Find a song →
                </button>
              </div>
            ) : (
              <div className="queue-list">
                {queued.map((job) => (
                  <article className="panel queue-item" key={job.id}>
                    <div className="section-heading">
                      <strong>{job.title}</strong>
                      <span className={"status-tag " + job.status}>
                        {job.library?.status === "installed"
                          ? "Ready to play"
                          : job.status}
                      </span>
                    </div>
                    <p>{job.message}</p>
                    <progress max="100" value={job.progress} />
                    {job.status === "complete" &&
                      job.library?.status !== "installed" && (
                        <button
                          className="secondary"
                          onClick={() =>
                            void action(job.id, async () => {
                              await window.backstage.install(job.id);
                              setJobs(await window.backstage.queue());
                            })
                          }
                        >
                          Retry library install
                        </button>
                      )}
                    {job.status === "error" && (
                      <small className="muted">
                        Your other songs are safe. Re-add this song to try
                        again.
                      </small>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {page === "controllers" && (
          <Controllers
            device={device}
            onDevice={setDevice}
            profile={profile}
            onProfile={setProfile}
            midi={midi}
            onMidi={setMidi}
          />
        )}
        {page === "settings" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR SPACE, YOUR SETUP</span>
                <h1>Make yourself at home.</h1>
                <p>A few small adjustments for a better set.</p>
              </div>
            </div>
            <section className="panel settings-panel">
              <h3>Playing style</h3>
              <div className="setting-row">
                <div>
                  <strong>How you hit notes</strong>
                  <p>
                    Tap for gamepads and keyboards. Strum for guitar-style
                    controls.
                  </p>
                </div>
                <select
                  value={mode}
                  onChange={(e) => {
                    const value = e.target.value as "tap" | "strum";
                    setMode(value);
                    localStorage.setItem("backstage:mode", value);
                  }}
                >
                  <option value="tap">Tap assist / drums</option>
                  <option value="strum">Fret + strum</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Timing offset</strong>
                  <p>
                    Positive values move the hit window later. Adjust for your
                    screen and audio.
                  </p>
                </div>
                <label className="number-input">
                  <input
                    aria-label="Timing offset"
                    type="number"
                    min="-500"
                    max="500"
                    step="5"
                    value={offset}
                    onChange={(e) => {
                      const v = Math.max(
                        -500,
                        Math.min(500, Number(e.target.value)),
                      );
                      setOffset(v);
                      localStorage.setItem("backstage:offset", String(v));
                    }}
                  />
                  ms
                </label>
              </div>
            </section>
            <section className="panel settings-panel">
              <h3>Song library</h3>
              <p className="path">{settings?.songsRoot || root}</p>
              <div className="inline-actions">
                <button
                  className="secondary"
                  onClick={() =>
                    void action("folder", async () => {
                      const changed = await window.backstage.chooseLibrary();
                      if (changed) {
                        await refresh();
                        setSettings(await window.backstage.settings());
                      }
                    })
                  }
                >
                  Choose folder
                </button>
                <button
                  className="quiet"
                  onClick={() =>
                    void action("show", () => window.backstage.showSongs())
                  }
                >
                  Show in Finder ↗
                </button>
              </div>
            </section>
            <section className="panel settings-panel">
              <div className="section-heading">
                <h3>Song preparation</h3>
                <span className="status-tag">
                  {settings?.serviceAvailable
                    ? "Environment found"
                    : "Setup needed"}
                </span>
              </div>
              <p className="muted">
                Search and conversion use the existing local Python environment
                and FFmpeg. Local songs and practice work independently.
              </p>
              <div className="inline-actions">
                <button
                  className="secondary"
                  onClick={() =>
                    void action("python", async () => {
                      await window.backstage.configurePython();
                      setSettings(await window.backstage.settings());
                    })
                  }
                >
                  Choose Python environment
                </button>
                <button
                  className="quiet"
                  onClick={() =>
                    void action("prepare", () =>
                      window.backstage.openPreparation(),
                    )
                  }
                >
                  Open advanced preparation ↗
                </button>
              </div>
            </section>
            <p className="footnote">
              Development build · Five-fret guitar with HOPOs, taps, sustains
              and Star Power. Tap assist and MIDI drum input are available.
              Vocals and multiplayer are not available yet.
            </p>
          </>
        )}
      </main>
      <ButtonHints
        className="app-hints"
        pad={padHints}
        hints={
          (selected
            ? [
                { button: "up", label: "Up / Down" },
                { button: "green", label: "Select" },
                { button: "red", label: "Back" },
              ]
            : [
                { button: "up", label: "Up / Down" },
                { button: "green", label: "Select" },
                { button: "red", label: "Back" },
                ...(page === "library"
                  ? [
                      {
                        button: "blue",
                        label: "Remove song",
                        key: "Delete",
                        extra: true,
                      },
                    ]
                  : []),
                { button: "yellow", label: "Next section", extra: true },
              ]) as Hint[]
        }
      />
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="song-dialog panel"
            role="dialog"
            aria-modal="true"
            aria-label="Choose your track"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-button"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              ×
            </button>
            {selected.art ? (
              <img className="dialog-cover" src={artUrl(selected)} alt="" />
            ) : (
              <div className="dialog-record">♫</div>
            )}
            <span className="eyebrow">UP NEXT</span>
            <h2>{selected.title}</h2>
            <p>{selected.artist}</p>
            {confirmRemove ? (
              <div className="remove-confirm" role="alert">
                <strong>Remove this song from your library?</strong>
                <p>
                  Its folder moves to the Trash, so you can restore it later.
                </p>
                {error && <p className="dialog-error">{error}</p>}
                <div className="menu-list">
                  <button
                    className="danger"
                    disabled={!!busy}
                    onClick={() => void removeSong()}
                  >
                    {busy === "remove" ? "Removing…" : "Remove song"}
                  </button>
                  <button
                    className="secondary"
                    data-menu-default
                    onClick={() => setConfirmRemove(false)}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <>
                {lineup.length === 0 ? (
                  <>
                    <div
                      className="choice-group"
                      role="group"
                      aria-label="Instrument"
                    >
                      <span>Instrument</span>
                      <div>
                        {[...new Set(selected.charts.map((c) => c.part))].map(
                          (p) => (
                            <button
                              key={p}
                              aria-pressed={p === part}
                              onClick={() => changePart(p)}
                            >
                              {p}
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                    <div
                      className="choice-group"
                      role="group"
                      aria-label="Difficulty"
                    >
                      <span>Difficulty</span>
                      <div>
                        {levels
                          .filter((l) =>
                            selected.charts.some(
                              (c) => c.part === part && c.level === l,
                            ),
                          )
                          .map((l) => (
                            <button
                              key={l}
                              aria-pressed={l === level}
                              className={"level-" + l.toLowerCase()}
                              onClick={() => setLevel(l)}
                            >
                              <i aria-hidden="true">
                                {Array.from(
                                  { length: levels.indexOf(l) + 1 },
                                  (_, k) => (
                                    <b key={k} />
                                  ),
                                )}
                              </i>
                              {l}
                            </button>
                          ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="lineup" role="group" aria-label="Players">
                    {lineupAll().map((p, n) => (
                      <div className="lineup-row" key={n}>
                        <b className={"player-badge p" + (n + 1)}>P{n + 1}</b>
                        <button
                          className="lineup-device"
                          aria-label={`Player ${n + 1} controller`}
                          onClick={() =>
                            applyLineup(cycleDevice(lineupAll(), n, available))
                          }
                        >
                          {deviceLabel(p.device, pads)}
                        </button>
                        <button
                          aria-label={`Player ${n + 1} instrument`}
                          onClick={() =>
                            applyLineup(cyclePart(lineupAll(), n, selected))
                          }
                        >
                          {p.part}
                        </button>
                        <button
                          aria-label={`Player ${n + 1} difficulty`}
                          onClick={() =>
                            applyLineup(cycleLevel(lineupAll(), n, selected))
                          }
                        >
                          {p.level}
                        </button>
                        {n > 0 && (
                          <button
                            className="lineup-remove"
                            aria-label={`Remove player ${n + 1}`}
                            onClick={() =>
                              applyLineup(lineupAll().filter((_, k) => k !== n))
                            }
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {lineup.length + 1 < MAX_PLAYERS && (
                  <button
                    className="add-player"
                    disabled={
                      !freeDevices(lineupAll(), lineup.length + 1, available)
                        .length
                    }
                    onClick={() =>
                      applyLineup(addPlayer(lineupAll(), available, selected))
                    }
                  >
                    ＋ Add player
                    {!freeDevices(lineupAll(), lineup.length + 1, available)
                      .length && <small>Connect another controller</small>}
                  </button>
                )}
                {error && <p className="dialog-error">{error}</p>}
                <div className="song-facts">
                  <span>{duration(selected.duration)}</span>
                  <span>
                    {
                      selected.charts.find(
                        (c) => c.part === part && c.level === level,
                      )?.count
                    }{" "}
                    notes
                  </span>
                  <span>
                    {lineup.length
                      ? `${lineup.length + 1} players`
                      : deviceLabel(device, pads)}
                  </span>
                </div>
                <button
                  className="primary wide"
                  data-menu-default
                  disabled={!!busy}
                  onClick={play}
                >
                  {busy === "play" ? "Getting ready…" : "Take the stage"} →
                </button>
                {!selected.practice && (
                  <div className="dialog-links">
                    <button
                      className="remove-link"
                      disabled={!!busy}
                      onClick={() => void findCover()}
                    >
                      {busy === "cover" ? "Searching…" : "Find cover online"}
                    </button>
                    <button
                      className="remove-link"
                      onClick={() => setConfirmRemove(true)}
                    >
                      Remove from library
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
