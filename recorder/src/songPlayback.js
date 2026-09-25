/**
 * One-shot playback of a finished song's chart data -- chords voiced
 * the same simple way as the melody-record backing track, plus the
 * captured melody, all scheduled precisely up front against the Web
 * Audio clock (see recordingSession.js's `_scheduleChordBacking` for
 * why that's the right pattern here, not incremental lookahead: the
 * whole song and its timing are already fully known before playback
 * starts). No count-in -- this is "hear the song," not a take.
 */

import { enableAudio, getAudioContext, playNoteForDuration, stopAllNotes } from './pianoSynth.js';
import { parseChordSymbol, voiceChordSimple } from './theory.js';

const CHORD_VELOCITY = 70;

/**
 * @param {object} chartData - a chart as read off disk (see songStorage.js)
 * @param {object} [options]
 * @param {() => void} [options.onDone] - fires once playback reaches the
 *   end on its own; does NOT fire if the returned `stop()` cuts it short.
 * @returns {Promise<() => void>} a `stop()` function that silences
 *   everything immediately.
 */
export async function playSong(chartData, { onDone } = {}) {
  await enableAudio(); // playback is itself a user gesture (the Play click) -- the right moment to unlock audio
  const audioContext = getAudioContext();
  const secondsPerBeat = 60 / chartData.tempo;
  const anchorAudioTime = audioContext.currentTime + 0.05; // small safety margin so the first note isn't already in the past

  // A pickup note's beat is negative -- the song can start before beat
  // 0 of its first section, not just at it.
  const startBeat = Math.min(0, ...chartData.melody.map((n) => n.beat));
  const endBeat = Math.max(0, ...chartData.sections.map((s) => s.end_beat));
  const audioTimeForBeat = (beat) => anchorAudioTime + (beat - startBeat) * secondsPerBeat;

  for (const chordEntry of chartData.chords) {
    const parsed = parseChordSymbol(chordEntry.chord);
    if (!parsed) continue; // an unrecognized symbol (e.g. a hand-edited chart file) -- skip it, don't crash playback
    const when = audioTimeForBeat(chordEntry.beat);
    const durationSeconds = chordEntry.duration_beats * secondsPerBeat;
    for (const pitch of voiceChordSimple(parsed.rootPitchClass, parsed.quality)) {
      // 0.95x: a hair of detach so consecutive chords read as distinct hits, not one smeared-together tone.
      playNoteForDuration(pitch, CHORD_VELOCITY, when, durationSeconds * 0.95);
    }
  }

  for (const note of chartData.melody) {
    const when = audioTimeForBeat(note.beat);
    const durationSeconds = note.duration_beats * secondsPerBeat;
    playNoteForDuration(note.pitch, note.velocity, when, durationSeconds * 0.95);
  }

  const totalSeconds = (endBeat - startBeat) * secondsPerBeat;
  const doneTimeoutId = setTimeout(() => onDone?.(), totalSeconds * 1000 + 150);

  return function stop() {
    clearTimeout(doneTimeoutId);
    stopAllNotes();
  };
}
