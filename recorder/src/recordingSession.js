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

import {
  DEFAULT_BEATS_PER_BAR,
  DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT,
  DEFAULT_MELODY_QUANTIZE_STRENGTH,
  DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT,
  processChordsPass,
  processMelodyPass,
} from './recordingPipeline.js';
import { getAudioContext, playClickAt, playNoteForDuration, stopAllNotes } from './pianoSynth.js';
import { voiceChordSimple } from './theory.js';

const SCHEDULE_INTERVAL_MS = 25; // how often the lookahead loop wakes up
const SCHEDULE_AHEAD_SECONDS = 0.15; // how far into the future it schedules audio each time it wakes

export class RecordingSession {
  /**
   * @param {object} options
   * @param {number} options.tempo - BPM
   * @param {'chords'|'melody'} options.mode
   * @param {number} [options.subdivisionsPerBeat] - quantization grid,
   *   chosen per-song at setup (2/4/8 = 8th/16th/32nd notes); defaults
   *   depend on `mode` (chords: 8th, melody: 16th -- see
   *   recordingPipeline.js) since a caller not specifying one is only
   *   ever a test, never real UI (SongSetup.jsx always passes one).
   * @param {number} [options.quantizeStrength] - melody mode only: how
   *   hard captured notes snap to that grid (see theory.js's
   *   quantizeBeat) -- defaults to recordingPipeline.js's softened
   *   default rather than a full snap. Not used in chords mode.
   * @param {number} [options.pickupBeats] - melody mode only: how much
   *   lead-in to capture before the chords enter -- defaults to one
   *   full bar (`beatsPerBar`), but 0 skips the pickup bar entirely for
   *   a song that never needs one (capturing starts right on the
   *   downbeat instead).
   * @param {number} [options.beatsPerBar] - the song's time signature
   *   (its numerator, treating the beat as a quarter note) -- defaults
   *   to 4/4. Sets the count-in's length (one bar), the metronome's
   *   accent pattern (strong on beat 1 of every bar), and the default
   *   pickup-bar length.
   * @param {(phase: string) => void} [options.onPhaseChange]
   * @param {(isPickupBar: boolean) => void} [options.onPickupBarChange] -
   *   melody mode only, and only when `pickupBeats` > 0: fires true
   *   right as capturing begins, then false once the pickup bar has
   *   elapsed and the chords have started. Lets the UI say "this is the
   *   pickup bar" instead of just "recording." Never fires at all with
   *   no pickup bar configured -- there's nothing to distinguish.
   * @param {(result: object) => void} [options.onDone]
   * @param {(error: Error) => void} [options.onError] - fires instead of
   *   onDone when the just-captured take can't be turned into a result
   *   (chords mode: detectChords() rejecting an unrecognizable cluster of
   *   held notes -- see theory.js). Phase drops back to 'idle' so the
   *   player can just hit record again.
   */
  constructor({ tempo, mode, subdivisionsPerBeat, quantizeStrength, pickupBeats, beatsPerBar, onPhaseChange, onPickupBarChange, onDone, onError }) {
    subdivisionsPerBeat ??= mode === 'melody' ? DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT : DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT;
    quantizeStrength ??= DEFAULT_MELODY_QUANTIZE_STRENGTH; // chords mode never uses this (processChordsPass takes no strength)
    beatsPerBar ??= DEFAULT_BEATS_PER_BAR;
    pickupBeats ??= beatsPerBar;
    this.tempo = tempo;
    this.mode = mode;
    this.subdivisionsPerBeat = subdivisionsPerBeat;
    this.quantizeStrength = quantizeStrength;
    this.pickupBeats = pickupBeats;
    this.beatsPerBar = beatsPerBar;
    this.secondsPerBeat = 60 / tempo;
    this.onPhaseChange = onPhaseChange ?? (() => {});
    this.onPickupBarChange = onPickupBarChange ?? (() => {});
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
    this._pickupEndTimeoutId = null;
    this._setPickupBar(false);
  }

  _setPickupBar(isPickupBar) {
    this.isPickupBar = isPickupBar;
    this.onPickupBarChange(isPickupBar);
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
    this._captureStartTimeoutId = setTimeout(() => this._beginCapturing(), this.beatsPerBar * this.secondsPerBeat * 1000);
  }

  _audioTimeForBeat(beatIndex) {
    return this._anchorAudioTime + beatIndex * this.secondsPerBeat;
  }

  _scheduleAhead() {
    const audioContext = getAudioContext();
    if (!audioContext) return;
    const horizon = audioContext.currentTime + SCHEDULE_AHEAD_SECONDS;

    // Visits half-beat positions (the beat itself, then its eighth-note
    // subdivision) so the click loop can give that in-between pulse its
    // own much-quieter 'off' click -- a subdivision guide, not a fourth
    // accent level alongside strong/weak.
    while (this._audioTimeForBeat(this.nextScheduledBeat) < horizon) {
      const beatPosition = this.nextScheduledBeat;
      const isOffBeat = beatPosition % 1 !== 0;
      const isCountInBeat = beatPosition < this.beatsPerBar;
      const beatWithinCapture = beatPosition - this.beatsPerBar;

      // Chords mode has no known end -- keep clicking until stop() cancels this loop.
      // Melody mode's length (pickup bar + section) is fixed, so stop once it's covered.
      if (!isCountInBeat && this.mode === 'melody' && beatWithinCapture >= this.pickupBeats + this.sectionLengthBeats) break;

      const when = this._audioTimeForBeat(beatPosition);
      const strength = isOffBeat ? 'off' : (isCountInBeat ? beatPosition === 0 : beatWithinCapture % this.beatsPerBar === 0) ? 'strong' : 'weak';
      playClickAt(when, strength);

      this.nextScheduledBeat += 0.5;
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
      const when = this._audioTimeForBeat(this.beatsPerBar + this.pickupBeats + chord.start);
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
    // Derived from the start()-time anchor rather than a fresh
    // performance.now() read here. This boundary is exactly when the
    // metronome/chord-backing audio schedule *nominally* reaches the
    // end of the count-in -- the same clock a player is actually
    // listening to and playing along with. A fresh read is instead
    // whenever this setTimeout callback happens to actually fire,
    // which can lag the nominal boundary by tens of milliseconds under
    // any main-thread contention (more likely now that the metronome
    // schedules twice as many clicks). That was previously dismissed
    // as harmless on the assumption that a quantization grid is always
    // tens of ms wide -- true at 16th notes and a moderate tempo, false
    // at 32nd notes and a fast one (a single grid step can be under
    // 50ms), where that lag is enough to consistently land a note on
    // the wrong side of its intended grid line.
    this.captureStartRealTime = this._anchorRealTime + this.beatsPerBar * this.secondsPerBeat * 1000;
    this._setPhase('capturing');

    // Capturing starts right here, `this.pickupBeats` before the chords
    // actually enter -- see recordingPipeline.js's PICKUP_BEATS for why
    // (pickup/anacrusis notes need somewhere to be played into). Skipped
    // entirely when pickupBeats is 0 (no pickup bar wanted) -- nothing
    // to signal, capturing starts right on the downbeat.
    if (this.mode === 'melody') {
      if (this.pickupBeats > 0) {
        this._setPickupBar(true);
        this._pickupEndTimeoutId = setTimeout(() => this._setPickupBar(false), this.pickupBeats * this.secondsPerBeat * 1000);
      }
      this._scheduleChordBacking();
      this._captureEndTimeoutId = setTimeout(
        () => this._finishCapture(),
        (this.pickupBeats + this.sectionLengthBeats) * this.secondsPerBeat * 1000
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
    clearTimeout(this._pickupEndTimeoutId);
    this._setPickupBar(false);
    stopAllNotes();

    let result;
    try {
      // rawMessages (plus, for chords, the real capture duration) ride
      // along on the result so a later screen can re-derive it with a
      // *different* quantization without re-recording -- see
      // ChordsReview.jsx/SectionComplete.jsx.
      result =
        this.mode === 'chords'
          ? {
              ...processChordsPass(this.bufferedMessages, this.tempo, chordsCaptureDurationSeconds, this.subdivisionsPerBeat, this.beatsPerBar),
              rawMessages: this.bufferedMessages,
              captureDurationSeconds: chordsCaptureDurationSeconds,
            }
          : {
              ...processMelodyPass(this.bufferedMessages, this.tempo, this.sectionLengthBeats, this.subdivisionsPerBeat, this.quantizeStrength, this.pickupBeats),
              rawMessages: this.bufferedMessages,
            };
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
    clearTimeout(this._pickupEndTimeoutId);
    this._setPickupBar(false);
    stopAllNotes();
    this._setPhase('idle');
  }
}
