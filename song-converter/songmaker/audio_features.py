"""Bounded harmonic/percussive analysis shared by the four arrangements."""
import numpy as np
from scipy.ndimage import median_filter, maximum_filter1d
from scipy.signal import find_peaks


def separate_spectrum(spectrum):
    import librosa
    harmonic, percussive = np.empty_like(spectrum), np.empty_like(spectrum)
    # Overlap median-filter windows; avoid allocating song-sized filter temporaries.
    for start in range(0, spectrum.shape[1], 4096):
        end = min(start + 4096, spectrum.shape[1])
        left, right = max(0, start - 16), min(spectrum.shape[1], end + 16)
        h, p = librosa.decompose.hpss(spectrum[:, left:right], kernel_size=(17, 31), margin=(1.5, 2.0))
        harmonic[:, start:end] = h[:, start-left:end-left]
        percussive[:, start:end] = p[:, start-left:end-left]
    return harmonic, percussive


def guitar_features(harmonic, frequencies):
    return tonal_features(harmonic, frequencies, 140, 4000, 82, 1400)


def tonal_features(harmonic, frequencies, low, high, pitch_low, pitch_high):
    band = harmonic[(frequencies >= low) & (frequencies <= high)]
    energy = np.sqrt(np.mean(band ** 2, axis=0))
    flux = np.mean(np.maximum(0, np.diff(band, axis=1, prepend=0)), axis=0)
    bins = np.flatnonzero((frequencies >= pitch_low) & (frequencies <= pitch_high))
    # Reward a fundamental with matching overtones, instead of jumping to each
    # loud overtone or following the bass/kick's largest full-mix FFT bin.
    score = harmonic[bins].copy()
    for multiple, weight in ((2, .5), (3, .33), (4, .25)):
        score += weight * harmonic[np.minimum(bins * multiple, len(frequencies) - 1)]
    score *= np.sqrt(harmonic[bins] / np.maximum(np.max(harmonic[bins], axis=0), 1e-8))
    selected = bins[np.argmax(score, axis=0)]
    columns = np.arange(harmonic.shape[1])
    left, middle, right = harmonic[selected-1, columns], harmonic[selected, columns], harmonic[selected+1, columns]
    denominator = left - 2 * middle + right
    correction = np.divide(.5 * (left-right), denominator, out=np.zeros_like(middle), where=np.abs(denominator) > 1e-8)
    pitches = (selected + np.clip(correction, -.5, .5)) * (frequencies[1] - frequencies[0])
    return flux, median_filter(pitches, size=3), energy


def adaptive_flux(flux, sr, hop):
    local = maximum_filter1d(flux, size=max(3, round(6 * sr / hop)))
    return flux / np.maximum(local, max(float(np.max(flux)) * .12, 1e-8))


def tonal_onsets(flux, pitches, energy, floor, sr, hop):
    import librosa
    envelope = adaptive_flux(flux, sr, hop)
    frames = list(librosa.onset.onset_detect(onset_envelope=envelope, sr=sr, hop_length=hop, delta=.065, wait=2))
    occupied = set(frames)
    # Legato note changes need not have a strong amplitude attack.
    midi = 12 * np.log2(np.maximum(pitches, 1))
    changes = np.flatnonzero(np.abs(np.diff(midi)) >= 1.5) + 1
    for frame in changes:
        before = midi[max(0, frame-3):frame]
        after = midi[frame:min(len(midi), frame+3)]
        if (len(before) == 3 and len(after) == 3 and np.ptp(before) < .6 and np.ptp(after) < .6
                and energy[frame] > floor * 2 and not any(frame+offset in occupied for offset in range(-3, 4))):
            frames.append(int(frame))
            occupied.add(int(frame))
    rise = np.diff(energy, prepend=0)
    events = []
    for peak in sorted(set(frames)):
        if energy[peak] < floor:
            continue
        left = max(0, peak - 2)
        frame = left + int(np.argmax(rise[left:peak+1]))
        pitch = float(pitches[min(peak+2, len(pitches)-1)])
        before = energy[max(0, peak-8):max(1, peak-3)]
        prior = float(np.median(before)) if len(before) else 0
        after = float(np.max(energy[peak:min(peak+5, len(energy))]))
        prior_pitch = float(np.median(pitches[max(0, peak-8):max(1, peak-3)]))
        changed = abs(12 * np.log2(max(pitch, 1) / max(prior_pitch, 1)))
        if prior > floor * 2 and after < prior * 1.18 and changed < .7:
            continue
        events.append({'frame': int(frame), 'pitch': pitch,
                       'strength': float(envelope[peak]) + min(changed / 12, .3)})
    return events


def chord_size(harmonic, frequencies, frame, low=140, high=1400):
    """Count independent strong pitch peaks, excluding overtones of lower peaks."""
    end = min(frame + 5, harmonic.shape[1])
    spectrum = np.mean(harmonic[:, frame:end], axis=1)
    peaks, _ = find_peaks(spectrum)
    peaks = peaks[(frequencies[peaks] >= low) & (frequencies[peaks] <= high)]
    if not len(peaks):
        return 1
    peaks = peaks[spectrum[peaks] >= float(np.max(spectrum[peaks])) * .25]
    roots = []
    for index in peaks:
        freq = frequencies[index]
        if any(abs(12 * np.log2(freq / (root * max(1, round(freq/root))))) < .8 for root in roots):
            continue
        roots.append(freq)
    return min(3, max(1, len(roots)))


def sustain_end(frame, limit_frame, energy, pitches, pitch, floor, hop, sr, easy=False):
    """Stop at the first real rest/pitch change, tolerating brief analysis dropouts."""
    start = min(frame + 2, len(energy) - 1)  # Let the pick attack settle.
    stop = min(limit_frame, len(energy))
    if stop <= start:
        return frame * hop / sr
    reference = max(float(np.max(energy[start:min(start + 5, stop)])), floor)
    active = energy[start:stop] > max(floor, reference * (.09 if easy else .14))
    # Vibrato is allowed; a new semitone/phrase ends a hold even on Easy.
    stable = np.abs(12 * np.log2(np.maximum(pitches[start:stop], 1) / max(pitch, 1))) < (1.5 if easy else 1.2)
    bad = ~(active & stable)
    grace = max(1, round((.07 if easy else .045) * sr / hop))
    run = 0
    for i, value in enumerate(bad):
        run = run + 1 if value else 0
        if run >= grace:
            stop = start + i - run + 1
            break
    return stop * hop / sr
