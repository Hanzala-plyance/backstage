"""Local singing transcription and editable timestamped lyrics."""
from pathlib import Path
import os
import re
from functools import lru_cache


@lru_cache(maxsize=1)
def lyrics_model(model_name):
    from faster_whisper import WhisperModel
    cache = Path(__file__).resolve().parent.parent / '.cache' / 'whisper'
    return WhisperModel(model_name, device='cpu', compute_type='int8', download_root=str(cache),
                        cpu_threads=max(1, min(4, (os.cpu_count() or 4) // 2)))


def transcribe(path: Path, duration: float, model_name: str, language: str, progress):
    progress(50, f"Loading the {model_name} lyrics model (first use downloads it)…")
    model = lyrics_model(model_name)
    # Speech VAD can classify the entire song as non-speech and discard vocals.
    segments, _ = model.transcribe(str(path), word_timestamps=True, beam_size=5,
                                   language=language or None, vad_filter=False,
                                   condition_on_previous_text=False)
    phrases = []
    previous_end = 0.0
    for segment in segments:
        progress(52 + int(23 * min(segment.end / duration, 1)), "Listening for lyrics…")
        if segment.no_speech_prob > .75 or segment.avg_logprob < -1.2:
            continue
        start = max(previous_end, float(segment.start), 0)
        end = min(duration, float(segment.end))
        words = [{"start": max(start, min(end - .01, float(w.start))), "text": w.word.strip()}
                 for w in (segment.words or []) if w.word.strip()]
        if words and end > start:
            phrases.append({"start": start, "end": end, "words": words})
            previous_end = end
    return phrases


def to_lrc(phrases: list[dict]) -> str:
    stamps = {}
    for phrase in phrases:
        # A line per word retains the actual word timestamps when edited/saved.
        for word in phrase["words"]:
            centiseconds = round(word["start"] * 100)
            stamps.setdefault(centiseconds, []).append(word['text'])
    lines = []
    for centiseconds, words in sorted(stamps.items()):
        minutes, rem = divmod(centiseconds, 6000)
        seconds, cs = divmod(rem, 100)
        lines.append(f"[{minutes:02d}:{seconds:02d}.{cs:02d}]{' '.join(words)}")
    return "\n".join(lines) + ("\n" if lines else "")


def parse_lrc(text: str, duration: float) -> list[dict]:
    entries = []
    offset = 0.0
    for raw in text.splitlines():
        line = raw.strip().lstrip("\ufeff")
        if not line:
            continue
        if re.fullmatch(r"\[offset:[+-]?\d+\]", line, re.I):
            offset = int(line[8:-1]) / 1000
            continue
        stamps = list(re.finditer(r"\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]", line))
        if not stamps:
            if re.fullmatch(r"\[[a-zA-Z]+:.*\]", line):
                continue
            raise ValueError("Each lyric line needs a timestamp, for example [00:12.50]Your lyrics here.")
        content = line[stamps[-1].end():].strip()
        for stamp in stamps:
            if int(stamp[2]) >= 60:
                raise ValueError("Lyric timestamp seconds must be below 60.")
            start = int(stamp[1]) * 60 + int(stamp[2]) + float("0." + (stamp[3] or "0"))
            entries.append((start, content))
    entries = sorted((max(0, time + offset), content) for time, content in entries)
    if any(time >= duration for time, _ in entries):
        raise ValueError("A lyric timestamp is beyond the end of the song.")
    if len({time for time, _ in entries}) != len(entries):
        raise ValueError("Use only one lyric line per timestamp.")
    phrases = []
    for i, (start, content) in enumerate(entries):
        if not content:
            continue
        end = min(duration, start + 6, entries[i + 1][0] if i + 1 < len(entries) else duration)
        # Preserve LRC line timing; don't invent word-level alignment for pasted lines.
        phrases.append({"start": start, "end": end, "words": [{"start": start, "text": content}]})
    return phrases
