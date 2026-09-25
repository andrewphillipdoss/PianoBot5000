import { useState } from 'react';
import { appendSectionData, emptyChartData, nextSectionLabel, readChartQuantization, replaceLastSectionData, sectionChordsAsInternal } from '../songStorage.js';
import ChordsReview from './ChordsReview.jsx';
import RecordChords from './RecordChords.jsx';
import RecordMelody from './RecordMelody.jsx';
import SectionComplete from './SectionComplete.jsx';
import SongSetup from './SongSetup.jsx';

/**
 * The whole record-a-song wizard: setup once (skipped when adding to
 * or editing an existing song), then chords -> review -> melody ->
 * section complete -> either "Add Another Section" (loop back for the
 * next one) or save. One component owns all of it (rather than a
 * router) because this genuinely is a linear, guided flow, not free
 * navigation between independent pages.
 *
 * Four modes, all going through the exact same screens:
 *   newSong        - baseChartData is null; starts at setup; each
 *                     finished section builds up from an empty chart.
 *   addSection     - baseChartData is an already-saved song; starts
 *                     recording its next section (skips setup); builds
 *                     up from that existing chart instead of empty.
 *   reRecordChords - re-records the *last* section's chords (and,
 *                     same as this always required live, its melody
 *                     too -- a chord re-take can change the section's
 *                     length, which invalidates melody recorded
 *                     against the old one). Replaces that section in
 *                     the existing chart rather than appending.
 *   reRecordMelody - re-records just the last section's melody,
 *                     keeping its existing chords/length -- skips
 *                     straight to the melody screen.
 *
 * Only the *last* section can be re-recorded (see songStorage.js's
 * replaceLastSectionData for why); "addSection"/multi-section-in-one-
 * sitting have no such restriction since they only ever add on.
 *
 * Chords/melody quantization are tracked here (not per-song-setup --
 * see SongSetup.jsx) so they can be changed on the record screens
 * themselves and in every mode, re-record included; a chart read back
 * for addSection/re-record keeps using whatever grid it was last
 * recorded at (readChartQuantization tolerates an older chart's single
 * shared `quantization` field too).
 */
export default function RecordSongFlow({ mode = 'newSong', baseChartData = null, onCancel, onSaved, saveSong }) {
  const isReplacing = mode === 'reRecordChords' || mode === 'reRecordMelody';
  const lastSection = baseChartData?.sections.at(-1) ?? null;

  const [song, setSong] = useState(() => (baseChartData ? { title: baseChartData.title, key: baseChartData.key, tempo: baseChartData.tempo } : null));
  const [{ chordsQuantization, melodyQuantization }, setQuantization] = useState(() =>
    baseChartData ? readChartQuantization(baseChartData) : readChartQuantization({})
  );
  const [screen, setScreen] = useState(mode === 'newSong' ? 'setup' : mode === 'reRecordMelody' ? 'recordMelody' : 'recordChords');
  const [chordsResult, setChordsResult] = useState(() =>
    mode === 'reRecordMelody'
      ? { chords: sectionChordsAsInternal(baseChartData, lastSection), sectionLengthBeats: lastSection.end_beat - lastSection.start_beat }
      : null
  );
  const [melodyResult, setMelodyResult] = useState(null);
  // Sections finished earlier *this session* (via "Add Another
  // Section") but not yet folded into the saved chart -- only ever
  // grows in newSong/addSection modes; re-record modes replace
  // exactly one section and save immediately.
  const [completedSections, setCompletedSections] = useState([]);

  const sectionLabel = isReplacing ? lastSection.label : nextSectionLabel((baseChartData?.sections.length ?? 0) + completedSections.length);

  async function finalize(finalMelodyNotes) {
    const thisSection = {
      sectionLabel,
      sectionLengthBeats: chordsResult.sectionLengthBeats,
      chords: chordsResult.chords,
      melody: finalMelodyNotes,
    };
    let chartData = isReplacing
      ? replaceLastSectionData(baseChartData, thisSection)
      : [...completedSections, thisSection].reduce(
          (acc, section) => appendSectionData(acc, section),
          baseChartData ?? emptyChartData({ title: song.title, key: song.key, tempo: song.tempo })
        );
    chartData = { ...chartData, chordsQuantization, melodyQuantization }; // whatever grid was actually used for this session, even if it differs from what the chart started with
    const savedSummary = await saveSong(chartData);
    onSaved(savedSummary);
  }

  if (screen === 'setup') {
    return (
      <SongSetup
        onBack={onCancel}
        onSubmit={(submittedSong) => {
          setSong(submittedSong);
          setScreen('recordChords');
        }}
      />
    );
  }

  if (screen === 'recordChords') {
    return (
      <RecordChords
        title={song.title}
        sectionLabel={sectionLabel}
        tempo={song.tempo}
        subdivisionsPerBeat={chordsQuantization}
        onSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, chordsQuantization: value }))}
        onBack={mode === 'newSong' && completedSections.length === 0 ? () => setScreen('setup') : onCancel}
        onDone={(result) => {
          setChordsResult(result);
          setScreen('chordsReview');
        }}
      />
    );
  }

  if (screen === 'chordsReview') {
    return (
      <ChordsReview
        title={song.title}
        sectionLabel={sectionLabel}
        tempo={song.tempo}
        keySignature={song.key}
        chordsResult={chordsResult}
        subdivisionsPerBeat={chordsQuantization}
        onSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, chordsQuantization: value }))}
        onReRecord={() => {
          setChordsResult(null);
          setScreen('recordChords');
        }}
        onProceed={({ chords, sectionLengthBeats }) => {
          setChordsResult({ ...chordsResult, chords, sectionLengthBeats });
          setScreen('recordMelody');
        }}
      />
    );
  }

  if (screen === 'recordMelody') {
    return (
      <RecordMelody
        title={song.title}
        sectionLabel={sectionLabel}
        tempo={song.tempo}
        subdivisionsPerBeat={melodyQuantization}
        onSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, melodyQuantization: value }))}
        chordsResult={chordsResult}
        onBack={mode === 'reRecordMelody' ? onCancel : () => setScreen('chordsReview')}
        onDone={(result) => {
          setMelodyResult(result);
          setScreen('sectionComplete');
        }}
      />
    );
  }

  // screen === 'sectionComplete'
  return (
    <SectionComplete
      title={song.title}
      sectionLabel={sectionLabel}
      tempo={song.tempo}
      keySignature={song.key}
      chordsResult={chordsResult}
      melodyResult={melodyResult}
      subdivisionsPerBeat={melodyQuantization}
      onSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, melodyQuantization: value }))}
      finalizeLabel={mode === 'newSong' || mode === 'addSection' ? 'Finalize Song' : 'Save Changes'}
      onReRecordChords={
        mode === 'reRecordMelody'
          ? undefined // this mode never touched chords -- re-recording them would need the chordsReview/length-adjust step this mode skipped
          : () => {
              setChordsResult(null);
              setMelodyResult(null); // recorded against the old chords' length/playback -- invalidated too
              setScreen('recordChords');
            }
      }
      onReRecordMelody={() => {
        setMelodyResult(null);
        setScreen('recordMelody');
      }}
      onAddSection={
        isReplacing
          ? undefined // re-record modes replace exactly one section and save -- add a section as its own, separate action afterward
          : (notes) => {
              setCompletedSections((prev) => [...prev, { sectionLabel, sectionLengthBeats: chordsResult.sectionLengthBeats, chords: chordsResult.chords, melody: notes }]);
              setChordsResult(null);
              setMelodyResult(null);
              setScreen('recordChords');
            }
      }
      onFinalize={(notes) => finalize(notes)}
    />
  );
}
