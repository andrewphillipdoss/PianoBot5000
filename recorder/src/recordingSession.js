/**
 * The real-time recording state machine: count-in -> capture -> a
 * result (any part -- chords, melody or bassline -- via
 * recordingPipeline.js's processTake). Deliberately a plain class, not
 * a React hook itself -- audio timing (the metronome, the backing
 * track of the section's other parts) needs to be driven by the Web
 * Audio clock directly, and React's render cycle isn't reliably timely
 * enough for that. useRecordingSession.js wraps an instance of this
 * for the UI to read.
 *
 * Every take is one of two kinds, decided by whether `start()` is
 * given a `sectionLengthBeats` (see recordingPipeline.js):
 *
 *   - open-ended: the section's first take, whichever part it is. No
 *     backing (there's nothing else recorded yet), no pickup bar
 *     (there's no downbeat to lead into), runs until `stop()`.
 *   - fixed: every take after that. The section's other parts play
 *     back as a backing track and capture auto-stops at the section's
 *     end; a melody or bassline take can start with a pickup bar.
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
  DEFAULT_METRONOME_SUBDIVISIONS_PER_BEAT,
  processTake,
} from './recordingPipeline.js';
import { getAudioContext, playClickAt, playNoteForDuration, stopAllNotes } from './pianoSynth.js';
import { voiceChordSimple } from './theory.js';

const SCHEDULE_INTERVAL_MS = 25; // how often the lookahead loop wakes up
const SCHEDULE_AHEAD_SECONDS = 0.15; // how far into the future it schedules audio each time it wakes
const BACKING_CHORD_VELOCITY = 70;

export class RecordingSession {
  /**
   * @param {object} options
   * @param {number} options.tempo - BPM
   * @param {'chords'|'melody'|'bassline'} options.part - which part this take records
   * @param {number} [options.subdivisionsPerBeat] - quantization grid
   *   (2/4/8 = 8th/16th/32nd notes); defaults depend on `part` (chords:
   *   8th, melody/bassline: 16th -- see recordingPipeline.js).
   * @param {number} [options.quantizeStrength] - melody/bassline only:
   *   how hard captured notes snap to that grid (see theory.js's
   *   quantizeBeat).
   * @param {number} [options.pickupBeats] - melody/bassline fixed takes
   *   only: how much lead-in to capture before the section's downbeat --
   *   defaults to one full bar; 0 skips the pickup bar. Ignored for a
   *   chords take and for any take that sets the section's length.
   * @param {number} [options.beatsPerBar] - the song's time signature
   *   (its numerator) -- defaults to 4/4. Sets the count-in's length
   *   (one bar), the metronome's accent pattern, and the default
   *   pickup-bar length.
   * @param {number} [options.metronomeSubdivisionsPerBeat] - clicks per
   *   beat: 1 (quarter notes) clicks only on the beat; 2 (the default,
   *   eighth notes) adds a much quieter click on the in-between eighth.
   * @param {(phase: string) => void} [options.onPhaseChange]
   * @param {(isPickupBar: boolean) => void} [options.onPickupBarChange] -
   *   fires true right as capturing begins, then false once the pickup
   *   bar has elapsed -- only on a take that actually has one.
   * @param {(result: object) => void} [options.onDone]
   * @param {(error: Error) => void} [options.onError] - fires instead of
   *   onDone on a genuinely unexpected failure turning a take into a
   *   result. Messy playing isn't one -- see recordingPipeline.js for
   *   how much a take withstands. Phase drops back to 'idle' so the
   *   player can just hit record again.
   */
  constructor({ tempo, part, subdivisionsPerBeat, quantizeStrength, pickupBeats, beatsPerBar, metronomeSubdivisionsPerBeat, onPhaseChange, onPickupBarChange, onDone, onError }) {
    subdivisionsPerBeat ??= part === 'chords' ? DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT : DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT;
    quantizeStrength ??= DEFAULT_MELODY_QUANTIZE_STRENGTH; // a chords take never uses this (processChordsPass takes no strength)
    beatsPerBar ??= DEFAULT_BEATS_PER_BAR;
    pickupBeats ??= beatsPerBar;
    metronomeSubdivisionsPerBeat ??= DEFAULT_METRONOME_SUBDIVISIONS_PER_BEAT;
    this.tempo = tempo;
    this.part = part;
    this.subdivisionsPerBeat = subdivisionsPerBeat;
    this.quantizeStrength = quantizeStrength;
    this.configuredPickupBeats = pickupBeats;
    this.beatsPerBar = beatsPerBar;
    this.metronomeSubdivisionsPerBeat = metronomeSubdivisionsPerBeat;
    this.secondsPerBeat = 60 / tempo;
    this.onPhaseChange = onPhaseChange ?? (() => {});
    this.onPickupBarChange = onPickupBarChange ?? (() => {});
    this.onDone = onDone ?? (() => {});
    this.onError = onError ?? (() => {});
    this.phase = 'idle'; // idle | countIn | capturing | done
    this.sectionLengthBeats = null;
    this.backing = {};
    this.pickupBeats = 0;
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

  /** True when this take has no length to play against yet -- it's the one that decides it. */
  get setsLength() {
    return this.sectionLengthBeats === null;
  }

  /**
   * Begin a take: count-in, then capture.
   *
   * @param {object} [options]
   * @param {number|null} [options.sectionLengthBeats] - the section's
   *   existing length, or null (the default) if this take sets it.
   * @param {{chords?: object[], melody?: object[], bassline?: object[]}} [options.backing] -
   *   the section's other parts, in beats from its downbeat (chords as
   *   theory.js ChordEvents, lines as {pitch, velocity, start, end}),
   *   played back while this take records. Ignored on an open-ended
   *   take; pass only the parts *other* than the one being recorded.
   */
  start({ sectionLengthBeats = null, backing = {} } = {}) {
    this.cancel();
    this._resetPassState();
    this.sectionLengthBeats = sectionLengthBeats;
    this.backing = backing;
    this.pickupBeats = !this.setsLength && this.part !== 'chords' ? this.configuredPickupBeats : 0;

    const audioContext = getAudioContext();
    this._anchorRealTime = performance.now();
    this._anchorAudioTime = audioContext.currentTime + 0.05; // small safety margin so the first click isn't already in the past

    this._setPhase('countIn');
    if (!this.setsLength) this._scheduleBacking();
    this._scheduleIntervalId = setInterval(() => this._scheduleAhead(), SCHEDULE_INTERVAL_MS);
    this._captureStartTimeoutId = setTimeout(() => this._beginCapturing(), this.beatsPerBar * this.secondsPerBeat * 1000);
  }

  _audioTimeForBeat(beatIndex) {
    return this._anchorAudioTime + beatIndex * this.secondsPerBeat;
  }

  /** Beats from the anchor (the count-in's first click) to the section's downbeat. */
  get _downbeatOffset() {
    return this.beatsPerBar + this.pickupBeats;
  }

  _scheduleAhead() {
    const audioContext = getAudioContext();
    if (!audioContext) return;
    const horizon = audioContext.currentTime + SCHEDULE_AHEAD_SECONDS;
    const clickStep = 1 / this.metronomeSubdivisionsPerBeat;

    // At the default (2 clicks/beat), visits half-beat positions (the
    // beat itself, then its eighth-note subdivision) so the click loop
    // can give that in-between pulse its own much-quieter 'off' click --
    // a subdivision guide, not a fourth accent level alongside
    // strong/weak. At 1 click/beat, clickStep is a whole beat, so
    // `isOffBeat` below is never true.
    while (this._audioTimeForBeat(this.nextScheduledBeat) < horizon) {
      const beatPosition = this.nextScheduledBeat;
      const isOffBeat = beatPosition % 1 !== 0;
      const isCountInBeat = beatPosition < this.beatsPerBar;
      const beatWithinCapture = beatPosition - this.beatsPerBar;

      // An open-ended take has no known end -- keep clicking until
      // stop() cancels this loop. A fixed one stops once it's covered.
      if (!isCountInBeat && !this.setsLength && beatWithinCapture >= this.pickupBeats + this.sectionLengthBeats) break;

      const when = this._audioTimeForBeat(beatPosition);
      const strength = isOffBeat ? 'off' : (isCountInBeat ? beatPosition === 0 : beatWithinCapture % this.beatsPerBar === 0) ? 'strong' : 'weak';
      playClickAt(when, strength);

      this.nextScheduledBeat += clickStep;
    }
  }

  /**
   * Schedule every backing event's audio in one precise pass, up front,
   * rather than piggybacking on the click loop above -- that loop only
   * visits grid positions, and a chord or note on a finer beat (e.g.
   * 2.25, common at 16th-note quantization) would never match. Web
   * Audio nodes can be scheduled arbitrarily far ahead via
   * `.start(when)`/`.stop(when)`, and the whole backing track is
   * already fully known, so there's no need for incremental lookahead.
   * cancel()'s stopAllNotes() silences anything not yet played.
   *
   * A backing line's own pickup notes (negative beats) play in this
   * take's pickup bar, or even its count-in -- anything that would land
   * before the count-in's first click is simply skipped.
   */
  _scheduleBacking() {
    const schedule = (pitch, velocity, start, end) => {
      const beat = this._downbeatOffset + start;
      if (beat < 0) return;
      // 0.95x: a hair of detach so consecutive hits read as distinct, not one smeared-together tone.
      playNoteForDuration(pitch, velocity, this._audioTimeForBeat(beat), (end - start) * this.secondsPerBeat * 0.95);
    };
    for (const chord of this.backing.chords ?? []) {
      for (const pitch of voiceChordSimple(chord.rootPitchClass, chord.quality, undefined, chord.bassPitchClass)) {
        schedule(pitch, BACKING_CHORD_VELOCITY, chord.start, chord.end);
      }
    }
    for (const note of [...(this.backing.melody ?? []), ...(this.backing.bassline ?? [])]) {
      schedule(note.pitch, note.velocity ?? 80, note.start, note.end);
    }
  }

  _beginCapturing() {
    if (this.phase !== 'countIn') return; // cancelled/restarted before the count-in finished
    // Derived from the start()-time anchor rather than a fresh
    // performance.now() read here. This boundary is exactly when the
    // metronome/backing audio schedule *nominally* reaches the end of
    // the count-in -- the same clock a player is actually listening to
    // and playing along with. A fresh read is instead whenever this
    // setTimeout callback happens to actually fire, which can lag the
    // nominal boundary by tens of milliseconds under main-thread
    // contention -- enough, at 32nd notes and a fast tempo, to land a
    // note on the wrong side of its intended grid line.
    this.captureStartRealTime = this._anchorRealTime + this.beatsPerBar * this.secondsPerBeat * 1000;
    this._setPhase('capturing');

    if (this.setsLength) return; // runs until stop()

    // Capturing starts right here, `this.pickupBeats` before the
    // section's downbeat -- see recordingPipeline.js's PICKUP_BEATS.
    if (this.pickupBeats > 0) {
      this._setPickupBar(true);
      this._pickupEndTimeoutId = setTimeout(() => this._setPickupBar(false), this.pickupBeats * this.secondsPerBeat * 1000);
    }
    this._captureEndTimeoutId = setTimeout(() => this._finishCapture(), (this.pickupBeats + this.sectionLengthBeats) * this.secondsPerBeat * 1000);
  }

  /**
   * Which bar of the section is playing right now, counting the
   * section's downbeat as bar 1 (0 or less during a pickup bar) -- or
   * null when not capturing. Read on a timer by the record screen for
   * its live bar counter; nothing here depends on it.
   *
   * On an open-ended take the section doesn't start until the player
   * does: bars before the first note are dropped when its length is
   * recognized (see theory.js's recognizeSectionBars), so they aren't
   * counted here either -- null until something's been played, then
   * bar 1 is the bar that first note landed in.
   */
  currentBar() {
    if (this.phase !== 'capturing' || this.captureStartRealTime === null) return null;
    const barSeconds = this.beatsPerBar * this.secondsPerBeat;
    const elapsedSeconds = (performance.now() - this.captureStartRealTime) / 1000;
    if (!this.setsLength) return Math.floor((elapsedSeconds - this.pickupBeats * this.secondsPerBeat) / barSeconds) + 1;
    const firstNote = this.bufferedMessages.find((m) => m.type === 'noteon');
    if (!firstNote) return null;
    return Math.floor(elapsedSeconds / barSeconds) - Math.floor(Math.max(0, firstNote.timestamp) / barSeconds) + 1;
  }

  /** Feed one already-parsed MIDI message in; ignored unless a take is actively capturing. */
  handleMidiMessage(parsedMessage) {
    if (this.phase !== 'capturing' || this.captureStartRealTime === null) return;
    const timestamp = (parsedMessage.timestamp - this.captureStartRealTime) / 1000;
    this.bufferedMessages.push({ ...parsedMessage, timestamp });
  }

  /** Open-ended takes only: the player says "that's the take." */
  stop() {
    if (!this.setsLength || this.phase !== 'capturing') return;
    this._finishCapture((performance.now() - this.captureStartRealTime) / 1000);
  }

  _finishCapture(openEndedDurationSeconds = null) {
    clearInterval(this._scheduleIntervalId);
    clearTimeout(this._captureEndTimeoutId);
    clearTimeout(this._pickupEndTimeoutId);
    this._setPickupBar(false);
    stopAllNotes();

    const captureDurationSeconds = openEndedDurationSeconds ?? (this.pickupBeats + this.sectionLengthBeats) * this.secondsPerBeat;
    let result;
    try {
      // rawMessages (plus the capture's real duration and pickup) ride
      // along on the result so the section hub can re-derive it with a
      // *different* quantization without re-recording.
      result = {
        ...processTake(this.part, this.bufferedMessages, this.tempo, {
          captureDurationSeconds,
          sectionLengthBeats: this.sectionLengthBeats,
          subdivisionsPerBeat: this.subdivisionsPerBeat,
          quantizeStrength: this.quantizeStrength,
          pickupBeats: this.pickupBeats,
          beatsPerBar: this.beatsPerBar,
        }),
        part: this.part,
        setsLength: this.setsLength,
        rawMessages: this.bufferedMessages,
        captureDurationSeconds,
        pickupBeats: this.pickupBeats,
      };
    } catch (error) {
      this._setPhase('idle');
      this.onError(error);
      return;
    }

    this.result = result;
    this._setPhase('done');
    this.onDone(result);
  }

  /** Abort the current take and start over from a fresh count-in ("spacebar mid-take"). */
  restart() {
    this.start({ sectionLengthBeats: this.sectionLengthBeats, backing: this.backing });
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
