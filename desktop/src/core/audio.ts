// Short original practice backing. No network, samples, or copyrighted recording.
export function practiceWav(): Blob {
  const rate = 22050,
    seconds = 32,
    count = rate * seconds,
    bytes = new ArrayBuffer(44 + count * 2),
    view = new DataView(bytes);
  const word = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  word(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  word(8, "WAVE");
  word(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, "data");
  view.setUint32(40, count * 2, true);
  const bass = [110, 110, 130.81, 98];
  let random = 42;
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      beat = t % 0.5,
      freq = bass[Math.floor(t / 4) % 4];
    random = (random * 1664525 + 1013904223) >>> 0;
    const noise = (random / 4294967296) * 2 - 1;
    const kick =
      Math.sin(2 * Math.PI * (48 * beat + 9 * (1 - Math.exp(-beat * 28)))) *
      Math.exp(-beat * 22) *
      0.36;
    const hat = noise * Math.exp(-(t % 0.25) * 100) * 0.06;
    const tone = Math.sin(2 * Math.PI * freq * t) * Math.exp(-beat * 9) * 0.12;
    const fade = Math.min(1, t * 3, (seconds - t) * 2);
    view.setInt16(
      44 + i * 2,
      Math.max(-1, Math.min(1, (kick + hat + tone) * fade)) * 32767,
      true,
    );
  }
  return new Blob([bytes], { type: "audio/wav" });
}
export class SongAudio {
  readonly element = new Audio();
  readonly context = new AudioContext({ latencyHint: "interactive" });
  private source: MediaElementAudioSourceNode;
  private gain: GainNode;
  private blob?: string;
  constructor(url?: string) {
    this.element.preload = "auto";
    this.element.src = url || (this.blob = URL.createObjectURL(practiceWav()));
    this.source = this.context.createMediaElementSource(this.element);
    this.gain = this.context.createGain();
    this.gain.gain.value = 0.65;
    this.source.connect(this.gain);
    this.gain.connect(this.context.destination);
  }
  get time() {
    return this.element.currentTime;
  }
  get duration() {
    return this.element.duration;
  }
  async play() {
    await this.context.resume();
    await this.element.play();
  }
  pause() {
    this.element.pause();
  }
  volume(value: number) {
    this.gain.gain.value = value;
  }
  dispose() {
    this.pause();
    this.element.removeAttribute("src");
    this.element.load();
    this.source.disconnect();
    this.gain.disconnect();
    void this.context.close();
    if (this.blob) URL.revokeObjectURL(this.blob);
  }
}
