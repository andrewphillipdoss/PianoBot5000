import { useCallback, useEffect, useState } from 'react';
import {
  chartFileName,
  getPersistedDirectoryHandle,
  hasReadWritePermission,
  isFileSystemAccessSupported,
  listSongs,
  pickSongsDirectory,
  requestReadWritePermission,
  writeChartFile,
} from '../songStorage.js';

/**
 * Owns the songs folder (pick it, remember it across reloads, verify
 * permission) and the list of songs in it. `status` drives which
 * onboarding state the UI shows:
 *
 *   unsupported    - not Chrome; nothing else here will work
 *   checking       - initial permission check in flight
 *   needsFolder    - no folder has ever been picked (or storage was cleared)
 *   needsPermission - a folder was picked before, but re-granting it needs a real click
 *   ready          - songs are listed and saving works
 *
 * The mount-time check only ever *queries* permission, never
 * *requests* it -- browsers require requestPermission to be called
 * from a real click, so `needsPermission` exists specifically to give
 * the UI something to put a button on.
 */
export function useSongLibrary() {
  const [status, setStatus] = useState('checking');
  const [dirHandle, setDirHandle] = useState(null);
  const [songs, setSongs] = useState([]);

  const refresh = useCallback(async (handle) => {
    const target = handle ?? dirHandle;
    if (!target) return;
    setSongs(await listSongs(target));
  }, [dirHandle]);

  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      setStatus('unsupported');
      return;
    }
    (async () => {
      const stored = await getPersistedDirectoryHandle();
      if (!stored) {
        setStatus('needsFolder');
        return;
      }
      if (await hasReadWritePermission(stored)) {
        setDirHandle(stored);
        setSongs(await listSongs(stored));
        setStatus('ready');
      } else {
        setDirHandle(stored); // kept so the "Reconnect" button can request permission on it directly
        setStatus('needsPermission');
      }
    })();
  }, []);

  const chooseFolder = useCallback(async () => {
    const handle = await pickSongsDirectory();
    setDirHandle(handle);
    setSongs(await listSongs(handle));
    setStatus('ready');
  }, []);

  const reconnectFolder = useCallback(async () => {
    if (!dirHandle) return;
    if (await requestReadWritePermission(dirHandle)) {
      setSongs(await listSongs(dirHandle));
      setStatus('ready');
    }
  }, [dirHandle]);

  /** Save a song's chart data, keyed by its own title -> filename. */
  const saveSong = useCallback(
    async (chartData) => {
      if (!dirHandle) throw new Error('no songs folder chosen yet');
      await writeChartFile(dirHandle, chartFileName(chartData.title), chartData);
      setSongs(await listSongs(dirHandle));
    },
    [dirHandle]
  );

  return { status, songs, chooseFolder, reconnectFolder, saveSong, refresh };
}
