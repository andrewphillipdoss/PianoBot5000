import { useEffect, useMemo, useState } from 'react';
import { useMidi } from '../hooks/MidiProvider.jsx';
import { useRecordingSession } from '../hooks/useRecordingSession.js';
import { PART_NAMES } from '../parts.js';
import { detectChordQuality, formatChordSymbol, midiNoteName } from '../theory.js';
import ChordChart from './ChordChart.jsx';
import MelodyRoll from './MelodyRoll.jsx';
import MetronomeSubdivisionSelect from './MetronomeSubdivisionSelect.jsx';
import QuantizationSelect from './QuantizationSelect.jsx';
import QuantizeStrengthSelect from './QuantizeStrengthSelect.jsx';
import TempoInput from './TempoInput.jsx';
import './shared.css';

// What each part listens for -- said up front, so nobody has to guess
// how "clean" a take needs to be (see theory.js for the real rules).
const PART_HINTS = {
  chords: 'Play the changes however feels natural -- triads, 7ths, 9ths. A slipped note or a stray melody note won\'t spoil the take.',
  melody: 'Play freely, with both hands if you like -- the top note is what\'s kept as the melody.',
  bassline: 'Single low notes or octaves -- otherwise the lowest note you play (middle C or below) is kept as the bass.',
};

/**
 * One screen for recording any part of a section -- chords, melody or
 * bassline, in whatever order (see SectionHub.jsx). What kind of take
 * it is follows from the section, not from the part:
 *
 *   - `sectionLengthBeats` null: nothing's been recorded in this section
 *     yet, so this take sets its length. Count-in, then play until
 *     you're done and press Space (or the button) to stop.
 *   - otherwise: the section's other parts (`backing`) play back while
 *     you record against them, and the take stops by itself at the end.
 *     A melody or bassline take can start with a pickup bar for any
 *     lead-in notes; Space mid-take scraps it and starts over.
 *
 * The idle-screen pickers (tempo, quantization, snap strength, pickup,
 * metronome) are only shown while idle: useRecordingSession reads them
 * once, at construction, so the caller keys this screen on all of them
 * to remount on a change (see RecordSongFlow.jsx).
 */
export default function RecordPart({
  part,
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
  metronomeSubdivisionsPerBeat,
  onMetronomeSubdivisionsPerBeatChange,
  sectionLengthBeats,
  backing,
  onBack,
  onDone,
}) {
  const setsLength = sectionLengthBeats === null;
  const isLine = part !== 'chords';
  const { phase, result, error, isPickupBar, start, stop, restart, handleMidiMessage, currentBar } = useRecordingSession({
    tempo,
    part,
    subdivisionsPerBeat,
    quantizeStrength,
    pickupBeats,
    beatsPerBar,
    metronomeSubdivisionsPerBeat,
  });
  const midi = useMidi();
  const partName = PART_NAMES[part];
  const bars = setsLength ? null : sectionLengthBeats / beatsPerBar;
  const willHavePickup = isLine && !setsLength && hasPickupBar;

  // Feed the shared MIDI stream into this screen's recording session
  // only while it's actually mounted.
  useEffect(() => midi.subscribe(handleMidiMessage), [midi, handleMidiMessage]);

  useEffect(() => {
    if (phase === 'done' && result) onDone(result);
  }, [phase, result, onDone]);

  const begin = () => start({ sectionLengthBeats, backing });

  useEffect(() => {
    function onKeyDown(e) {
      if (e.code !== 'Space') return;
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      e.preventDefault();
      if (phase === 'idle') start({ sectionLengthBeats, backing });
      else if (phase === 'capturing' && setsLength) stop();
      else if (phase === 'countIn' || phase === 'capturing') restart();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, start, stop, restart, sectionLengthBeats, backing, setsLength]);

  // A live bar counter while capturing -- on an open-ended take it's
  // how many bars the section is heading for; on a fixed one, where
  // you are in it. Polled rather than pushed: it's display only.
  const [bar, setBar] = useState(null);
  useEffect(() => {
    if (phase !== 'capturing') return undefined;
    const id = setInterval(() => setBar(currentBar()), 100);
    return () => clearInterval(id);
  }, [phase, currentBar]);

  const heldNotes = useMemo(() => [...midi.heldNotes].sort((a, b) => a - b), [midi.heldNotes]);
  const heldChord = useMemo(() => {
    if (part !== 'chords') return null;
    const pitchClasses = heldNotes.map((p) => p % 12);
    const distinctCount = new Set(pitchClasses).size;
    if (distinctCount < 3 || distinctCount > 5) return null;
    return detectChordQuality(pitchClasses, heldNotes[0] % 12);
  }, [part, heldNotes]);

  const hasBacking = !setsLength && ((backing.chords?.length ?? 0) + (backing.melody?.length ?? 0) + (backing.bassline?.length ?? 0) > 0);

  return (
    <div className="screen">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <a href="#" className="screen__back" onClick={(e) => { e.preventDefault(); onBack(); }}>&larr; Section {sectionLabel}</a>
        <h1 style={{ fontSize: 26, marginTop: 6 }}>{title} &mdash; Section {sectionLabel} &mdash; {partName}</h1>
      </div>

      {midi.status === 'denied' && <div className="panel">MIDI access was denied -- reload and allow the permission prompt to record.</div>}
      {midi.status === 'granted' && midi.inputs.length === 0 && (
        <div className="panel">No MIDI input found -- check your keyboard/interface is plugged in.</div>
      )}
      {error && (
        <div className="panel" style={{ borderColor: 'var(--live)', color: 'var(--live)' }}>
          Couldn't make sense of that take -- {error.message}. Press Space (or click) to try again.
        </div>
      )}

      {midi.inputs.length === 1 && <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Connected: {midi.inputs[0].name}</span>}
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

      {hasBacking && (
        <>
          {backing.chords?.length > 0 && (
            <div className="panel">
              <span className="panel-label">Chords (playing along)</span>
              <ChordChart chords={backing.chords} sectionLengthBeats={sectionLengthBeats} beatsPerBar={beatsPerBar} />
            </div>
          )}
          {['melody', 'bassline'].map(
            (line) =>
              backing[line]?.length > 0 && (
                <div key={line} className="panel">
                  <span className="panel-label">{PART_NAMES[line]} (playing along)</span>
                  <MelodyRoll notes={backing[line]} sectionLengthBeats={sectionLengthBeats} beatsPerBar={beatsPerBar} />
                </div>
              )
          )}
        </>
      )}

      <div className="record-console">
        {phase === 'idle' && (
          <>
            <div className="chip-row" style={{ justifyContent: 'center' }}>
              <TempoInput value={tempo} onChange={onTempoChange} />
              <QuantizationSelect label={`${partName} quantization`} value={subdivisionsPerBeat} onChange={onSubdivisionsPerBeatChange} />
              {isLine && <QuantizeStrengthSelect value={quantizeStrength} onChange={onQuantizeStrengthChange} />}
              <MetronomeSubdivisionSelect value={metronomeSubdivisionsPerBeat} onChange={onMetronomeSubdivisionsPerBeatChange} />
            </div>
            {isLine && !setsLength && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-soft)' }}>
                <input type="checkbox" checked={hasPickupBar} onChange={(e) => onHasPickupBarChange(e.target.checked)} />
                Pickup measure
              </label>
            )}
            <button className="record-button" onClick={begin} aria-label="Start recording">
              <span className="record-button__glyph" />
            </button>
            <span style={{ color: 'var(--ink-soft)', fontSize: 14, textAlign: 'center', maxWidth: 560 }}>
              {setsLength
                ? `Press Space (or click) -- count-in, then play the ${partName.toLowerCase()}, and press Space again when you're done. This first take sets the section's length -- counted from what you actually play, so there's no need to stop right on the barline.`
                : `Press Space (or click) -- count-in, ${willHavePickup ? 'a pickup bar for any lead-in notes, ' : ''}then the section plays back for ${bars} bar${bars === 1 ? '' : 's'} while you play the ${partName.toLowerCase()}. It stops by itself.`}
            </span>
            <span style={{ color: 'var(--ink-soft)', fontSize: 13, fontStyle: 'italic', textAlign: 'center', maxWidth: 560 }}>{PART_HINTS[part]}</span>
          </>
        )}

        {phase === 'countIn' && <div className="status-pill">Count-in...</div>}

        {phase === 'capturing' && (
          <>
            <div className="record-button-wrap">
              <div className="record-button-ring" />
              {setsLength && (
                <button className="record-button" onClick={stop} aria-label="Stop recording">
                  <span className="record-button__glyph" />
                </button>
              )}
            </div>
            <div className="status-pill">
              {isPickupBar ? `Pickup bar -- Section ${sectionLabel}` : `Recording -- Section ${sectionLabel}, ${partName}`}
            </div>
            {setsLength && bar === null && (
              <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Start whenever you&apos;re ready -- bars before your first note aren&apos;t counted</span>
            )}
            {!isPickupBar && bar >= 1 && (
              <span className="bar-counter" aria-live="off">
                Bar {setsLength ? bar : Math.min(bar, bars)}
                {!setsLength && <span className="bar-counter__of"> of {bars}</span>}
              </span>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minHeight: 40 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{heldNotes.map(midiNoteName).join(' ') || '...'}</span>
              {heldChord && (
                <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, fontSize: 28, color: 'var(--accent-dark)' }}>
                  {formatChordSymbol(heldChord.rootPitchClass, heldChord.quality)}
                </span>
              )}
            </div>
            <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft)', textAlign: 'center' }}>
              {setsLength
                ? "Press Space (or click) when you're done with this section"
                : isPickupBar
                  ? 'Play any lead-in notes now -- the section starts right after this bar'
                  : 'Stops by itself at the end of the section -- press Space to scrap this take and start over'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
