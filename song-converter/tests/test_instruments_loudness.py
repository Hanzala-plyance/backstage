"""Known instrument events and real encoded audio verify the musical changes."""
from pathlib import Path
import tempfile
import unittest
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt
from songmaker.chart import analyze
from songmaker.loudness import normalize_audio, measure_loudness, TARGET_LUFS


class InstrumentTests(unittest.TestCase):
    def analyze_audio(self, audio, sr=22050):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'fixture.wav'
            sf.write(path, audio, sr, subtype='FLOAT')
            return analyze(path)

    def test_bass_follows_low_notes_despite_interleaved_kicks(self):
        sr = 22050
        audio = np.zeros(sr * 7)
        starts = [.5, 2.5, 4.5]
        for start, freq in zip(starts, [55, 82.4, 110]):
            t = np.arange(sr) / sr
            tone = (.35*np.sin(2*np.pi*freq*t) + .15*np.sin(4*np.pi*freq*t))
            tone *= np.minimum(t/.025, 1) * np.minimum((1-t)/.1, 1)
            at = round(start*sr)
            audio[at:at+len(t)] += tone
        for start in [1.25, 3.25, 5.25]:
            t = np.arange(round(.09*sr)) / sr
            kick = .65*np.sin(2*np.pi*65*t)*np.exp(-t*45)
            at = round(start*sr)
            audio[at:at+len(t)] += kick
        tracks = self.analyze_audio(audio)['instruments']['Bass']
        for start in starts:
            self.assertLess(min(abs(n['time']-start) for n in tracks['Expert']), .09)
        self.assertLessEqual(len(tracks['Expert']), 6)
        self.assertEqual([len(tracks[d]) for d in ('Easy','Medium','Hard','Expert')],
                         sorted(len(tracks[d]) for d in ('Easy','Medium','Hard','Expert')))

    def test_rhythm_chords_and_single_voice_are_distinguished(self):
        sr = 22050
        chord_audio, single_audio = np.zeros(sr*6), np.zeros(sr*6)
        for start in [.5, 3]:
            t = np.arange(round(1.5*sr))/sr
            env = np.minimum(t/.02, 1)*np.minimum((1.5-t)/.08, 1)
            chord = sum(.14*np.sin(2*np.pi*f*t) for f in [220, 277.18, 329.63])*env
            single = sum(a*np.sin(2*np.pi*220*k*t) for k,a in [(1,.2),(2,.3),(3,.1)])*env
            at=round(start*sr)
            chord_audio[at:at+len(t)] += chord
            single_audio[at:at+len(t)] += single
        chord = self.analyze_audio(chord_audio)['instruments']['Rhythm']
        single = self.analyze_audio(single_audio)['instruments']['Rhythm']
        self.assertTrue(any(len(n['lanes']) >= 2 for n in chord['Expert']))
        self.assertTrue(all(len(n['lanes']) == 1 for n in chord['Easy']))
        self.assertTrue(all(len(n['lanes']) == 1 for n in single['Expert']))
        for start in [.5,3]:
            self.assertLess(min(abs(n['time']-start) for n in chord['Expert']), .09)

    def test_drums_distinguish_kick_snare_tom_and_cymbal_decay(self):
        sr=22050
        audio=np.zeros(sr*9)
        rng=np.random.default_rng(101)
        expected=[(.5,{0}),(1.7,{1}),(2.9,{2}),(4.1,{3}),(5.3,{4}),(7,{0,2})]
        for start, lanes in expected:
            t=np.arange(round(.8*sr))/sr
            sound=np.zeros_like(t)
            for lane in lanes:
                if lane in (0,3):
                    freq, decay = (65,35) if lane==0 else (210,13)
                    sound += .7*np.sin(2*np.pi*freq*t)*np.exp(-t*decay)
                else:
                    low, high = (300,3500) if lane==1 else (6000,9500)
                    filtered=sosfilt(butter(4,[low,high],btype='bandpass',fs=sr,output='sos'),rng.normal(size=len(t)))
                    decay=22 if lane==1 else (45 if lane==2 else 3)
                    sound += .45*filtered*np.exp(-t*decay)
            at=round(start*sr)
            audio[at:at+len(t)] += sound
        drums=self.analyze_audio(audio)['instruments']['Drums']
        for start, lanes in expected:
            nearby=[n for n in drums['Expert'] if abs(n['time']-start)<.09]
            self.assertTrue(nearby, (start, drums['Expert']))
            actual=set().union(*(set(n['lanes']) for n in nearby))
            self.assertTrue(lanes <= actual, (start,lanes,actual))
        for notes in drums.values():
            self.assertTrue(all(len(set(n['lanes'])-{0})<=2 and n['duration']==0 for n in notes))


class LoudnessTests(unittest.TestCase):
    def test_quiet_and_loud_inputs_match_after_ogg_encoding(self):
        sr=48000
        t=np.arange(sr*8)/sr
        envelope=np.where((t>=1)&(t<7),1.,0.) * np.where(t<4,1.,.65)
        base=(np.sin(2*np.pi*220*t)+.4*np.sin(2*np.pi*440*t))*.3*envelope
        with tempfile.TemporaryDirectory() as tmp:
            measured=[]
            for name, gain in [('quiet',.1),('loud',1)]:
                source, output=Path(tmp)/f'{name}.wav',Path(tmp)/f'{name}.ogg'
                sf.write(source,np.stack([base*gain,base*gain],axis=1),sr,subtype='FLOAT')
                report=normalize_audio(source,output)
                levels=measure_loudness(output)
                measured.append(float(levels['input_i']))
                self.assertAlmostEqual(measured[-1],TARGET_LUFS,delta=.5)
                self.assertLess(float(levels['input_tp']),-1)
                data,rate=sf.read(output)
                self.assertEqual(rate,48000)
                self.assertEqual(data.shape[1],2)
                self.assertAlmostEqual(len(data)/rate,8,delta=.015)
                self.assertLess(np.max(np.abs(data[:round(.9*rate)])),1e-4)
                ratio=np.sqrt(np.mean(data[5*rate:6*rate]**2)/np.mean(data[2*rate:3*rate]**2))
                self.assertAlmostEqual(ratio,.65,delta=.025)
                self.assertEqual(report['method'],'Two-pass EBU R128')
            self.assertLess(abs(measured[0]-measured[1]),.3)

    def test_silence_is_not_amplified(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'silence.wav'
            sf.write(source,np.zeros(48000*3),48000)
            with self.assertRaisesRegex(ValueError,'silent'):
                normalize_audio(source,Path(tmp)/'song.ogg')

    def test_peak_protection_on_high_crest_factor_audio(self):
        sr=48000
        t=np.arange(sr*8)/sr
        audio=.018*np.sin(2*np.pi*330*t)
        for second in [1,3,5,7]:
            start=round(second*sr)
            pulse=np.arange(round(.012*sr))/sr
            audio[start:start+len(pulse)] += .9*np.sin(2*np.pi*900*pulse)*np.exp(-pulse*180)
        with tempfile.TemporaryDirectory() as tmp:
            source, output=Path(tmp)/'peaks.wav',Path(tmp)/'peaks.ogg'
            sf.write(source,audio,sr,subtype='FLOAT')
            report=normalize_audio(source,output)
            measured=measure_loudness(output)
            self.assertLess(float(measured['input_tp']),-.5)
            self.assertLessEqual(report['output_peak_before_encoding_dbtp'],-1.9)
            self.assertAlmostEqual(float(measured['input_i']),TARGET_LUFS,delta=1)


if __name__=='__main__':
    unittest.main()
