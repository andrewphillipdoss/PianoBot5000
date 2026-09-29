import { PART_NAMES, PARTS } from '../parts.js';
import { clipToSectionLength } from '../recordingPipeline.js';
import ChordChart from './ChordChart.jsx';
import MelodyRoll from './MelodyRoll.jsx';
import QuantizationSelect from './QuantizationSelect.jsx';
import QuantizeStrengthSelect from './QuantizeStrengthSelect.jsx';
import TempoInput from './TempoInput.jsx';
import './shared.css';

/**
 * One section's home base: its three parts -- Chords, Melody, Bassline
 * -- side by side, each recordable (and re-recordable) in any order.
 * Whichever is recorded first sets the section's length; everything
 * after plays along with what's already there (see RecordPart.jsx). A
 * part never recorded is simply left out of the song -- nothing to
 * switch on or off ahead of time.
 *
 * Purely presentational: the section itself, and every change to it,
 * lives in RecordSongFlow.jsx. `section.parts[part]` is null or a take
 * -- `{events, rawMessages, ...}` -- where `rawMessages` is null for a
 * part loaded from an already-saved song (nothing left to re-derive
 * from, so its quantization picker is hidden rather than offered and
 * silently doing nothing).
 */
export default function SectionHub({
  title,
  sectionLabel,
  keySignature,
  tempo,
  onTempoChange,
  beatsPerBar,
  section,
  settings,
  onSettingChange,
  isPlaying,
  onPlay,
  onStopPlayback,
  onRecord,
  onClear,
  onLengthChange,
  backLabel,
  onBack,
  onAddSection,
  finalizeLabel,
  canFinalize,
  onFinalize,
}) {
  const { sectionLengthBeats, parts } = section;
  const hasAnyTake = PARTS.some((p) => parts[p]);
  const bars = sectionLengthBeats === null ? null : sectionLengthBeats / beatsPerBar;
  const clip = (events) => (sectionLengthBeats === null ? events : clipToSectionLength(events, sectionLengthBeats));

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <a href="#" className="screen__back" onClick={(e) => { e.preventDefault(); onBack(); }}>&larr; {backLabel}</a>
          <h1 style={{ fontSize: 26, marginTop: 6 }}>{title} &mdash; Section {sectionLabel}</h1>
        </div>
        {hasAnyTake && (
          <button className="btn-ghost" onClick={isPlaying ? onStopPlayback : onPlay}>
            {isPlaying ? '■ Stop' : '▶ Play section'}
          </button>
        )}
      </div>

      <div className="chip-row" style={{ alignItems: 'flex-end' }}>
        <div className="chip">
          <span className="label">Key</span>
          <span className="value">{keySignature}</span>
        </div>
        <div className="chip">
          <span className="label">Section length</span>
          {bars === null ? (
            <span className="value" style={{ color: 'var(--ink-soft)', fontSize: 14 }}>recognized from your first take</span>
          ) : (
            <span className="value" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn-ghost" style={{ padding: '2px 10px' }} aria-label="One bar shorter" disabled={bars <= 1} onClick={() => onLengthChange(-beatsPerBar)}>
                &minus;
              </button>
              {bars} bar{bars === 1 ? '' : 's'}
              <button className="btn-ghost" style={{ padding: '2px 10px' }} aria-label="One bar longer" onClick={() => onLengthChange(beatsPerBar)}>
                +
              </button>
            </span>
          )}
        </div>
        <TempoInput value={tempo} onChange={onTempoChange} />
      </div>

      {!hasAnyTake && (
        <div className="panel" style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
          Start with whichever part you know best -- chords, melody or bassline. How long this section is gets recognized from that first take; everything
          you record after it plays along with what's already there.
        </div>
      )}

      {PARTS.map((part) => {
        const take = parts[part];
        const isLine = part !== 'chords';
        return (
          <div key={part} className="panel part-card" data-part={part}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="panel-label" style={{ marginBottom: 0 }}>
                {PART_NAMES[part]}
                {take && isLine && ` — ${clip(take.events).length} note${clip(take.events).length === 1 ? '' : 's'}`}
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {take && (
                  <button className="btn-ghost" onClick={() => onClear(part)}>
                    Clear
                  </button>
                )}
                <button className={take ? 'btn-ghost' : 'btn-primary'} onClick={() => onRecord(part)}>
                  {take ? 'Re-record' : `● Record ${PART_NAMES[part]}`}
                </button>
              </div>
            </div>

            {take && part === 'chords' && (
              <>
                <ChordChart chords={clip(take.events)} sectionLengthBeats={sectionLengthBeats} beatsPerBar={beatsPerBar} />
                {take.skippedClusterCount > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                    {take.skippedClusterCount} moment{take.skippedClusterCount === 1 ? '' : 's'} in this take didn&apos;t form a recognizable chord (a
                    stray note, or a bit of melody) and {take.skippedClusterCount === 1 ? 'was' : 'were'} left out -- everything else came through.
                  </span>
                )}
              </>
            )}
            {take && isLine && (
              <MelodyRoll notes={clip(take.events)} sectionLengthBeats={sectionLengthBeats} beatsPerBar={beatsPerBar} emptyMessage="No notes came through in this take" />
            )}
            {take?.rawMessages && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <QuantizationSelect
                  label={part === 'chords' ? 'Chord changes snap to' : 'Quantization'}
                  value={settings[`${part}Quantization`]}
                  onChange={(value) => onSettingChange(part, { [`${part}Quantization`]: value })}
                />
                {isLine && (
                  <QuantizeStrengthSelect
                    value={settings[`${part}QuantizeStrength`]}
                    onChange={(value) => onSettingChange(part, { [`${part}QuantizeStrength`]: value })}
                  />
                )}
              </div>
            )}
            {!take && (
              <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                {sectionLengthBeats === null
                  ? 'Not recorded yet.'
                  : `Not recorded yet -- you'll play it along with the ${bars} bar${bars === 1 ? '' : 's'} already here. Leave it empty if this song doesn't need one.`}
              </span>
            )}
          </div>
        );
      })}

      <div className="actions-row">
        <div style={{ display: 'flex', gap: 10 }}>
          {onAddSection && (
            <button className="btn-ghost" disabled={!hasAnyTake} onClick={onAddSection}>
              + Add Another Section
            </button>
          )}
        </div>
        <button className="btn-primary" disabled={!canFinalize} onClick={onFinalize}>
          {finalizeLabel}
        </button>
      </div>
    </div>
  );
}
