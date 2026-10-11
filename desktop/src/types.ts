import type { Slot } from "./core/avatars";
export type Part = "Guitar" | "Bass" | "Rhythm" | "Drums";
export type Level = "Easy" | "Medium" | "Hard" | "Expert";
export type Note = {
  time: number;
  duration: number;
  lanes: number[];
  type?: "strum" | "hopo" | "tap";
  open?: boolean;
  tails?: { lane: number; duration: number }[];
  phrase?: number;
  solo?: number;
};
export type Tempo = { time: number; bpm: number };
export type Signature = {
  time: number;
  numerator: number;
  denominator: number;
};
export type Phrase = { start: number; end: number };
export type Chart = {
  part: Part;
  level: Level;
  notes: Note[];
  tempos?: Tempo[];
  signatures?: Signature[];
  phrases?: Phrase[];
  solos?: Phrase[];
};
export type Song = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  preview?: number;
  art?: number;
  details?: { album: string; year: string; genre: string; charter: string };
  intensity?: Partial<Record<Part, number>>;
  charts: { part: Part; level: Level; count: number }[];
  practice?: boolean;
};
export type BestScore = {
  score: number;
  stars: number;
  accuracy: number;
  maxCombo: number;
  date: string;
};
export type LoadedSong = Song & { chart: Chart; audioUrl?: string };
export type SearchResult = {
  id: string;
  title: string;
  artist: string;
  duration: number | null;
  url: string;
  thumbnail?: string;
  tracks?: Record<string, string[]>;
  charter?: string;
};
export type QueueJob = {
  id: string;
  title: string;
  status: string;
  progress: number;
  message: string;
  library?: { status: string; message: string };
};
export type Settings = {
  songsRoot: string;
  python: string;
  serviceAvailable: boolean;
};
export type Action =
  | "lane0"
  | "lane1"
  | "lane2"
  | "lane3"
  | "lane4"
  | "strumUp"
  | "strumDown"
  | "pause"
  | "starPower"
  | "whammy";
export type Binding = {
  type: "button" | "axis";
  index: number;
  direction?: 1 | -1;
};
export type Profile = { bindings: Record<Action, Binding>; deadzone: number };
export type InputState = {
  lanes: boolean[];
  strum: boolean;
  strumUp: boolean;
  strumDown: boolean;
  starPower: boolean;
  whammy: boolean;
  pause: boolean;
  connected: boolean;
};
export interface Bridge {
  library(): Promise<{ songs: Song[]; warnings: string[]; root: string }>;
  loadSong(id: string, part: Part, level: Level): Promise<LoadedSong>;
  search(
    query: string,
    provider: "youtube" | "charts",
  ): Promise<{ results: SearchResult[] }>;
  enqueue(url: string, title: string): Promise<{ id: string }>;
  queue(): Promise<QueueJob[]>;
  importAudio(): Promise<{ id: string } | null>;
  install(id: string): Promise<void>;
  chooseLibrary(): Promise<string | null>;
  settings(): Promise<Settings>;
  configurePython(): Promise<boolean>;
  openPreparation(): Promise<void>;
  openChart(url: string): Promise<void>;
  showSongs(): Promise<void>;
  removeSong(id: string): Promise<{ title: string }>;
  tidyLibrary(): Promise<{ renamed: number; covers: number }>;
  findCover(id: string): Promise<boolean>;
  scores(): Promise<Record<string, BestScore>>;
  saveScore(result: {
    id: string;
    part: Part;
    level: Level;
    score: number;
    stars: number;
    accuracy: number;
    maxCombo: number;
  }): Promise<{ best: boolean; previous: BestScore | null }>;
  band(): Promise<Slot[]>;
  saveSlot(slot: number, value: Slot): Promise<Slot[]>;
  cameraAccess(): Promise<boolean>;
}
declare global {
  interface Window {
    backstage: Bridge;
  }
}
