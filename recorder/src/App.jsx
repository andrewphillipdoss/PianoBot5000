import { useState } from 'react';
import { MidiProvider } from './hooks/MidiProvider.jsx';
import { useSongLibrary } from './hooks/useSongLibrary.js';
import MainSongs from './screens/MainSongs.jsx';
import MidiTest from './screens/MidiTest.jsx';
import RecordSongFlow from './screens/RecordSongFlow.jsx';
import './screens/shared.css';

const NAV_STYLE = { display: 'flex', gap: 16, padding: '12px 40px 0', fontSize: 13 };

function navLinkStyle(active) {
  return { background: 'none', border: 'none', cursor: 'pointer', color: active ? 'var(--accent-dark)' : 'var(--ink-soft)', fontWeight: active ? 600 : 400 };
}

function LibraryOnboarding({ status, onChooseFolder, onReconnect }) {
  if (status === 'unsupported') {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', padding: 24, textAlign: 'center', color: 'var(--ink-soft)' }}>
        This app needs the File System Access API and Web MIDI, both Chrome-only -- open it in Chrome (or another Chromium-based browser) instead.
      </div>
    );
  }
  if (status === 'checking') {
    return <div style={{ maxWidth: 480, margin: '80px auto', padding: 24, textAlign: 'center', color: 'var(--ink-soft)' }}>Checking for your songs folder...</div>;
  }
  if (status === 'needsPermission') {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ color: 'var(--ink-soft)' }}>Reconnect your songs folder to keep reading/writing your recorded songs.</p>
        <button className="btn-primary" onClick={onReconnect} style={{ alignSelf: 'center' }}>Reconnect songs folder</button>
      </div>
    );
  }
  // needsFolder
  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--ink-soft)' }}>Choose a folder to store your recorded songs as chart files -- the same format the CLI reads.</p>
      <button className="btn-primary" onClick={onChooseFolder} style={{ alignSelf: 'center' }}>Choose songs folder</button>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('songs');
  const library = useSongLibrary();

  return (
    <MidiProvider>
      <div>
        <div style={NAV_STYLE}>
          <button onClick={() => setScreen('songs')} style={navLinkStyle(screen === 'songs')}>My Songs</button>
          <button onClick={() => setScreen('midi-test')} style={navLinkStyle(screen === 'midi-test')}>MIDI Test (dev)</button>
        </div>

        {screen === 'songs' && library.status !== 'ready' && (
          <LibraryOnboarding status={library.status} onChooseFolder={library.chooseFolder} onReconnect={library.reconnectFolder} />
        )}

        {screen === 'songs' && library.status === 'ready' && (
          <MainSongs
            songs={library.songs}
            onAddSong={() => setScreen('addSong')}
            onOpenSong={(song) => console.log('open song (viewing an existing song is not built yet)', song)}
          />
        )}

        {screen === 'addSong' && (
          <RecordSongFlow
            onCancel={() => setScreen('songs')}
            saveSong={library.saveSong}
            onSaved={() => setScreen('songs')}
          />
        )}

        {screen === 'midi-test' && <MidiTest />}
      </div>
    </MidiProvider>
  );
}
