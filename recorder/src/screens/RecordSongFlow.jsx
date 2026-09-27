import { useState } from 'react';
import {
  appendSectionData,
  emptyChartData,
  nextSectionLabel,
  readChartBeatsPerBar,
  readChartQuantization,
  replaceSectionData,
  sectionBasslineAsInternal,
  sectionChordsAsInternal,
  sectionMelodyAsInternal,
} from '../songStorage.js';
import ChordsReview from './ChordsReview.jsx';
import RecordBassline from './RecordBassline.jsx';
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
 * Five modes, all going through the exact same screens:
 *   newSong          - baseChartData is null; starts at setup; each
 *                       finished section builds up from an empty chart.
 *   addSection       - baseChartData is an already-saved song; starts
 *                       recording its next section (skips setup); builds
 *                       up from that existing chart instead of empty.
 *   reRecordChords   - re-records `sectionIndex`'s chords (and, same as
 *                       this always required live, its melody -- and
 *                       bassline, if the song has one -- too: a chord
 *                       re-take can change the section's length, which
 *                       invalidates anything recorded against the old
 *                       one). Replaces that section in the existing
 *                       chart rather than appending; every later section
 *                       shifts to absorb any length change (see
 *                       songStorage.js's replaceSectionData).
 *   reRecordMelody   - re-records just `sectionIndex`'s melody, keeping
 *                       its existing chords/length *and bassline*
 *                       (unaffected by a melody-only re-take) -- skips
 *                       straight to the melody screen.
 *   reRecordBassline - re-records just `sectionIndex`'s bassline,
 *                       keeping its existing chords *and melody* --
 *                       skips straight to the bassline screen. Only
 *                       ever offered for a song that has one at all.
 *
 * `sectionIndex` (required in the three re-record modes) picks which
 * section is being replaced -- any section, not just the last one; see
 * songStorage.js's replaceSectionData/entrySectionLabel for how that's
 * done unambiguously even for a section in the middle of the chart.
 *
 * The bassline pass itself is optional per song (`song.hasBassline`,
 * set at SongSetup) and, when present, can be ordered either before or
 * after the melody pass (`song.basslineFirst`) -- see RecordBassline.jsx
 * for why that ordering is the only real choice available (the chords
 * pass stays authoritative for the section's length either way).
 *
 * Chords/melody/bassline quantization -- and tempo -- are tracked here
 * (not fixed at song setup, see SongSetup.jsx) so they can be changed on
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
  const isReplacing = mode === 'reRecordChords' || mode === 'reRecordMelody' || mode === 'reRecordBassline';
  const targetSection = isReplacing ? baseChartData.sections[sectionIndex] : null;

  const [song, setSong] = useState(() =>
    baseChartData
      ? {
          title: baseChartData.title,
          key: baseChartData.key,
          tempo: baseChartData.tempo,
          beatsPerBar: readChartBeatsPerBar(baseChartData),
          hasBassline: readChartQuantization(baseChartData).hasBassline,
          basslineFirst: readChartQuantization(baseChartData).basslineFirst,
        }
      : null
  );
  const [
    { chordsQuantization, melodyQuantization, melodyQuantizeStrength, melodyPickupBeats, basslineQuantization, basslineQuantizeStrength, basslinePickupBeats },
    setQuantization,
  ] = useState(() => (baseChartData ? readChartQuantization(baseChartData) : readChartQuantization({})));
  const [screen, setScreen] = useState(
    mode === 'newSong' ? 'setup' : mode === 'reRecordMelody' ? 'recordMelody' : mode === 'reRecordBassline' ? 'recordBassline' : 'recordChords'
  );
  const [chordsResult, setChordsResult] = useState(() =>
    mode === 'reRecordMelody' || mode === 'reRecordBassline'
      ? { chords: sectionChordsAsInternal(baseChartData, targetSection), sectionLengthBeats: targetSection.end_beat - targetSection.start_beat }
      : null
  );
  const [melodyResult, setMelodyResult] = useState(() =>
    mode === 'reRecordBassline' ? { notes: sectionMelodyAsInternal(baseChartData, targetSection) } : null // preserved unchanged -- only bassline is being re-taken
  );
  const [basslineResult, setBasslineResult] = useState(() =>
    mode === 'reRecordMelody' && song?.hasBassline ? { notes: sectionBasslineAsInternal(baseChartData, targetSection) } : null // preserved unchanged -- only melody is being re-taken
  );
  // Sections finished earlier *this session* (via "Add Another
  // Section") but not yet folded into the saved chart -- only ever
  // grows in newSong/addSection modes; re-record modes replace
  // exactly one section and save immediately.
  const [completedSections, setCompletedSections] = useState([]);

  const sectionLabel = isReplacing ? targetSection.label : nextSectionLabel((baseChartData?.sections.length ?? 0) + completedSections.length);
  // Whether *this* recording session still needs a fresh bassline take
  // at some point -- true for every mode except reRecordMelody (which
  // preserves the existing bassline untouched) and reRecordChords/
  // newSong/addSection once one's already been captured this session.
  const needsFreshBassline = Boolean(song?.hasBassline) && mode !== 'reRecordMelody';

  function handleTempoChange(value) {
    setSong((s) => ({ ...s, tempo: value }));
  }

  async function finalize({ melody: finalMelodyNotes, bassline: finalBasslineNotes }) {
    const thisSection = {
      sectionLengthBeats: chordsResult.sectionLengthBeats,
      chords: chordsResult.chords,
      melody: finalMelodyNotes,
      bassline: finalBasslineNotes,
    };
    let chartData = isReplacing
      ? replaceSectionData(baseChartData, sectionIndex, thisSection)
      : [...completedSections, { sectionLabel, ...thisSection }].reduce(
          (acc, section) => appendSectionData(acc, section),
          baseChartData ?? emptyChartData({ title: song.title, key: song.key, tempo: song.tempo, hasBassline: song.hasBassline, basslineFirst: song.basslineFirst })
        );
    chartData = {
      ...chartData,
      tempo: song.tempo,
      beatsPerBar: song.beatsPerBar,
      chordsQuantization,
      melodyQuantization,
      melodyQuantizeStrength,
      melodyPickupBeats,
      hasBassline: song.hasBassline,
      basslineFirst: song.basslineFirst,
      basslineQuantization,
      basslineQuantizeStrength,
      basslinePickupBeats,
    }; // whatever settings were actually used for this session, even if they differ from what the chart started with
    const savedSummary = await saveSong(chartData);
    onSaved(savedSummary);
  }

  if (screen === 'setup') {
    return (
      <SongSetup
        initial={song}
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
        // useRecordingSession only ever reads tempo/subdivisionsPerBeat/
        // beatsPerBar once, at construction (see its own docstring) --
        // without a key, changing one of these on this idle screen would
        // update the *displayed* value here and in the saved chart, but
        // silently leave the actual upcoming take using whatever was set
        // when this screen first mounted. Keying on all three forces a
        // fresh mount (and a fresh RecordingSession) the moment any of
        // them changes, while the player is still on the idle screen.
        key={`${chordsQuantization}-${song.tempo}-${song.beatsPerBar}`}
        title={song.title}
        sectionLabel={sectionLabel}
        tempo={song.tempo}
        onTempoChange={handleTempoChange}
        subdivisionsPerBeat={chordsQuantization}
        onSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, chordsQuantization: value }))}
        beatsPerBar={song.beatsPerBar}
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
        beatsPerBar={song.beatsPerBar}
        onReRecord={() => {
          setChordsResult(null);
          setScreen('recordChords');
        }}
        onProceed={({ chords, sectionLengthBeats }) => {
          setChordsResult({ ...chordsResult, chords, sectionLengthBeats });
          setScreen(needsFreshBassline && song.basslineFirst ? 'recordBassline' : 'recordMelody');
        }}
      />
    );
  }

  if (screen === 'recordBassline') {
    return (
      <RecordBassline
        // Same reasoning as RecordChords'/RecordMelody's own key above.
        key={`${basslineQuantization}-${basslineQuantizeStrength}-${basslinePickupBeats}-${song.tempo}-${song.beatsPerBar}`}
        title={song.title}
        sectionLabel={sectionLabel}
        tempo={song.tempo}
        onTempoChange={handleTempoChange}
        subdivisionsPerBeat={basslineQuantization}
        onSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, basslineQuantization: value }))}
        quantizeStrength={basslineQuantizeStrength}
        onQuantizeStrengthChange={(value) => setQuantization((q) => ({ ...q, basslineQuantizeStrength: value }))}
        hasPickupBar={basslinePickupBeats > 0}
        onHasPickupBarChange={(checked) => setQuantization((q) => ({ ...q, basslinePickupBeats: checked ? song.beatsPerBar : 0 }))}
        pickupBeats={basslinePickupBeats}
        beatsPerBar={song.beatsPerBar}
        chordsResult={chordsResult}
        onBack={mode === 'reRecordBassline' ? onCancel : () => setScreen('chordsReview')}
        onDone={(result) => {
          setBasslineResult(result);
          // Reached before melody (basslineFirst) -> melody's still ahead;
          // reached via reRecordBassline -> melody was already preserved
          // (melodyResult set from the start) -- either way, "melody
          // already done" is exactly the signal for which one's next.
          setScreen(melodyResult ? 'sectionComplete' : 'recordMelody');
        }}
      />
    );
  }

  if (screen === 'recordMelody') {
    return (
      <RecordMelody
        // Same reasoning as RecordChords' key above -- useRecordingSession
        // only reads these once, at construction.
        key={`${melodyQuantization}-${melodyQuantizeStrength}-${melodyPickupBeats}-${song.tempo}-${song.beatsPerBar}`}
        title={song.title}
        sectionLabel={sectionLabel}
        tempo={song.tempo}
        onTempoChange={handleTempoChange}
        subdivisionsPerBeat={melodyQuantization}
        onSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, melodyQuantization: value }))}
        quantizeStrength={melodyQuantizeStrength}
        onQuantizeStrengthChange={(value) => setQuantization((q) => ({ ...q, melodyQuantizeStrength: value }))}
        hasPickupBar={melodyPickupBeats > 0}
        onHasPickupBarChange={(checked) => setQuantization((q) => ({ ...q, melodyPickupBeats: checked ? song.beatsPerBar : 0 }))}
        pickupBeats={melodyPickupBeats}
        beatsPerBar={song.beatsPerBar}
        chordsResult={chordsResult}
        onBack={mode === 'reRecordMelody' ? onCancel : () => setScreen('chordsReview')}
        onDone={(result) => {
          setMelodyResult(result);
          // basslineResult is already set by now if this song records
          // bassline *before* melody (or if it's being preserved
          // unchanged) -- only actually still null when a fresh
          // bassline take genuinely comes next.
          setScreen(needsFreshBassline && basslineResult === null ? 'recordBassline' : 'sectionComplete');
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
      basslineResult={basslineResult}
      basslineSubdivisionsPerBeat={basslineQuantization}
      onBasslineSubdivisionsPerBeatChange={(value) => setQuantization((q) => ({ ...q, basslineQuantization: value }))}
      basslineQuantizeStrength={basslineQuantizeStrength}
      onBasslineQuantizeStrengthChange={(value) => setQuantization((q) => ({ ...q, basslineQuantizeStrength: value }))}
      basslinePickupBeats={basslinePickupBeats}
      beatsPerBar={song.beatsPerBar}
      finalizeLabel={mode === 'newSong' || mode === 'addSection' ? 'Finalize Song' : 'Save Changes'}
      onReRecordChords={
        mode === 'reRecordMelody' || mode === 'reRecordBassline'
          ? undefined // these modes never touched chords -- re-recording them would need the chordsReview/length-adjust step they skipped
          : () => {
              setChordsResult(null);
              setMelodyResult(null); // recorded against the old chords' length/playback -- invalidated too
              setBasslineResult(null); // same reasoning, if this song has one
              setScreen('recordChords');
            }
      }
      onReRecordMelody={() => {
        setMelodyResult(null);
        setScreen('recordMelody');
      }}
      onReRecordBassline={() => {
        setBasslineResult(null);
        setScreen('recordBassline');
      }}
      onAddSection={
        isReplacing
          ? undefined // re-record modes replace exactly one section and save -- add a section as its own, separate action afterward
          : ({ melody, bassline }) => {
              setCompletedSections((prev) => [...prev, { sectionLabel, sectionLengthBeats: chordsResult.sectionLengthBeats, chords: chordsResult.chords, melody, bassline }]);
              setChordsResult(null);
              setMelodyResult(null);
              setBasslineResult(null);
              setScreen('recordChords');
            }
      }
      onFinalize={finalize}
    />
  );
}
