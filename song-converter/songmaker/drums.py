"""Transient drum classification using spectrum shape and cymbal decay."""
import numpy as np
from .audio_features import adaptive_flux


def drum_events(percussive, frequencies, sr, hop, duration, original=None):
    import librosa
    bounds = [(35, 140), (140, 350), (350, 1800), (1800, 4500), (4500, 10500)]
    bands = [percussive[(frequencies >= low) & (frequencies < high)] for low, high in bounds]
    energies = [np.mean(band ** 2, axis=0) for band in bands]
    maxima = [max(float(np.max(energy)), 1e-9) for energy in energies]
    floors = [max(value * .005, 1e-9) for value in maxima]
    # HPSS can move a long cymbal tail into the sustained component. Measure
    # decay in the original high band, after subtracting the preceding bed.
    full = percussive if original is None else original
    cymbal_energy = np.mean(full[(frequencies >= 4500) & (frequencies < 10500)] ** 2, axis=0)
    candidates = []
    for band, energy, floor in zip(bands, energies, floors):
        flux = np.mean(np.maximum(0, np.diff(band, axis=1, prepend=0)), axis=0)
        frames = librosa.onset.onset_detect(onset_envelope=adaptive_flux(flux, sr, hop),
                                            sr=sr, hop_length=hop, delta=.1, wait=2)
        rise = np.diff(energy, prepend=0)
        for peak in frames:
            if energy[peak] <= floor:
                continue
            left = max(0, int(peak)-2)
            frame = left + int(np.argmax(rise[left:peak+1]))
            if frame * hop / sr < duration - .1:
                candidates.append(frame)
    grouped = []
    for frame in sorted(set(candidates)):
        if not grouped or (frame-grouped[-1]) * hop / sr >= .045:
            grouped.append(frame)
    events = []
    for frame in grouped:
        end = min(frame + 3, percussive.shape[1])
        power = [float(np.max(e[frame:end])) for e in energies]
        kick, tom, mid, upper, high = power
        mid_spectrum = np.mean(percussive[(frequencies >= 180) & (frequencies < 3500), frame:end] ** 2, axis=1)
        flatness = float(np.exp(np.mean(np.log(mid_spectrum + 1e-12))) / (np.mean(mid_spectrum) + 1e-12))
        hits = {}
        if kick > max(floors[0], mid * 2, tom * .8):
            hits[0] = kick / maxima[0]
        if mid > floors[2] and flatness > .16 and upper > mid * .06:
            hits[1] = mid / maxima[2]
        elif tom > max(floors[1], mid * 1.8, kick * .7) and flatness < .16:
            hits[3] = tom / maxima[1]
        if high > max(floors[4], mid * .4):
            baseline = float(np.mean(cymbal_energy[max(0, frame-5):frame])) if frame else 0
            peak = max(float(np.max(cymbal_energy[frame:end])) - baseline, 1e-9)
            tail = cymbal_energy[frame+3:min(frame+12, len(cymbal_energy))] - baseline
            long_decay = len(tail) > 0 and float(np.mean(tail > peak * .06)) > .75 and float(np.mean(tail)) > peak * .12
            hits[4 if long_decay else 2] = high / maxima[4]
        if hits:
            events.append({'time': frame * hop / sr, 'hits': hits})
    return events
