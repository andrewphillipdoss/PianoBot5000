import { useCallback, useEffect, useRef, useState } from 'react';
import { playSong } from '../songPlayback.js';

/** React wrapper around songPlayback.js's one-shot playback -- tracks whether it's currently playing and exposes play/stop. */
export function useSongPlayback() {
  const [isPlaying, setIsPlaying] = useState(false);
  const stopRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => stopRef.current?.(), []); // silence playback if the screen is left mid-song

  const play = useCallback(async (chartData) => {
    const requestId = ++requestIdRef.current;
    stopRef.current?.(); // stop whatever's already playing first
    setIsPlaying(true);

    // playSong awaits enableAudio() before it schedules anything, so
    // there's a real gap where a stop() (or a newer play()) can land
    // before this resolves -- requestId catches that instead of
    // clobbering it and letting audio start after the player already
    // asked for it to stop.
    const stop = await playSong(chartData, {
      onDone: () => {
        if (requestIdRef.current !== requestId) return;
        stopRef.current = null;
        setIsPlaying(false);
      },
    });

    if (requestIdRef.current !== requestId) {
      stop();
      return;
    }
    stopRef.current = stop;
  }, []);

  const stop = useCallback(() => {
    requestIdRef.current += 1; // invalidates any in-flight play() so it can't clobber this once it resolves
    stopRef.current?.();
    stopRef.current = null;
    setIsPlaying(false);
  }, []);

  return { isPlaying, play, stop };
}
