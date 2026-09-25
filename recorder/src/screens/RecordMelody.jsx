import { useEffect } from 'react';
import { useMidi } from '../hooks/MidiProvider.jsx';
import { useRecordingSession } from '../hooks/useRecordingSession.js';
import { formatChordSymbol } from '../theory.js';
import './shared.css';

/**
 * Right-hand pass: the chords play back (audibly, plus the click)
 * for exactly the section's already-decided length while you play the
 * melody over them -- there's no manual stop, it auto-finishes when
 * the chords do. Space mid-take scraps it and restarts the count-in
 * (there's no "I'm finished early" signal to give here, since the
 * length is already fixed).
 */
export default function RecordMelody({ title, sectionLabel, tempo, chordsResult, onBack, onDone }) {
  const { phase, result, error, start, restart, handleMidiMessage } = useRecordingSession({ tempo, mode: 'melody' });
  const midi = useMidi();

  useEffect(() => midi.subscribe(handleMidiMessage), [midi, handleMidiMessage]);

  useEffect(() => {
    if (phase === 'done' && result) onDone(result);
  }, [phase, result, onDone]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.code !== 'Space') return;
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      e.preventDefault();
      if (phase === 'idle') start({ chords: chordsResult.chords, sectionLengthBeats: chordsResult.sectionLengthBeats });
      else if (phase === 'countIn' || phase === 'capturing') restart();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, start, restart, chordsResult]);

  return (
    <div className="screen">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <a href="#" className="screen__back" onClick={(e) => { e.preventDefault(); onBack(); }}>&larr; Chords</a>
        <h1 style={{ fontSize: 26, marginTop: 6 }}>{title} &mdash; Section {sectionLabel} &mdash; Melody</h1>
      </div>

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

      <div className="panel">
        <span className="panel-label">Chords (playing back)</span>
        <div className="chord-bar-row">
          {chordsResult.chords.map((chord, i) => (
            <div key={i} className="chord-bar" style={{ fontSize: 14, padding: '10px 6px' }}>
              {formatChordSymbol(chord.rootPitchClass, chord.quality)}
            </div>
          ))}
        </div>
      </div>

      <div className="record-console">
        {phase === 'idle' && (
          <>
            <button
              className="record-button"
              onClick={() => start({ chords: chordsResult.chords, sectionLengthBeats: chordsResult.sectionLengthBeats })}
              aria-label="Start recording"
            >
              <span className="record-button__glyph" />
            </button>
            <span style={{ color: 'var(--ink-soft)', fontSize: 14, textAlign: 'center' }}>
              Press Space (or click) -- count-in, then the chords play back while you play the melody along with them
            </span>
          </>
        )}

        {phase === 'countIn' && <div className="status-pill">Count-in...</div>}

        {phase === 'capturing' && (
          <>
            <div className="record-button-wrap">
              <div className="record-button-ring" />
            </div>
            <div className="status-pill">Recording &mdash; Section {sectionLabel}, Melody</div>
            <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft)', textAlign: 'center' }}>
              Auto-stops when the chords finish &mdash; press Space to scrap this take and start over
            </span>
          </>
        )}
      </div>
    </div>
  );
}
