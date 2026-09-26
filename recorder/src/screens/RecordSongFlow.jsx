import { useState } from 'react';
import { PICKUP_BEATS } from '../recordingPipeline.js';
import { appendSectionData, emptyChartData, nextSectionLabel, readChartQuantization, replaceSectionData, sectionChordsAsInternal } from '../songStorage.js';
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
 *   reRecordChords - re-records `sectionIndex`'s chords (and, same as
 *                     this always required live, its melody too -- a
 *                     chord re-take can change the section's length,
 *                     which invalidates melody recorded against the
 *                     old one). Replaces that section in the existing
 *                     chart rather than appending; every later section
 *                     shifts to absorb any length change (see
 *                     songStorage.js's replaceSectionData).
 *   reRecordMelody - re-records just `sectionIndex`'s melody, keeping
 *                     its existing chords/length -- skips straight to
 *                     the melody screen.
 *
 * `sectionIndex` (required in the two re-record modes) picks which
 * section is being replaced -- any section, not just the last one; see
 * songStorage.js's replaceSectionData/entrySectionLabel for how that's
 * done unambiguously even for a section in the middle of the chart.
 *
 * Chords/melody quantization -- and tempo -- are tracked here (not
 * fixed at song setup, see SongSetup.jsx) so they can be changed on
 * the record screens themselves and in every mode, re-record included;
 * a chart read back for addSection/re-record keeps using whatever
 * grid/tempo it was last recorded at (readChartQuantization tolerates
 * an older chart's single shared `quantization` field too). Tempo is
 * changeable up through ChordsReview (where it can still re-derive the
 * chords pass from raw MIDI at the new BPM) but not past it -- see
 * SectionComplete.jsx's docstring for why that's a deliberate boundary,
 * not an oversight.
 */
export default function RecordSongFlow({ mode = 'newSong', baseChartData = null, sectionIndex = null, onCancel, onSaved, saveSong }) {
  const isReplacing = mode === 'reRecordChords' || mode === 'reRecordMelody';
  const targetSection = isReplacing ? baseChartData.sections[sectionIndex] : null;

  const [song, setSong] = useState(() => (baseChartData ? { title: baseChartData.title, key: baseChartData.key, tempo: baseChartData.tempo } : null));
  const [{ chordsQuantization, melodyQuantization, melodyQuantizeStrength, melodyPickupBeats }, setQuantization] = useState(() =>
    baseChartData ? readChartQuantization(baseChartData) : readChartQuantization({})
  );
  const [screen, setScreen] = useState(mode === 'newSong' ? 'setup' : mode === 'reRecordMelody' ? 'recordMelody' : 'recordChords');
  const [chordsResult, setChordsResult] = useState(() =>
    mode === 'reRecordMelody'
      ? { chords: sectionChordsAsInternal(baseChartData, targetSection), sectionLengthBeats: targetSection.end_beat - targetSection.start_beat }
      : null
  );
  const [melodyResult, setMelodyResult] = useState(null);
  // Sections finished earlier *this session* (via "Add Another
  // Section") but not yet folded into the saved chart -- only ever
  // grows in newSong/addSection modes; re-record modes replace
  // exactly one section and save immediately.
  const [completedSections, setCompletedSections] = useState([]);

  const sectionLabel = isReplacing ? targetSection.label : nextSectionLabel((baseChartData?.sections.length ?? 0) + completedSections.length);

  function handleTempoChange(value) {
    setSong((s) => ({ ...s, tempo: value }));
  }

  async function finalize(finalMelodyNotes) {
    const thisSection = {
      sectionLengthBeats: chordsResult.sectionLengthBeats,
      chords: chordsResult.chords,
      melody: finalMelodyNotes,
    };
    let chartData = isReplacing
      ? replaceSectionData(baseChartData, sectionIndex, thisSection)
      : [...completedSections, { sectionLabel, ...thisSection }].reduce(
          (acc, section) => appendSectionData(acc, section),
          baseChartData ?? emptyChartData({ title: song.title, key: song.key, tempo: song.tempo })
        );
    chartData = { ...chartData, tempo: song.tempo, chordsQuantization, melodyQuantization, melodyQuantizeStrength, melodyPickupBeats }; // whatever settings were actually used for this session, even if they differ from what the chart started with
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
        onTempoChange={handleTempoChange}
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
        onTempoChange={handleTempoChange}
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
        onTempoChange={handleTempoChange}
        subdivisionsPerBeat={melodyQuantization}
        onSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, melodyQuantization: value }))}
        quantizeStrength={melodyQuantizeStrength}
        onQuantizeStrengthChange={(value) => setQuantization((q) => ({ ...q, melodyQuantizeStrength: value }))}
        hasPickupBar={melodyPickupBeats > 0}
        onHasPickupBarChange={(checked) => setQuantization((q) => ({ ...q, melodyPickupBeats: checked ? PICKUP_BEATS : 0 }))}
        pickupBeats={melodyPickupBeats}
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
      quantizeStrength={melodyQuantizeStrength}
      onQuantizeStrengthChange={(value) => setQuantization((q) => ({ ...q, melodyQuantizeStrength: value }))}
      pickupBeats={melodyPickupBeats}
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
