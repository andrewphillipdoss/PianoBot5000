import { useEffect, useState } from 'react';
import { useSongPlayback } from '../hooks/useSongPlayback.js';
import {
  entrySectionLabel,
  readChartBeatsPerBar,
  readChartFile,
  readChartQuantization,
  requantizeChartData,
  sectionChordsAsInternal,
  writeChartToHandle,
} from '../songStorage.js';
import { mergeConsecutiveChords } from '../theory.js';
import ChordChart from './ChordChart.jsx';
import MelodyRoll from './MelodyRoll.jsx';
import QuantizationSelect from './QuantizationSelect.jsx';
import TimeSignatureSelect from './TimeSignatureSelect.jsx';
import './shared.css';

/**
 * Read-only view of one already-recorded song -- reads its chart JSON
 * straight off disk (via the file handle listSongs already handed
 * back in the song summary), so it always reflects whatever's
 * actually saved rather than a stale in-memory copy. Chord Chart plus
 * a simple melody piano-roll -- real lead-sheet notation rendering is
 * a deliberately separate, later piece; see the README.
 */
export default function SongView({ song, onBack, onAddSection, onEditSection, onDelete }) {
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState(null);
  const [metronome, setMetronome] = useState(false); // off by default -- this is "hear the song," not a take; on by request, e.g. to follow along precisely
  const [tempoInput, setTempoInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { isPlaying, play, stop } = useSongPlayback();

  // Permanent, no undo -- a native confirm() is a deliberately hard-to-
  // misclick extra step, not just a styled button, for a destructive
  // action this app has no way to reverse.
  async function handleDelete() {
    if (!window.confirm(`Delete "${chartData.title}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      setDeleting(false);
      setError(err);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setChartData(null);
    setError(null);
    readChartFile(song.fileHandle)
      .then((data) => {
        if (!cancelled) {
          setChartData(data);
          setTempoInput(String(data.tempo));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [song]);

  // No raw MIDI is kept once a song is saved, so changing quantization
  // here can only re-snap the already-quantized beats/durations already
  // on disk (requantizeChartData) -- there's nothing to re-derive from.
  // Saved straight back to the exact file this song was opened from,
  // same as any other edit made from this screen.
  async function handleQuantizationChange(partial) {
    const requantized = requantizeChartData(chartData, { ...readChartQuantization(chartData), ...partial });
    setChartData(requantized);
    try {
      await writeChartToHandle(song.fileHandle, requantized);
    } catch (err) {
      setError(err);
    }
  }

  // Tempo, unlike quantization, needs no re-derivation at all: every
  // chord/melody beat is already stored in beats, not seconds, so
  // changing it only changes future playback speed -- the recorded
  // data itself is tempo-independent and untouched.
  async function commitTempoChange() {
    const value = Number(tempoInput);
    if (!Number.isFinite(value) || value <= 0 || value === chartData.tempo) {
      setTempoInput(String(chartData.tempo)); // not a valid/changed value -- revert the input rather than save garbage
      return;
    }
    const updated = { ...chartData, tempo: value };
    setChartData(updated);
    try {
      await writeChartToHandle(song.fileHandle, updated);
    } catch (err) {
      setError(err);
    }
  }

  // Same reasoning as tempo -- section start/end beats are already
  // fixed, so this only changes how many "bars" they're displayed as
  // and the count-in/pickup-bar length for any future recording in
  // this song, never the already-saved chord/melody positions.
  async function handleBeatsPerBarChange(value) {
    const updated = { ...chartData, beatsPerBar: value };
    setChartData(updated);
    try {
      await writeChartToHandle(song.fileHandle, updated);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <a href="#" className="screen__back" onClick={(e) => { e.preventDefault(); onBack(); }}>&larr; My Songs</a>
          <h1 style={{ fontSize: 26, marginTop: 6 }}>{chartData ? chartData.title : song.title}</h1>
        </div>
        {chartData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-soft)' }}>
              <input type="checkbox" checked={metronome} onChange={(e) => setMetronome(e.target.checked)} disabled={isPlaying} />
              Metronome
            </label>
            <button className="btn-primary" onClick={() => (isPlaying ? stop() : play(chartData, { metronome }))}>
              {isPlaying ? '■ Stop' : '▶ Play'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--live)', color: 'var(--live)' }}>
          Couldn't read this song's file -- {error.message}
        </div>
      )}

      {!chartData && !error && <span style={{ color: 'var(--ink-soft)' }}>Loading...</span>}

      {chartData && (
        <>
          <div className="chip-row">
            <div className="chip">
              <span className="label">Key</span>
              <span className="value">{chartData.key}</span>
            </div>
            <div className="chip">
              <span className="label">Tempo</span>
              <span className="value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <input
                  type="number"
                  value={tempoInput}
                  onChange={(e) => setTempoInput(e.target.value)}
                  onBlur={commitTempoChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.target.blur();
                  }}
                  style={{ width: 52, fontSize: 18, fontWeight: 600, fontFamily: 'inherit', border: 'none', borderBottom: '1px solid var(--line)', background: 'transparent', padding: 0, color: 'inherit' }}
                />
                bpm
              </span>
            </div>
            <div className="chip">
              <span className="label">Sections</span>
              <span className="value">{chartData.sections.length}</span>
            </div>
            <TimeSignatureSelect value={readChartBeatsPerBar(chartData)} onChange={handleBeatsPerBarChange} />
            <QuantizationSelect
              label="Chords quantization"
              value={readChartQuantization(chartData).chordsQuantization}
              onChange={(value) => handleQuantizationChange({ chordsQuantization: value })}
            />
            <QuantizationSelect
              label="Melody quantization"
              value={readChartQuantization(chartData).melodyQuantization}
              onChange={(value) => handleQuantizationChange({ melodyQuantization: value })}
            />
            {(chartData.bassline ?? []).length > 0 && (
              <QuantizationSelect
                label="Bassline quantization"
                value={readChartQuantization(chartData).basslineQuantization}
                onChange={(value) => handleQuantizationChange({ basslineQuantization: value })}
              />
            )}
          </div>

          {chartData.sections.map((section, index) => {
            const beatsPerBar = readChartBeatsPerBar(chartData);
            // Merged at view time too, so a chart saved before chords
            // were merged at record time still reads cleanly.
            const sectionChords = mergeConsecutiveChords(sectionChordsAsInternal(chartData, section));
            // Rebased to section-relative beats -- every entry's `beat` is
            // on the chart's one shared *global* timeline (see
            // appendSectionData), but MelodyRoll expects beats relative
            // to this section's own downbeat (0 = this section's start,
            // negative = its own pickup notes). Section A's start_beat
            // happens to be 0, which is exactly why this only ever broke
            // visibly for a later section -- global and section-relative
            // coordinates are identical there by coincidence.
            const sectionMelody = chartData.melody
              .filter((n) => entrySectionLabel(n, chartData.sections) === section.label)
              .map((n) => ({ ...n, beat: n.beat - section.start_beat }));
            const sectionBassline = (chartData.bassline ?? [])
              .filter((n) => entrySectionLabel(n, chartData.sections) === section.label)
              .map((n) => ({ ...n, beat: n.beat - section.start_beat }));
            const bars = (section.end_beat - section.start_beat) / beatsPerBar;

            return (
              <div key={section.label} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <div className="panel">
                  <span className="panel-label">Section {section.label} &mdash; {bars} bars</span>
                  {/* No chords at all -> say so, rather than draw a grid of empty bars. */}
                  <ChordChart chords={sectionChords} sectionLengthBeats={sectionChords.length > 0 ? section.end_beat - section.start_beat : null} beatsPerBar={beatsPerBar} />
                </div>

                {sectionMelody.length > 0 && (
                  <div className="panel">
                    <span className="panel-label">
                      Section {section.label} melody &mdash; {sectionMelody.length} note{sectionMelody.length === 1 ? '' : 's'}
                    </span>
                    <MelodyRoll notes={sectionMelody} sectionLengthBeats={section.end_beat - section.start_beat} beatsPerBar={beatsPerBar} />
                  </div>
                )}

                {sectionBassline.length > 0 && (
                  <div className="panel">
                    <span className="panel-label">
                      Section {section.label} bassline &mdash; {sectionBassline.length} note{sectionBassline.length === 1 ? '' : 's'}
                    </span>
                    <MelodyRoll notes={sectionBassline} sectionLengthBeats={section.end_beat - section.start_beat} beatsPerBar={beatsPerBar} />
                  </div>
                )}

                <div className="actions-row" style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <button className="btn-ghost" onClick={() => onEditSection(chartData, index)}>Edit Section {section.label}</button>
                </div>
              </div>
            );
          })}

          <div className="actions-row">
            <button className="btn-primary" onClick={() => onAddSection(chartData)}>+ Add Section</button>
            <button className="btn-ghost" style={{ color: 'var(--live)', borderColor: 'var(--live)' }} onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete Song'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
