import { useEffect, useState } from 'react';
import { useSongPlayback } from '../hooks/useSongPlayback.js';
import { PICKUP_BEATS } from '../recordingPipeline.js';
import { mergeConsecutiveChordEntries, readChartFile } from '../songStorage.js';
import MelodyRoll from './MelodyRoll.jsx';
import './shared.css';

/**
 * Read-only view of one already-recorded song -- reads its chart JSON
 * straight off disk (via the file handle listSongs already handed
 * back in the song summary), so it always reflects whatever's
 * actually saved rather than a stale in-memory copy. Chord Chart plus
 * a simple melody piano-roll -- real lead-sheet notation rendering is
 * a deliberately separate, later piece; see the README.
 */
export default function SongView({ song, onBack, onAddSection, onReRecordChords, onReRecordMelody }) {
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState(null);
  const { isPlaying, play, stop } = useSongPlayback();

  useEffect(() => {
    let cancelled = false;
    setChartData(null);
    setError(null);
    readChartFile(song.fileHandle)
      .then((data) => {
        if (!cancelled) setChartData(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [song]);

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <a href="#" className="screen__back" onClick={(e) => { e.preventDefault(); onBack(); }}>&larr; My Songs</a>
          <h1 style={{ fontSize: 26, marginTop: 6 }}>{chartData ? chartData.title : song.title}</h1>
        </div>
        {chartData && (
          <button className="btn-primary" onClick={() => (isPlaying ? stop() : play(chartData))}>
            {isPlaying ? '■ Stop' : '▶ Play'}
          </button>
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
              <span className="value">{chartData.tempo} bpm</span>
            </div>
            <div className="chip">
              <span className="label">Sections</span>
              <span className="value">{chartData.sections.length}</span>
            </div>
          </div>

          {chartData.sections.map((section, index) => {
            const isLastSection = index === chartData.sections.length - 1;
            const sectionChords = mergeConsecutiveChordEntries(
              chartData.chords.filter((c) => c.beat >= section.start_beat && c.beat < section.end_beat)
            );
            // A pickup note's beat is negative (before the section's
            // own downbeat at start_beat) -- widen the lower bound by
            // one pickup bar so those notes are still included here,
            // not silently excluded just for landing before beat 0.
            const sectionMelody = chartData.melody.filter(
              (n) => n.beat >= section.start_beat - PICKUP_BEATS && n.beat < section.end_beat
            );
            const bars = (section.end_beat - section.start_beat) / 4;

            return (
              <div key={section.label} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <div className="panel">
                  <span className="panel-label">Section {section.label} &mdash; {bars} bars</span>
                  <div className="chord-bar-row">
                    {sectionChords.length === 0 ? (
                      <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>No chords recorded</span>
                    ) : (
                      sectionChords.map((c, i) => (
                        <div key={i} className="chord-bar" style={{ flexGrow: c.duration_beats }}>{c.chord}</div>
                      ))
                    )}
                  </div>
                </div>

                <div className="panel">
                  <span className="panel-label">
                    Section {section.label} melody &mdash; {sectionMelody.length} note{sectionMelody.length === 1 ? '' : 's'}
                  </span>
                  <MelodyRoll notes={sectionMelody} sectionLengthBeats={section.end_beat - section.start_beat} />
                </div>

                {isLastSection ? (
                  <div className="actions-row" style={{ justifyContent: 'flex-start', gap: 10 }}>
                    <button className="btn-ghost" onClick={() => onReRecordChords(chartData)}>Re-record Chords</button>
                    <button className="btn-ghost" onClick={() => onReRecordMelody(chartData)}>Re-record Melody</button>
                  </div>
                ) : (
                  chartData.sections.length > 1 && (
                    <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Only the last section can be re-recorded for now.</span>
                  )
                )}
              </div>
            );
          })}

          <div className="actions-row" style={{ justifyContent: 'flex-start' }}>
            <button className="btn-primary" onClick={() => onAddSection(chartData)}>+ Add Section</button>
          </div>
        </>
      )}
    </div>
  );
}
