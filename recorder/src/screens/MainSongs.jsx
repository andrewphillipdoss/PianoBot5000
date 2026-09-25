import './MainSongs.css';

/**
 * The song library screen: every recorded song, and the entry point
 * into recording a new one. `songs` is plain data (see shape below) --
 * this component doesn't know or care whether it came from a real
 * chart-file directory (via the File System Access API, once that's
 * wired up) or a placeholder array.
 *
 * Expected song shape: { title, key, tempo, sectionLabels: string[],
 * updatedAt: string (already formatted for display) }.
 */
export default function MainSongs({ songs, onAddSong, onOpenSong }) {
  return (
    <div className="main-songs">
      <div className="main-songs__header">
        <div>
          <h1 className="main-songs__title">My Songs</h1>
          <div className="main-songs__subtitle">Songs you've recorded off the piano, in three fluency keys each.</div>
        </div>
        <button className="add-song-btn" onClick={onAddSong}>+ Add a Song</button>
      </div>

      <div className="song-table">
        <div className="song-table__head">
          <span>Title</span>
          <span>Key</span>
          <span>Tempo</span>
          <span>Sections</span>
          <span>Last edited</span>
        </div>
        <div className="song-table__body">
          {songs.length === 0 ? (
            <div className="main-songs__empty">No songs recorded yet -- hit "+ Add a Song" to record your first one.</div>
          ) : (
            songs.map((song) => (
              <button key={song.title} className="song-row" onClick={() => onOpenSong(song)}>
                <span className="song-row__title">{song.title}</span>
                <span className="song-row__meta">{song.key}</span>
                <span className="song-row__meta">{song.tempo} bpm</span>
                <span className="song-row__meta">{song.sectionLabels.join(', ')}</span>
                <span className="song-row__date">{song.updatedAt}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
