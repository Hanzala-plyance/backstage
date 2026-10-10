import type { Song } from "../types";
import { practiceWav } from "./audio";
const DWELL = 300,
  LENGTH = 25,
  VOLUME = 0.5;
/** Song-select preview: after a short dwell on a song, fades in a looping clip
 * from its preview start. Separate from gameplay audio. */
export class Preview {
  private el: HTMLAudioElement | null = null;
  private id: string | null = null;
  private timer = 0;
  private fader = 0;
  private practiceUrl?: string;
  hover(song: Song) {
    if (song.id === this.id) return;
    this.stop();
    this.id = song.id;
    this.timer = window.setTimeout(() => this.play(song), DWELL);
  }
  /** Stops only if `song` is the one previewing. */
  leave(song: Song) {
    if (song.id === this.id) this.stop();
  }
  get playing() {
    return this.id;
  }
  private play(song: Song) {
    const el = document.createElement("audio");
    const start = song.preview ?? 0;
    el.preload = "auto";
    el.volume = 0;
    el.src = song.practice
      ? (this.practiceUrl ??= URL.createObjectURL(practiceWav()))
      : `backstage://app/audio/${song.id}`;
    el.addEventListener(
      "loadedmetadata",
      () => {
        el.currentTime = Math.min(start, Math.max(0, el.duration - 1));
      },
      { once: true },
    );
    // Loop the clip rather than playing the whole song.
    el.addEventListener("timeupdate", () => {
      if (el.currentTime > start + LENGTH) el.currentTime = start;
    });
    el.addEventListener("ended", () => {
      el.currentTime = start;
      void el.play().catch(() => {});
    });
    this.el = el;
    void el.play().catch(() => {});
    this.fade(el, VOLUME);
  }
  private fade(el: HTMLAudioElement, to: number, done?: () => void) {
    clearInterval(this.fader);
    const step = (to - el.volume) / 10;
    let left = 10;
    this.fader = window.setInterval(() => {
      el.volume = Math.max(0, Math.min(1, el.volume + step));
      if (--left <= 0) {
        clearInterval(this.fader);
        el.volume = to;
        done?.();
      }
    }, 30);
  }
  stop() {
    clearTimeout(this.timer);
    this.id = null;
    const el = this.el;
    this.el = null;
    if (!el) return;
    this.fade(el, 0, () => {
      el.pause();
      el.removeAttribute("src");
      el.load();
    });
  }
}
