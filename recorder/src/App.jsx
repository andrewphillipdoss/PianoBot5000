import MainSongs from './screens/MainSongs.jsx';

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

export default function App() {
  return (
    <MainSongs
      songs={PLACEHOLDER_SONGS}
      onAddSong={() => console.log('add a song (recording flow not built yet)')}
      onOpenSong={(song) => console.log('open song', song)}
    />
  );
}
