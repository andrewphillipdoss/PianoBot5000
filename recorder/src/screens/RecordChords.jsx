import { useEffect, useMemo } from 'react';
import { useMidi } from '../hooks/MidiProvider.jsx';
import { useRecordingSession } from '../hooks/useRecordingSession.js';
import QuantizationSelect from './QuantizationSelect.jsx';
import { detectChordQuality, formatChordSymbol, midiNoteName } from '../theory.js';
import './shared.css';

/**
 * Left-hand pass: press Space (or click) to begin a count-in, then
 * play the chords for this section, then Space again when done --
 * chords are authoritative for the section's length (see the design
 * discussion for why). Live feedback here is the held notes + the
 * detected chord, not a beat-synced metronome animation -- it's
 * accurate and immediate, where a decorative beat visual that isn't
 * actually beat-synced would just be misleading.
 *
 * The quantization picker only shows (and is only meaningful) while
 * idle -- useRecordingSession reads subdivisionsPerBeat once, at
 * construction, so changing it mid-take wouldn't do anything; ChordsReview
 * is where an *already-captured* take gets re-quantized instead.
 */
export default function RecordChords({ title, sectionLabel, tempo, subdivisionsPerBeat, onSubdivisionsPerBeatChange, onBack, onDone }) {
  const { phase, result, error, start, stop, handleMidiMessage } = useRecordingSession({ tempo, mode: 'chords', subdivisionsPerBeat });
  const midi = useMidi();

  // Feed the shared MIDI stream into this screen's recording session
  // only while it's actually mounted -- unsubscribes automatically on
  // navigating away, so nothing gets buffered when you're not here.
  useEffect(() => midi.subscribe(handleMidiMessage), [midi, handleMidiMessage]);

  useEffect(() => {
    if (phase === 'done' && result) onDone(result);
  }, [phase, result, onDone]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.code !== 'Space') return;
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      e.preventDefault();
      if (phase === 'idle') start();
      else if (phase === 'capturing') stop();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, start, stop]);

  const heldChord = useMemo(() => {
    const held = [...midi.heldNotes];
    const pitchClasses = held.map((p) => p % 12);
    const distinctCount = new Set(pitchClasses).size;
    if (distinctCount !== 3 && distinctCount !== 4) return null;
    const bassPitchClass = held.reduce((min, p) => Math.min(min, p), Infinity) % 12;
    return detectChordQuality(pitchClasses, bassPitchClass);
  }, [midi.heldNotes]);

  return (
    <div className="screen">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <a href="#" className="screen__back" onClick={(e) => { e.preventDefault(); onBack(); }}>&larr; Back</a>
        <h1 style={{ fontSize: 26, marginTop: 6 }}>{title} &mdash; Section {sectionLabel} &mdash; Chords</h1>
      </div>

      {midi.status === 'denied' && (
        <div className="panel">MIDI access was denied -- reload and allow the permission prompt to record.</div>
      )}
      {midi.status === 'granted' && midi.inputs.length === 0 && (
        <div className="panel">No MIDI input found -- check your keyboard/interface is plugged in.</div>
      )}
      {error && (
        <div className="panel" style={{ borderColor: 'var(--live)', color: 'var(--live)' }}>
          Couldn't make sense of that take -- {error.message}. Press Space (or click) to try the section again.
        </div>
      )}

      {midi.inputs.length === 1 && (
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Connected: {midi.inputs[0].name}</span>
      )}
      {midi.inputs.length > 1 && (
        <label className="field">
          Input device
          <select value={midi.selectedInputId ?? ''} onChange={(e) => midi.setSelectedInputId(e.target.value)}>
            {midi.inputs.map((input) => (
              <option key={input.id} value={input.id}>
                {input.name} {input.manufacturer ? `(${input.manufacturer})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="record-console">
        {phase === 'idle' && (
          <>
            <QuantizationSelect label="Chords quantization" value={subdivisionsPerBeat} onChange={onSubdivisionsPerBeatChange} />
            <button className="record-button" onClick={start} aria-label="Start recording">
              <span className="record-button__glyph" />
            </button>
            <span style={{ color: 'var(--ink-soft)', fontSize: 14, textAlign: 'center' }}>
              Press Space (or click) to start -- count-in, then play the chords for this section
            </span>
          </>
        )}

        {phase === 'countIn' && <div className="status-pill">Count-in...</div>}

        {phase === 'capturing' && (
          <>
            <div className="record-button-wrap">
              <div className="record-button-ring" />
              <button className="record-button" onClick={stop} aria-label="Stop recording">
                <span className="record-button__glyph" />
              </button>
            </div>
            <div className="status-pill">Recording &mdash; Section {sectionLabel}, Chords</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minHeight: 40 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                {[...midi.heldNotes].sort((a, b) => a - b).map(midiNoteName).join(' ') || 'Play a chord...'}
              </span>
              {heldChord && (
                <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, fontSize: 28, color: 'var(--accent-dark)' }}>
                  {formatChordSymbol(heldChord.rootPitchClass, heldChord.quality)}
                </span>
              )}
            </div>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Press Space (or click) when you're done with this section</span>
          </>
        )}
      </div>
    </div>
  );
}
