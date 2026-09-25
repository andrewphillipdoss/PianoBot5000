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
const activeVoices = new Map(); // pitch -> { oscillators, master } -- the live (duration-unknown-in-advance) path
const scheduledVoices = new Set(); // { oscillators, master } -- the known-duration path (playNoteForDuration); see there for why these are tracked separately

const HARMONICS = [1, 2, 3]; // fundamental + two overtones
const HARMONIC_GAINS = [1, 0.25, 0.1];

const ATTACK_SECONDS = 0.005;
const DECAY_SECONDS = 0.6; // matches the live envelope's "decays even while held" shape
const SUSTAIN_RATIO = 0.15;
const RELEASE_SECONDS = 0.15;
const MIN_GAIN = 0.0001; // exponentialRampToValueAtTime can't target exactly 0

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

/**
 * Schedule a note with a known start time AND known duration -- chord
 * backing, song playback -- as one continuous, fully analytic gain
 * envelope (attack -> decay -> hold -> release to true silence),
 * computed entirely from `when`/`durationSeconds` up front.
 *
 * Deliberately NOT built out of playNoteAt()+stopNoteAt(): that pair's
 * stopNoteAt reads the gain's *current* value (audioContext.currentTime,
 * effectively "now" at the instant the JS runs) and re-inserts it at a
 * future `when`. That's fine for live playing, where `when` really is
 * "now" -- but for anything scheduled ahead of time (chord backing and
 * song playback are both now scheduled arbitrarily far in advance, see
 * recordingSession.js's _scheduleChordBacking), that stale read
 * silently uses the wrong value and creates a real discontinuity in
 * the curve at that future instant -- an audible click or pop. Nothing
 * here ever reads an AudioParam's `.value`, so there's no stale read
 * to have.
 */
export function playNoteForDuration(pitch, velocity, when, durationSeconds) {
  if (!audioContext) return;

  const baseFreq = midiToFrequency(pitch);
  const peakGain = Math.min(1, velocity / 127) * 0.3;
  const sustainGain = Math.max(peakGain * SUSTAIN_RATIO, MIN_GAIN);

  const attackEnd = when + Math.min(ATTACK_SECONDS, durationSeconds / 2);
  const decayEnd = when + Math.min(DECAY_SECONDS, durationSeconds);
  const releaseStart = when + durationSeconds;
  const releaseEnd = releaseStart + RELEASE_SECONDS;

  const master = audioContext.createGain();
  master.gain.setValueAtTime(0, when);
  master.gain.linearRampToValueAtTime(peakGain, attackEnd);
  master.gain.exponentialRampToValueAtTime(sustainGain, decayEnd);
  // decayEnd's own value is already exactly sustainGain -- only need an
  // explicit hold point when release starts later than that (a note
  // longer than the decay), so there's something for the release ramp
  // below to ramp down *from*.
  if (releaseStart > decayEnd) {
    master.gain.setValueAtTime(sustainGain, releaseStart);
  }
  master.gain.linearRampToValueAtTime(0, releaseEnd); // true silence, not the 0.0001 floor -- no truncation click when the oscillator stops
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
    osc.stop(releaseEnd + 0.02);
    return osc;
  });

  const voice = { oscillators, master };
  scheduledVoices.add(voice);
  // Self-cleanup once it's naturally finished -- stopAllNotes() (below)
  // is the *early*-cutoff path and removes it from this set itself.
  setTimeout(() => scheduledVoices.delete(voice), Math.max(0, (releaseEnd - audioContext.currentTime) * 1000));
}

function stopVoiceImmediately(voice, releaseSeconds) {
  const now = audioContext.currentTime;
  // Reading `.value` here is safe -- unlike the stale-read problem
  // playNoteForDuration exists to avoid, this always runs at real
  // "now", never at a future scheduled time.
  voice.master.gain.cancelScheduledValues(now);
  voice.master.gain.setValueAtTime(voice.master.gain.value, now);
  voice.master.gain.linearRampToValueAtTime(0, now + releaseSeconds);
  for (const osc of voice.oscillators) {
    try {
      osc.stop(now + releaseSeconds + 0.02);
    } catch {
      // Already stopped (its own natural release already finished) -- fine, nothing left to cut off.
    }
  }
}

/** Silence everything currently sounding, e.g. when sound feedback is toggled off, or playback/a take is cut short. */
export function stopAllNotes(releaseSeconds = 0.05) {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  for (const pitch of [...activeVoices.keys()]) {
    stopNoteAt(pitch, now, releaseSeconds);
  }
  for (const voice of scheduledVoices) {
    stopVoiceImmediately(voice, releaseSeconds);
  }
  scheduledVoices.clear();
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
