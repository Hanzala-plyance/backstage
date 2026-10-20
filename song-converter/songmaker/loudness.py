"""Two-pass, file-level loudness matching for playable exports."""
import json
import math
from pathlib import Path
import re
import shutil
import subprocess

TARGET_LUFS = -16.0
TRUE_PEAK_DBTP = -2.0


def _run(args):
    executable = shutil.which('ffmpeg')
    if not executable:
        raise ValueError('FFmpeg is required to normalize audio.')
    result = subprocess.run([executable, '-hide_banner', '-nostdin', '-y', *args],
                            capture_output=True, text=True, timeout=1800)
    if result.returncode:
        raise ValueError('Audio normalization failed: ' + result.stderr[-600:])
    matches = re.findall(r'\{\s*"input_i"[^{}]+\}', result.stderr)
    if not matches:
        raise ValueError('FFmpeg did not return audio loudness measurements.')
    return json.loads(matches[-1])


def measure_loudness(source: Path):
    return _run(['-i', str(source), '-t', '1201', '-vn', '-map', '0:a:0',
                 '-af', f'loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK_DBTP}:LRA=11:dual_mono=true:print_format=json',
                 '-f', 'null', '-'])


def normalize_audio(source: Path, destination: Path, progress=lambda *_: None):
    progress(10, 'Measuring song loudness…')
    measured = measure_loudness(source)
    values = {key: float(measured[key]) for key in ('input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset')}
    if not all(math.isfinite(value) for value in values.values()):
        raise ValueError('The audio is silent or too quiet to measure. Choose a song with audible music.')
    # Preserve the original dynamics when gain alone can reach the target.
    lra = min(50, max(11, values['input_lra']))
    options = (f'loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK_DBTP}:LRA={lra}:'
               f'measured_I={values["input_i"]}:measured_TP={values["input_tp"]}:'
               f'measured_LRA={values["input_lra"]}:measured_thresh={values["input_thresh"]}:'
               f'offset={values["target_offset"]}:linear=true:dual_mono=true:print_format=json')
    progress(14, 'Matching playback volume across songs…')
    output = _run(['-i', str(source), '-t', '1201', '-vn', '-map', '0:a:0', '-af', options,
                   '-ar', '48000', '-c:a', 'libvorbis', '-q:a', '6', str(destination)])
    return {'enabled': True, 'method': 'Two-pass EBU R128', 'target_lufs': TARGET_LUFS,
            'true_peak_limit_dbtp': TRUE_PEAK_DBTP, 'input_lufs': values['input_i'],
            'output_lufs_before_encoding': float(output['output_i']),
            'output_peak_before_encoding_dbtp': float(output['output_tp']),
            'mode': output['normalization_type'], 'sample_rate': 48000}
