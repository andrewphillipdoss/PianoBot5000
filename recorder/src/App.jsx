import { useState } from 'react';
import MainSongs from './screens/MainSongs.jsx';
import MidiTest from './screens/MidiTest.jsx';

// Placeholder data matching the design wireframe, until real song
// storage (via the File System Access API) is wired up -- see
// recorder/README.md for the build sequence this is the first step of.
const PLACEHOLDER_SONGS = [
  { title: "The Blood Will Never Lose Its Power", key: 'Ab', tempo: 72, sectionLabels: ['A', 'B'], updatedAt: '2 days ago' },
  { title: 'Hallelujah', key: 'C', tempo: 68, sectionLabels: ['A', 'B', 'C'], updatedAt: '5 days ago' },
  { title: 'Amazing Grace', key: 'C', tempo: 76, sectionLabels: ['A'], updatedAt: '1 week ago' },
  { title: 'Auld Lang Syne', key: 'G', tempo: 100, sectionLabels: ['A', 'B'], updatedAt: '2 weeks ago' },
  { title: "Why Can't We Be Friends?", key: 'Bb', tempo: 96, sectionLabels: ['A'], updatedAt: '3 weeks ago' },
  { title: 'Georgia on My Mind', key: 'G', tempo: 66, sectionLabels: ['A (chords only)'], updatedAt: '1 month ago' },
];

// Temporary until real routing/screens exist -- lets the MIDI
// diagnostic screen be reached without losing the "My Songs" screen.
export default function App() {
  const [screen, setScreen] = useState('songs');

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, padding: '12px 40px 0', fontSize: 13 }}>
        <button onClick={() => setScreen('songs')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: screen === 'songs' ? 'var(--accent-dark)' : 'var(--ink-soft)', fontWeight: screen === 'songs' ? 600 : 400 }}>
          My Songs
        </button>
        <button onClick={() => setScreen('midi-test')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: screen === 'midi-test' ? 'var(--accent-dark)' : 'var(--ink-soft)', fontWeight: screen === 'midi-test' ? 600 : 400 }}>
          MIDI Test (dev)
        </button>
      </div>

      {screen === 'songs' && (
        <MainSongs
          songs={PLACEHOLDER_SONGS}
          onAddSong={() => setScreen('midi-test')}
          onOpenSong={(song) => console.log('open song', song)}
        />
      )}
      {screen === 'midi-test' && <MidiTest />}
    </div>
  );
}
