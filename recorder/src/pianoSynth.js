/**
 * A tiny synthesized Rhodes-ish electric piano voice for live feedback
 * while playing -- NOT sampled audio, a handful of sine partials
 * layered under one shared percussive amplitude envelope (fast attack,
 * decays even while held, quick release on note-off). This is the
 * cheap version: zero dependencies, nothing to download. If it ever
 * doesn't sound convincing enough, swap it for real sampled piano
 * audio -- a genuinely different (bigger) addition, not a tweak to
 * this file.
 *
 * The Rhodes character (see `connectRhodesPartials`) comes from
 * layering a fast, velocity-scaled, independently-decaying "tine"
 * partial on top of an otherwise plain sine fundamental -- real
 * tine-and-pickup electric pianos are never perfectly harmonic, and
 * that partial decaying out of the sustained tone within its own fixed
 * ~0.1s (never longer, however long the note is held) is what reads as
 * "electric bark" rather than "pure bell." A quiet, slow sine tremolo
 * is layered on top of that, the same way the real instrument's own
 * vibrato/tremolo circuit sits after the tone itself.
 *
 * The bassline gets its own voice, a fingered electric bass
 * (`playBassForDuration`) -- see there.
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
let output = null; // everything connects here, not straight to the speakers -- see enableAudio()
const activeVoices = new Map(); // pitch -> { oscillators, master } -- the live (duration-unknown-in-advance) path
const scheduledVoices = new Set(); // { oscillators, master } -- the known-duration path (playNoteForDuration); see there for why these are tracked separately

const OCTAVE_RATIO = 2;
const OCTAVE_GAIN = 0.07; // a little body/warmth under the fundamental, not a full-strength harmonic
const TINE_RATIO = 3.005; // a hair sharp of a pure 3rd harmonic -- that slight inharmonicity, not a clean overtone, is the "electric" part of the bark
const TINE_PEAK_RATIO = 0.9; // relative to this note's own peak gain, so a harder strike brings in more bark, same as a real tine responds to velocity
const TINE_DECAY_SECONDS = 0.12; // always this fast, regardless of note length -- a held note settles into the plain fundamental, it doesn't keep barking
const TREMOLO_HZ = 5;
const TREMOLO_DEPTH_RATIO = 0.06; // +-6% of peak gain -- the classic Rhodes vibrato/tremolo switch, subtle rather than syrupy

const ATTACK_SECONDS = 0.005;
const DECAY_SECONDS = 0.6; // matches the live envelope's "decays even while held" shape
const SUSTAIN_RATIO = 0.15;
const RELEASE_SECONDS = 0.15;
const MIN_GAIN = 0.0001; // exponentialRampToValueAtTime can't target exactly 0

/**
 * The sine partials for one note, connected into `master` (which owns
 * the shared attack/decay/sustain/release envelope -- this only shapes
 * the *mix* between partials over time, layered under that envelope):
 * the fundamental at a constant relative level, a quiet octave partial
 * for warmth, and the fast-decaying "tine" partial described above.
 * Also wires up a slow, quiet tremolo LFO straight into `master.gain`
 * itself (an audio-rate signal summed on top of whatever automation
 * curve is already scheduled there -- the standard Web Audio tremolo
 * technique, and why this needs no automation calls of its own to stay
 * click-free).
 *
 * Returns just the oscillators, already `.start()`ed at `when` -- the
 * caller decides when each one stops (immediately for a live note's
 * eventual note-off, or a known release time for a fully-scheduled
 * one), same as it always has for every partial.
 */
function connectRhodesPartials(baseFreq, when, master, peakGain) {
  const fundamental = audioContext.createOscillator();
  fundamental.type = 'sine';
  fundamental.frequency.setValueAtTime(baseFreq, when);
  const fundamentalGain = audioContext.createGain();
  fundamentalGain.gain.value = 1;
  fundamental.connect(fundamentalGain);
  fundamentalGain.connect(master);

  const octave = audioContext.createOscillator();
  octave.type = 'sine';
  octave.frequency.setValueAtTime(baseFreq * OCTAVE_RATIO, when);
  const octaveGain = audioContext.createGain();
  octaveGain.gain.value = OCTAVE_GAIN;
  octave.connect(octaveGain);
  octaveGain.connect(master);

  const tine = audioContext.createOscillator();
  tine.type = 'sine';
  tine.frequency.setValueAtTime(baseFreq * TINE_RATIO, when);
  const tineGain = audioContext.createGain();
  tineGain.gain.setValueAtTime(Math.max(peakGain * TINE_PEAK_RATIO, MIN_GAIN), when);
  tineGain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + TINE_DECAY_SECONDS);
  tine.connect(tineGain);
  tineGain.connect(master);

  const tremolo = audioContext.createOscillator();
  tremolo.type = 'sine';
  tremolo.frequency.setValueAtTime(TREMOLO_HZ, when);
  const tremoloDepth = audioContext.createGain();
  tremoloDepth.gain.value = peakGain * TREMOLO_DEPTH_RATIO;
  tremolo.connect(tremoloDepth);
  tremoloDepth.connect(master.gain);

  const oscillators = [fundamental, octave, tine, tremolo];
  oscillators.forEach((osc) => osc.start(when));
  return oscillators;
}

// --- The bass guitar voice ------------------------------------------
//
// A plucked string, not a keyboard: bright for an instant as the finger
// lets go, then settling into a round, dark body that keeps fading for
// as long as it's held (a string never sustains flat), and muted
// quickly by the fingertip on release. Two sources: a pure sine at the
// fundamental for the weight you feel, and a sawtooth -- every harmonic
// -- through a lowpass filter for the part you actually *hear*, which
// matters more than it sounds: a low E is 41Hz, below what most laptop
// and phone speakers can reproduce at all, so without those harmonics
// the bass would simply vanish on them. The filter opening and then
// closing over the first quarter second is the pluck; how far it opens
// follows velocity, the way a harder pluck is brighter.
const BASS_PEAK_GAIN = 0.42;
const BASS_SINE_GAIN = 0.8;
const BASS_STRING_GAIN = 0.45;
const BASS_ATTACK_SECONDS = 0.004;
const BASS_PLUCK_SECONDS = 0.25; // the bright pluck settling into the body of the note
const BASS_BODY_RATIO = 0.55; // how much of the peak is left once it has
const BASS_RING_TIME_CONSTANT_SECONDS = 2.2; // how slowly a held string keeps fading after that
const BASS_RELEASE_SECONDS = 0.07; // a fingertip muting the string: quick, but not a cut
const BASS_BODY_HARMONIC = 3.2; // where the filter settles, in multiples of the fundamental...
const BASS_PLUCK_BRIGHTNESS = 7; // ...and how many more it opens by on a full-strength pluck
const BASS_FILTER_Q = 0.9; // a touch of resonance at the cutoff -- the "wood" in the tone, short of a synth squelch
const BASS_CUTOFF_MIN_HZ = 180;
const BASS_CUTOFF_MAX_HZ = 3200;

function bassCutoff(hz) {
  return Math.min(BASS_CUTOFF_MAX_HZ, Math.max(BASS_CUTOFF_MIN_HZ, hz));
}

const CLICK_FREQUENCY = { strong: 1500, weak: 900, off: 700 }; // downbeat, other beats, and the eighth-note in between
const CLICK_GAIN = { strong: 0.25, weak: 0.15, off: 0.06 }; // off-beat is deliberately much quieter -- a subtle subdivision guide, not a fourth accent level
const CLICK_DURATION_SECONDS = 0.04;

export function isAudioEnabled() {
  return audioContext !== null && audioContext.state === 'running';
}

export function enableAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // A gentle safety limiter on the shared output: a full chord, a
    // melody and a bassline all sounding at once can add up past full
    // scale, which the speakers would otherwise hear as harsh digital
    // clipping. Transparent the rest of the time -- it only acts on the
    // loudest peaks.
    output = audioContext.createDynamicsCompressor();
    output.threshold.value = -6;
    output.knee.value = 6;
    output.ratio.value = 12;
    output.attack.value = 0.003;
    output.release.value = 0.25;
    output.connect(audioContext.destination);
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
  master.connect(output);

  const oscillators = connectRhodesPartials(baseFreq, when, master, peakGain);

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
  master.connect(output);

  const oscillators = connectRhodesPartials(baseFreq, when, master, peakGain);
  oscillators.forEach((osc) => osc.stop(releaseEnd + 0.02));

  const voice = { oscillators, master };
  scheduledVoices.add(voice);
  // Self-cleanup once it's naturally finished -- stopAllNotes() (below)
  // is the *early*-cutoff path and removes it from this set itself.
  setTimeout(() => scheduledVoices.delete(voice), Math.max(0, (releaseEnd - audioContext.currentTime) * 1000));
}

/**
 * Schedule one bass guitar note (see the voice's description above)
 * with a known start and duration -- the bassline in song playback and
 * in the backing track under another part's take. Same rules as
 * playNoteForDuration: the whole envelope, and the filter's pluck
 * sweep, are computed up front and never read back, so nothing can
 * click at a future scheduled instant.
 */
export function playBassForDuration(pitch, velocity, when, durationSeconds) {
  if (!audioContext) return;

  const baseFreq = midiToFrequency(pitch);
  const strength = Math.min(1, velocity / 127);
  const peakGain = Math.max(strength * BASS_PEAK_GAIN, MIN_GAIN);
  const bodyGain = Math.max(peakGain * BASS_BODY_RATIO, MIN_GAIN);

  const attackEnd = when + Math.min(BASS_ATTACK_SECONDS, durationSeconds / 2);
  const pluckEnd = when + Math.min(BASS_PLUCK_SECONDS, durationSeconds);
  const releaseStart = when + durationSeconds;
  const releaseEnd = releaseStart + BASS_RELEASE_SECONDS;

  const master = audioContext.createGain();
  master.gain.setValueAtTime(0, when);
  master.gain.linearRampToValueAtTime(peakGain, attackEnd);
  master.gain.exponentialRampToValueAtTime(bodyGain, pluckEnd);
  if (releaseStart > pluckEnd) {
    // The slow fade while held, landing exactly on a value worked out
    // here -- an exponential ramp between two known points *is* that
    // fade, so there's nothing to read back at release time.
    const ringGain = Math.max(bodyGain * Math.exp(-(releaseStart - pluckEnd) / BASS_RING_TIME_CONSTANT_SECONDS), MIN_GAIN);
    master.gain.exponentialRampToValueAtTime(ringGain, releaseStart);
  }
  master.gain.linearRampToValueAtTime(0, releaseEnd);
  master.connect(output);

  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = BASS_FILTER_Q;
  filter.frequency.setValueAtTime(bassCutoff(baseFreq * (BASS_BODY_HARMONIC + strength * BASS_PLUCK_BRIGHTNESS)), when);
  filter.frequency.exponentialRampToValueAtTime(bassCutoff(baseFreq * BASS_BODY_HARMONIC), when + BASS_PLUCK_SECONDS);
  filter.connect(master);

  const sine = audioContext.createOscillator();
  sine.type = 'sine';
  sine.frequency.setValueAtTime(baseFreq, when);
  const sineGain = audioContext.createGain();
  sineGain.gain.value = BASS_SINE_GAIN;
  sine.connect(sineGain);
  sineGain.connect(master);

  const string = audioContext.createOscillator();
  string.type = 'sawtooth';
  string.frequency.setValueAtTime(baseFreq, when);
  const stringGain = audioContext.createGain();
  stringGain.gain.value = BASS_STRING_GAIN;
  string.connect(stringGain);
  stringGain.connect(filter);

  const oscillators = [sine, string];
  oscillators.forEach((osc) => {
    osc.start(when);
    osc.stop(releaseEnd + 0.02);
  });

  const voice = { oscillators, master };
  scheduledVoices.add(voice);
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

/**
 * One metronome tick. `strength` is 'strong' (the downbeat, highest/
 * loudest), 'weak' (the beat's other main pulses), or 'off' (the
 * eighth-note subdivision in between -- much quieter, just enough to
 * hear the subdivision without it competing with the beat itself).
 *
 * Returns the oscillator node (or null if audio isn't enabled yet) --
 * a click scheduled ahead of time (song playback's metronome, unlike
 * recording's incremental one) needs some way to be cancelled early if
 * playback is stopped before that click's `when` arrives; nothing else
 * about a click needs tracking, so this is the one thing worth handing
 * back rather than adding a whole voice-bookkeeping path for it.
 */
export function playClickAt(when, strength = 'weak') {
  if (!audioContext) return null;
  const osc = audioContext.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(CLICK_FREQUENCY[strength], when);

  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(CLICK_GAIN[strength], when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + CLICK_DURATION_SECONDS);

  osc.connect(gain);
  gain.connect(output);
  osc.start(when);
  osc.stop(when + CLICK_DURATION_SECONDS + 0.01);
  return osc;
}
