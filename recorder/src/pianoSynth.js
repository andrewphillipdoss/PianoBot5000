/**
 * A tiny synthesized piano-ish voice for live feedback while playing
 * -- NOT sampled audio, just a few triangle-wave harmonics through a
 * percussive envelope (fast attack, decays even while held, quick
 * release on note-off, roughly how a real piano string behaves). This
 * is the cheap version: zero dependencies, nothing to download. If it
 * ever doesn't sound convincing enough, swap it for real sampled
 * piano audio -- a genuinely different (bigger) addition, not a
 * tweak to this file.
 *
 * The AudioContext is created lazily via `enableAudio()`, which MUST
 * be called from a real user gesture (a click) -- browsers block
 * audio from starting otherwise, and an external MIDI keyboard event
 * doesn't count as one.
 */

let audioContext = null;
const activeVoices = new Map(); // pitch -> { oscillators, master }

const HARMONICS = [1, 2, 3]; // fundamental + two overtones
const HARMONIC_GAINS = [1, 0.25, 0.1];

export function isAudioEnabled() {
  return audioContext !== null && audioContext.state === 'running';
}

export function enableAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext.resume();
}

/** MIDI pitch number -> frequency in Hz (69 = A4 = 440Hz, the standard tuning reference). */
export function midiToFrequency(pitch) {
  return 440 * 2 ** ((pitch - 69) / 12);
}

export function playNote(pitch, velocity = 90) {
  if (!audioContext) return;
  stopNote(pitch, 0.02); // clean up a re-trigger before the previous voice finished decaying

  const now = audioContext.currentTime;
  const baseFreq = midiToFrequency(pitch);
  const peakGain = Math.min(1, velocity / 127) * 0.3;

  const master = audioContext.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(peakGain, now + 0.005);
  master.gain.exponentialRampToValueAtTime(Math.max(peakGain * 0.15, 0.0001), now + 0.6);
  master.connect(audioContext.destination);

  const oscillators = HARMONICS.map((multiple, i) => {
    const osc = audioContext.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * multiple, now);
    const harmonicGain = audioContext.createGain();
    harmonicGain.gain.value = HARMONIC_GAINS[i];
    osc.connect(harmonicGain);
    harmonicGain.connect(master);
    osc.start(now);
    return osc;
  });

  activeVoices.set(pitch, { oscillators, master });
}

export function stopNote(pitch, releaseSeconds = 0.15) {
  const voice = activeVoices.get(pitch);
  if (!voice || !audioContext) return;
  const now = audioContext.currentTime;
  voice.master.gain.cancelScheduledValues(now);
  voice.master.gain.setValueAtTime(voice.master.gain.value, now);
  voice.master.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds);
  voice.oscillators.forEach((osc) => osc.stop(now + releaseSeconds + 0.02));
  activeVoices.delete(pitch);
}
