/**
 * The real-time recording state machine: count-in -> capture -> a
 * result (chords or melody, via recordingPipeline.js). Deliberately a
 * plain class, not a React hook itself -- audio timing (the
 * metronome, chord playback during the melody pass) needs to be
 * driven by the Web Audio clock directly, and React's render cycle
 * isn't reliably timely enough for that. useRecordingSession.js wraps
 * an instance of this for the UI to read.
 *
 * Two clocks, deliberately kept straight: Web Audio scheduling runs
 * on `AudioContext.currentTime` (real seconds since the context was
 * created); Web MIDI event timestamps arrive on `performance.now()`'s
 * clock (real ms since page load) -- two different origins, not
 * directly comparable. This class only ever converts between them
 * once, at the moment a pass starts (`_anchorRealTime`/
 * `_anchorAudioTime`, captured back-to-back) -- everything else
 * either stays in "beats from that anchor" (for audio scheduling) or
 * "ms from when capturing actually began" (for MIDI timestamps),
 * never mixing the two raw clocks directly. Sub-millisecond
 * synchronization between them doesn't matter here -- see the
 * comment on `_beginCapturing` for why.
 */

import { DEFAULT_QUANTIZE_SUBDIVISIONS_PER_BEAT, PICKUP_BEATS, processChordsPass, processMelodyPass } from './recordingPipeline.js';
import { getAudioContext, playClickAt, playNoteForDuration, stopAllNotes } from './pianoSynth.js';
import { voiceChordSimple } from './theory.js';

const COUNT_IN_BEATS = 4; // one bar
const BEATS_PER_BAR = 4;
const SCHEDULE_INTERVAL_MS = 25; // how often the lookahead loop wakes up
const SCHEDULE_AHEAD_SECONDS = 0.15; // how far into the future it schedules audio each time it wakes

export class RecordingSession {
  /**
   * @param {object} options
   * @param {number} options.tempo - BPM
   * @param {'chords'|'melody'} options.mode
   * @param {number} [options.subdivisionsPerBeat] - quantization grid,
   *   chosen per-song at setup (2/4/8 = 8th/16th/32nd notes)
   * @param {(phase: string) => void} [options.onPhaseChange]
   * @param {(result: object) => void} [options.onDone]
   * @param {(error: Error) => void} [options.onError] - fires instead of
   *   onDone when the just-captured take can't be turned into a result
   *   (chords mode: detectChords() rejecting an unrecognizable cluster of
   *   held notes -- see theory.js). Phase drops back to 'idle' so the
   *   player can just hit record again.
   */
  constructor({ tempo, mode, subdivisionsPerBeat = DEFAULT_QUANTIZE_SUBDIVISIONS_PER_BEAT, onPhaseChange, onDone, onError }) {
    this.tempo = tempo;
    this.mode = mode;
    this.subdivisionsPerBeat = subdivisionsPerBeat;
    this.secondsPerBeat = 60 / tempo;
    this.onPhaseChange = onPhaseChange ?? (() => {});
    this.onDone = onDone ?? (() => {});
    this.onError = onError ?? (() => {});
    this.phase = 'idle'; // idle | countIn | capturing | done
    this._resetPassState();
  }

  _resetPassState() {
    this.bufferedMessages = [];
    this.captureStartRealTime = null;
    this.nextScheduledBeat = 0;
    this._scheduleIntervalId = null;
    this._captureStartTimeoutId = null;
    this._captureEndTimeoutId = null;
  }

  _setPhase(phase) {
    this.phase = phase;
    this.onPhaseChange(phase);
  }

  /**
   * Begin a pass: count-in, then capture. For melody mode, pass the
   * section's already-detected `chords` (to play back) and its fixed
   * `sectionLengthBeats` (capture auto-stops there); chords mode needs
   * neither -- its length isn't known until `stop()` is called.
   */
  start({ chords = [], sectionLengthBeats = null } = {}) {
    this.cancel();
    this._resetPassState();
    this.chordsToPlay = chords;
    this.sectionLengthBeats = sectionLengthBeats;

    const audioContext = getAudioContext();
    this._anchorRealTime = performance.now();
    this._anchorAudioTime = audioContext.currentTime + 0.05; // small safety margin so the first click isn't already in the past

    this._setPhase('countIn');
    this._scheduleIntervalId = setInterval(() => this._scheduleAhead(), SCHEDULE_INTERVAL_MS);
    this._captureStartTimeoutId = setTimeout(() => this._beginCapturing(), COUNT_IN_BEATS * this.secondsPerBeat * 1000);
  }

  _audioTimeForBeat(beatIndex) {
    return this._anchorAudioTime + beatIndex * this.secondsPerBeat;
  }

  _scheduleAhead() {
    const audioContext = getAudioContext();
    if (!audioContext) return;
    const horizon = audioContext.currentTime + SCHEDULE_AHEAD_SECONDS;

    while (this._audioTimeForBeat(this.nextScheduledBeat) < horizon) {
      const beatIndex = this.nextScheduledBeat;
      const isCountInBeat = beatIndex < COUNT_IN_BEATS;
      const beatWithinCapture = beatIndex - COUNT_IN_BEATS;

      // Chords mode has no known end -- keep clicking until stop() cancels this loop.
      // Melody mode's length (pickup bar + section) is fixed, so stop once it's covered.
      if (!isCountInBeat && this.mode === 'melody' && beatWithinCapture >= PICKUP_BEATS + this.sectionLengthBeats) break;

      const when = this._audioTimeForBeat(beatIndex);
      const strong = isCountInBeat ? beatIndex === 0 : beatWithinCapture % BEATS_PER_BAR === 0;
      playClickAt(when, strong);

      this.nextScheduledBeat += 1;
    }
  }

  /**
   * Schedule every chord's backing audio in one precise pass, up
   * front, rather than piggybacking on the click loop above. That
   * loop only ever visits *integer* beat positions (one click per
   * beat) -- a chord starting on a fractional beat (e.g. 2.25, common
   * at 16th-note quantization) would simply never match and silently
   * never play. Web Audio nodes can be scheduled arbitrarily far
   * ahead via `.start(when)`/`.stop(when)` (this is the API's own
   * documented pattern, not a workaround), so there's no need for
   * incremental lookahead here the way the open-ended click loop
   * needs it -- the whole chord progression and its timing are
   * already fully known the moment capturing begins.
   */
  _scheduleChordBacking() {
    for (const chord of this.chordsToPlay) {
      const when = this._audioTimeForBeat(COUNT_IN_BEATS + PICKUP_BEATS + chord.start);
      const durationSeconds = (chord.end - chord.start) * this.secondsPerBeat;
      const pitches = voiceChordSimple(chord.rootPitchClass, chord.quality);
      for (const pitch of pitches) {
        // 0.95x: a hair of detach so consecutive chords read as distinct hits, not one smeared-together tone.
        playNoteForDuration(pitch, 70, when, durationSeconds * 0.95);
      }
    }
  }

  _beginCapturing() {
    if (this.phase !== 'countIn') return; // cancelled/restarted before the count-in finished
    // Reading performance.now() fresh here (rather than deriving it
    // from the audio-time anchor) means this boundary can be off by a
    // few ms of setTimeout jitter -- harmless: it only shifts every
    // captured note's reported start by that same small constant, and
    // quantization (a 16th-note grid, ~60-100+ ms wide at any normal
    // tempo) already absorbs far more than that.
    this.captureStartRealTime = performance.now();
    this._setPhase('capturing');

    // Capturing starts right here, a full pickup bar (PICKUP_BEATS)
    // before the chords actually enter -- see recordingPipeline.js's
    // PICKUP_BEATS for why (pickup/anacrusis notes need somewhere to
    // be played into).
    if (this.mode === 'melody') {
      this._scheduleChordBacking();
      this._captureEndTimeoutId = setTimeout(
        () => this._finishCapture(),
        (PICKUP_BEATS + this.sectionLengthBeats) * this.secondsPerBeat * 1000
      );
    }
  }

  /** Feed one already-parsed MIDI message in; ignored unless a pass is actively capturing. */
  handleMidiMessage(parsedMessage) {
    if (this.phase !== 'capturing' || this.captureStartRealTime === null) return;
    const timestamp = (parsedMessage.timestamp - this.captureStartRealTime) / 1000;
    this.bufferedMessages.push({ ...parsedMessage, timestamp });
  }

  /** Chords mode only: the player says "that's the take." */
  stop() {
    if (this.mode !== 'chords' || this.phase !== 'capturing') return;
    const captureDurationSeconds = (performance.now() - this.captureStartRealTime) / 1000;
    this._finishCapture(captureDurationSeconds);
  }

  _finishCapture(chordsCaptureDurationSeconds = null) {
    clearInterval(this._scheduleIntervalId);
    clearTimeout(this._captureEndTimeoutId);
    stopAllNotes();

    let result;
    try {
      result =
        this.mode === 'chords'
          ? processChordsPass(this.bufferedMessages, this.tempo, chordsCaptureDurationSeconds, this.subdivisionsPerBeat)
          : processMelodyPass(this.bufferedMessages, this.tempo, this.sectionLengthBeats, this.subdivisionsPerBeat);
    } catch (error) {
      // A bad take (e.g. an unrecognizable chord) isn't a bug -- drop
      // back to idle so the player can just record it again, rather
      // than leaving the screen stuck in a 'done' phase nothing
      // renders for.
      this._setPhase('idle');
      this.onError(error);
      return;
    }

    this.result = result;
    this._setPhase('done');
    this.onDone(result);
  }

  /** Abort the current pass and start over from a fresh count-in (melody mode's "spacebar mid-take"). */
  restart() {
    const { chordsToPlay, sectionLengthBeats } = this;
    this.start({ chords: chordsToPlay, sectionLengthBeats });
  }

  /** Stop everything -- scheduled audio, pending timers -- without producing a result. */
  cancel() {
    clearInterval(this._scheduleIntervalId);
    clearTimeout(this._captureStartTimeoutId);
    clearTimeout(this._captureEndTimeoutId);
    stopAllNotes();
    this._setPhase('idle');
  }
}
