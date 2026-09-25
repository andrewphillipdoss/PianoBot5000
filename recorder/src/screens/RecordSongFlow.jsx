import { useState } from 'react';
import { buildChartData } from '../songStorage.js';
import ChordsReview from './ChordsReview.jsx';
import RecordChords from './RecordChords.jsx';
import RecordMelody from './RecordMelody.jsx';
import SectionComplete from './SectionComplete.jsx';
import SongSetup from './SongSetup.jsx';

// Single-section songs only for now -- multi-section support (the
// "Song with N Sections" view, "+ Add Section") is a deliberately
// separate, later pass; see the design discussion.
const SECTION_LABEL = 'A';

/**
 * The whole record-a-song wizard: setup once, then chords -> review
 * -> melody -> section complete -> save. One component owns all of
 * it (rather than a router) because this genuinely is a linear,
 * guided flow, not free navigation between independent pages.
 */
export default function RecordSongFlow({ onCancel, onSaved, saveSong }) {
  const [song, setSong] = useState(null); // { title, key, tempo }
  const [screen, setScreen] = useState('setup');
  const [chordsResult, setChordsResult] = useState(null);
  const [melodyResult, setMelodyResult] = useState(null);

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
        sectionLabel={SECTION_LABEL}
        tempo={song.tempo}
        onBack={() => setScreen('setup')}
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
        sectionLabel={SECTION_LABEL}
        keySignature={song.key}
        chordsResult={chordsResult}
        onReRecord={() => {
          setChordsResult(null);
          setScreen('recordChords');
        }}
        onProceed={(sectionLengthBeats) => {
          setChordsResult((prev) => ({ ...prev, sectionLengthBeats }));
          setScreen('recordMelody');
        }}
      />
    );
  }

  if (screen === 'recordMelody') {
    return (
      <RecordMelody
        title={song.title}
        sectionLabel={SECTION_LABEL}
        tempo={song.tempo}
        chordsResult={chordsResult}
        onBack={() => setScreen('chordsReview')}
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
      sectionLabel={SECTION_LABEL}
      keySignature={song.key}
      chordsResult={chordsResult}
      melodyResult={melodyResult}
      onReRecordChords={() => {
        setChordsResult(null);
        setMelodyResult(null); // recorded against the old chords' length/playback -- invalidated too
        setScreen('recordChords');
      }}
      onReRecordMelody={() => {
        setMelodyResult(null);
        setScreen('recordMelody');
      }}
      onFinalize={async () => {
        const chartData = buildChartData({
          title: song.title,
          key: song.key,
          tempo: song.tempo,
          sectionLabel: SECTION_LABEL,
          sectionLengthBeats: chordsResult.sectionLengthBeats,
          chords: chordsResult.chords,
          melody: melodyResult.notes,
        });
        await saveSong(chartData);
        onSaved();
      }}
    />
  );
}
