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
 * Also the one metronome click sound (playClickAt) -- a separate,
 * much shorter percussive blip, not tracked as a "voice" the way
 * piano notes are, since clicks are fire-and-forget.
 *
 * Every "at a given time" function here takes an AudioContext
 * timestamp, not "now" -- that's what lets recordingSession.js
 * schedule a whole count-in or chord-backing track precisely ahead of
 * time (the standard Web Audio lookahead-scheduling pattern) instead
 * of relying on imprecise JS timers.
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

const CLICK_FREQUENCY = { strong: 1500, weak: 900 }; // downbeat vs. the rest
const CLICK_GAIN = { strong: 0.25, weak: 0.15 };
const CLICK_DURATION_SECONDS = 0.04;

export function isAudioEnabled() {
  return audioContext !== null && audioContext.state === 'running';
}

export function enableAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext.resume();
}

/** The shared AudioContext, once enabled -- null before `enableAudio()` has run. Scheduling code reads `.currentTime` off this. */
export function getAudioContext() {
  return audioContext;
}

/** MIDI pitch number -> frequency in Hz (69 = A4 = 440Hz, the standard tuning reference). */
export function midiToFrequency(pitch) {
  return 440 * 2 ** ((pitch - 69) / 12);
}

export function playNoteAt(pitch, velocity, when) {
  if (!audioContext) return;
  stopNoteAt(pitch, when, 0.02); // clean up a re-trigger before the previous voice finished decaying

  const baseFreq = midiToFrequency(pitch);
  const peakGain = Math.min(1, velocity / 127) * 0.3;

  const master = audioContext.createGain();
  master.gain.setValueAtTime(0, when);
  master.gain.linearRampToValueAtTime(peakGain, when + 0.005);
  master.gain.exponentialRampToValueAtTime(Math.max(peakGain * 0.15, 0.0001), when + 0.6);
  master.connect(audioContext.destination);

  const oscillators = HARMONICS.map((multiple, i) => {
    const osc = audioContext.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * multiple, when);
    const harmonicGain = audioContext.createGain();
    harmonicGain.gain.value = HARMONIC_GAINS[i];
    osc.connect(harmonicGain);
    harmonicGain.connect(master);
    osc.start(when);
    return osc;
  });

  activeVoices.set(pitch, { oscillators, master });
}

export function playNote(pitch, velocity = 90) {
  if (!audioContext) return;
  playNoteAt(pitch, velocity, audioContext.currentTime);
}

/** Silence everything currently sounding, e.g. when sound feedback is toggled off. */
export function stopAllNotes(releaseSeconds = 0.05) {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  for (const pitch of [...activeVoices.keys()]) {
    stopNoteAt(pitch, now, releaseSeconds);
  }
}

export function stopNoteAt(pitch, when, releaseSeconds = 0.15) {
  const voice = activeVoices.get(pitch);
  if (!voice || !audioContext) return;
  voice.master.gain.cancelScheduledValues(when);
  voice.master.gain.setValueAtTime(voice.master.gain.value, when);
  voice.master.gain.exponentialRampToValueAtTime(0.0001, when + releaseSeconds);
  voice.oscillators.forEach((osc) => osc.stop(when + releaseSeconds + 0.02));
  activeVoices.delete(pitch);
}

export function stopNote(pitch, releaseSeconds = 0.15) {
  if (!audioContext) return;
  stopNoteAt(pitch, audioContext.currentTime, releaseSeconds);
}

/** One metronome tick -- `strong` (the downbeat) is a higher, slightly louder click than the rest. */
export function playClickAt(when, strong = false) {
  if (!audioContext) return;
  const osc = audioContext.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(strong ? CLICK_FREQUENCY.strong : CLICK_FREQUENCY.weak, when);

  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(strong ? CLICK_GAIN.strong : CLICK_GAIN.weak, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + CLICK_DURATION_SECONDS);

  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(when);
  osc.stop(when + CLICK_DURATION_SECONDS + 0.01);
}
