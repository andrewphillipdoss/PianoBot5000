import { useEffect } from 'react';
import { useMidi } from '../hooks/MidiProvider.jsx';
import { useRecordingSession } from '../hooks/useRecordingSession.js';
import ChordChart from './ChordChart.jsx';
import ChordLabel from './ChordLabel.jsx';
import QuantizationSelect from './QuantizationSelect.jsx';
import QuantizeStrengthSelect from './QuantizeStrengthSelect.jsx';
import TempoInput from './TempoInput.jsx';
import './shared.css';

/**
 * The optional bassline pass -- a second, independent monophonic line
 * (see SongSetup.jsx's own checkbox for turning it on) recorded the
 * exact same way the melody pass is: the chords play back for exactly
 * the section's already-decided length while you play the bass line
 * over them, auto-stopping when they finish. It's genuinely the same
 * machinery underneath (`useRecordingSession({mode: 'melody', ...})`,
 * `processMelodyPass` in recordingPipeline.js) -- there's nothing
 * melody-specific about pickup-bar handling, quantize-strength, or
 * monophonic clipping; a bass line wants exactly the same treatment,
 * just stored separately (`chartData.bassline`, not `.melody`) and
 * with its own independent quantization/pickup settings, since a
 * player might reasonably want a coarser grid for a simpler bass line
 * than for the melody on top of it.
 *
 * Order relative to the melody pass (before or after) is a per-song
 * choice made at setup (`song.basslineFirst`, see RecordSongFlow.jsx) --
 * this screen itself doesn't care which side of the melody pass it's
 * on; `onBack` always returns to Chords review either way, same as
 * RecordMelody's own back link does.
 */
export default function RecordBassline({
  title,
  sectionLabel,
  tempo,
  onTempoChange,
  subdivisionsPerBeat,
  onSubdivisionsPerBeatChange,
  quantizeStrength,
  onQuantizeStrengthChange,
  hasPickupBar,
  onHasPickupBarChange,
  pickupBeats,
  beatsPerBar,
  chordsResult,
  onBack,
  onDone,
}) {
  const { phase, result, error, isPickupBar, start, restart, handleMidiMessage } = useRecordingSession({
    tempo,
    mode: 'melody', // same state machine as the melody pass -- see this file's own docstring for why
    subdivisionsPerBeat,
    quantizeStrength,
    pickupBeats,
    beatsPerBar,
  });
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
        <h1 style={{ fontSize: 26, marginTop: 6 }}>{title} &mdash; Section {sectionLabel} &mdash; Bassline</h1>
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
        <ChordChart
          chords={chordsResult.chords}
          renderLabel={(chord) => <ChordLabel {...chord} />}
          barStyle={{ fontSize: 14, padding: '10px 6px' }}
          beatsPerBar={beatsPerBar}
        />
      </div>

      <div className="record-console">
        {phase === 'idle' && (
          <>
            <TempoInput value={tempo} onChange={onTempoChange} />
            <QuantizationSelect label="Bassline quantization" value={subdivisionsPerBeat} onChange={onSubdivisionsPerBeatChange} />
            <QuantizeStrengthSelect value={quantizeStrength} onChange={onQuantizeStrengthChange} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-soft)' }}>
              <input type="checkbox" checked={hasPickupBar} onChange={(e) => onHasPickupBarChange(e.target.checked)} />
              Pickup measure
            </label>
            <button
              className="record-button"
              onClick={() => start({ chords: chordsResult.chords, sectionLengthBeats: chordsResult.sectionLengthBeats })}
              aria-label="Start recording"
            >
              <span className="record-button__glyph" />
            </button>
            <span style={{ color: 'var(--ink-soft)', fontSize: 14, textAlign: 'center' }}>
              {hasPickupBar
                ? 'Press Space (or click) -- count-in, then a pickup bar for any lead-in notes, then the chords play back while you play the bass line along with them'
                : 'Press Space (or click) -- count-in, then the chords play back right away while you play the bass line along with them'}
            </span>
          </>
        )}

        {phase === 'countIn' && <div className="status-pill">Count-in...</div>}

        {phase === 'capturing' && (
          <>
            <div className="record-button-wrap">
              <div className="record-button-ring" />
            </div>
            {isPickupBar ? (
              <>
                <div className="status-pill">Pickup bar &mdash; Section {sectionLabel}</div>
                <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft)', textAlign: 'center' }}>
                  Play any lead-in notes now &mdash; the chords start right after this bar
                </span>
              </>
            ) : (
              <div className="status-pill">Recording &mdash; Section {sectionLabel}, Bassline</div>
            )}
            <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft)', textAlign: 'center' }}>
              Auto-stops when the chords finish &mdash; press Space to scrap this take and start over
            </span>
          </>
        )}
      </div>
    </div>
  );
}
