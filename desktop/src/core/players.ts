import type { Level, Part, Song } from "../types";
export const MAX_PLAYERS = 4;
/** A lobby slot: who plays what, on which input. Devices are "keyboard",
 * "midi" or "pad:<index>:<id>", matching the Controllers selection. */
export type PlayerSetup = { device: string; part: Part; level: Level };
export const isPad = (device: string) => device.startsWith("pad:");
export function deviceLabel(device: string, pads: readonly Gamepad[] = []) {
  if (device === "keyboard") return "Keyboard";
  if (device === "midi") return "MIDI drums";
  const pad = pads.find((p) => `pad:${p.index}:${p.id}` === device);
  const name = (pad?.id ?? device.split(":").slice(2).join(":")).replace(
    /\s*\(.*$/,
    "",
  );
  return name || "Controller";
}
/** Devices a slot may switch to: its own plus any no other player holds. */
export function freeDevices(
  players: readonly PlayerSetup[],
  index: number,
  available: readonly string[],
) {
  const taken = new Set(
    players.filter((_, i) => i !== index).map((p) => p.device),
  );
  return available.filter((d) => !taken.has(d));
}
export function cycleDevice(
  players: readonly PlayerSetup[],
  index: number,
  available: readonly string[],
): PlayerSetup[] {
  const options = freeDevices(players, index, available);
  if (!options.length) return [...players];
  const at = options.indexOf(players[index].device);
  const device = options[(at + 1) % options.length];
  return players.map((p, i) => (i === index ? { ...p, device } : p));
}
function defaultChart(song: Song, prefer?: Part) {
  return (
    song.charts.find((c) => c.part === prefer && c.level === "Easy") ??
    song.charts.find((c) => c.part === prefer) ??
    song.charts.find((c) => c.part === "Guitar" && c.level === "Easy") ??
    song.charts[0]
  );
}
/** Adds a player on the first free device, or returns the list unchanged. */
export function addPlayer(
  players: readonly PlayerSetup[],
  available: readonly string[],
  song: Song,
): PlayerSetup[] {
  if (players.length >= MAX_PLAYERS) return [...players];
  const device = freeDevices(players, players.length, available)[0];
  if (!device) return [...players];
  const chart = defaultChart(song, device === "midi" ? "Drums" : undefined);
  return [...players, { device, part: chart.part, level: chart.level }];
}
/** Keeps each player on a chart the song actually has. */
export function fitToSong(
  players: readonly PlayerSetup[],
  song: Song,
): PlayerSetup[] {
  return players.map((p) => {
    if (song.charts.some((c) => c.part === p.part && c.level === p.level))
      return p;
    const chart = defaultChart(song, p.part);
    return { ...p, part: chart.part, level: chart.level };
  });
}
export function cyclePart(
  players: readonly PlayerSetup[],
  index: number,
  song: Song,
): PlayerSetup[] {
  const parts = [...new Set(song.charts.map((c) => c.part))];
  const part = parts[(parts.indexOf(players[index].part) + 1) % parts.length];
  return fitToSong(
    players.map((p, i) => (i === index ? { ...p, part } : p)),
    song,
  );
}
export function cycleLevel(
  players: readonly PlayerSetup[],
  index: number,
  song: Song,
): PlayerSetup[] {
  const order: Level[] = ["Easy", "Medium", "Hard", "Expert"];
  const levels = order.filter((l) =>
    song.charts.some((c) => c.part === players[index].part && c.level === l),
  );
  const level =
    levels[(levels.indexOf(players[index].level) + 1) % levels.length];
  return players.map((p, i) => (i === index ? { ...p, level } : p));
}
/** Why a lineup cannot start, or null when every player has a usable device. */
export function lineupProblem(
  players: readonly PlayerSetup[],
  available: readonly string[],
): string | null {
  const seen = new Set<string>();
  for (const [i, p] of players.entries()) {
    if (seen.has(p.device))
      return `Player ${i + 1} shares a controller with another player.`;
    seen.add(p.device);
    if (!available.includes(p.device))
      return `Player ${i + 1}’s controller is not connected.`;
  }
  return null;
}
const PARTS: Part[] = ["Guitar", "Bass", "Rhythm", "Drums"];
const LEVELS: Level[] = ["Easy", "Medium", "Hard", "Expert"];
/** A controller pressing Start joins as the next player. */
export function joinPlayer(
  players: readonly PlayerSetup[],
  device: string,
): PlayerSetup[] {
  if (players.length >= MAX_PLAYERS || players.some((p) => p.device === device))
    return [...players];
  return [
    ...players,
    { device, part: device === "midi" ? "Drums" : "Guitar", level: "Easy" },
  ];
}
/** Before a song is chosen, any instrument or difficulty can be picked; the
 * song dialog later fits each player to the charts the song has. */
export function cycleSetting(
  players: readonly PlayerSetup[],
  index: number,
  setting: "part" | "level",
  step: 1 | -1 = 1,
): PlayerSetup[] {
  const list: string[] = setting === "part" ? PARTS : LEVELS;
  return players.map((p, i) => {
    if (i !== index) return p;
    const at = list.indexOf(p[setting]);
    return {
      ...p,
      [setting]: list[(at + step + list.length) % list.length],
    } as PlayerSetup;
  });
}
/** Removes a joined player; Player 1 always stays. */
export const leavePlayer = (players: readonly PlayerSetup[], index: number) =>
  index > 0 ? players.filter((_, i) => i !== index) : [...players];
