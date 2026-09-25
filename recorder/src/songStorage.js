/**
 * Reads/writes songs as chart JSON files via the File System Access
 * API -- the exact same format `pianobot.charts.simple_format` (the
 * legacy Python CLI) already reads, so a song recorded here is
 * immediately usable by `pianobot chart`/`pianobot transpose` with no
 * export/translation step.
 *
 * Split, like everything else in this project, into a pure layer
 * (filenames, the JSON shape, relative-time formatting -- unit
 * tested, no browser needed) and a browser-I/O layer (the actual
 * picker/file/IndexedDB calls -- Chrome-only, verified manually/via a
 * faked directory handle, not unit tested).
 */

import { formatChordSymbol } from './theory.js';

// ---------------------------------------------------------------------------
// Pure: filenames, the chart JSON shape, relative-time formatting.
// ---------------------------------------------------------------------------

export function slugify(title) {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

export function chartFileName(title) {
  return `${slugify(title)}.json`;
}

/**
 * Build the chart JSON object for a single-section song (this app's
 * current scope -- see the design discussion for why multi-section
 * merging is deferred). `chords`/`melody` are in the internal
 * NoteEvent/ChordEvent shape (see theory.js/recordingPipeline.js);
 * this is where they get translated into the on-disk field names
 * (`beat`/`duration_beats`/...) and the chord objects get turned into
 * plain lead-sheet symbol strings.
 */
export function buildChartData({ title, key, tempo, sectionLabel, sectionLengthBeats, chords, melody }) {
  return {
    title,
    key,
    tempo,
    sections: [{ label: sectionLabel, start_beat: 0, end_beat: sectionLengthBeats }],
    chords: chords.map((c) => ({
      beat: c.start,
      duration_beats: c.end - c.start,
      chord: formatChordSymbol(c.rootPitchClass, c.quality),
    })),
    melody: melody.map((n) => ({
      beat: n.start,
      duration_beats: n.end - n.start,
      pitch: n.pitch,
      velocity: n.velocity,
    })),
  };
}

export function formatRelativeTime(timestampMs, nowMs = Date.now()) {
  const diffSeconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);
  const diffWeeks = Math.round(diffDays / 7);
  const diffMonths = Math.round(diffDays / 30);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
  return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
}

/** Chart JSON (as read off disk) + its file's last-modified time -> the summary shape the song list displays. */
export function summarizeChart(chartData, lastModifiedMs, nowMs = Date.now()) {
  return {
    title: chartData.title,
    key: chartData.key,
    tempo: chartData.tempo,
    sectionLabels: (chartData.sections ?? []).map((s) => s.label),
    updatedAtMs: lastModifiedMs,
    updatedAt: formatRelativeTime(lastModifiedMs, nowMs),
  };
}

// ---------------------------------------------------------------------------
// Browser I/O: File System Access API + IndexedDB (for remembering
// which folder was picked across reloads, so you don't re-pick it
// every session). Chrome-only; not unit tested.
// ---------------------------------------------------------------------------

const DB_NAME = 'pianobot-recorder';
const DB_STORE = 'handles';
const DIR_HANDLE_KEY = 'songsDirectory';

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Must be called from a real user gesture (a click) -- same rule as audio. */
export async function pickSongsDirectory() {
  const handle = await window.showDirectoryPicker({ id: 'pianobot-songs', mode: 'readwrite' });
  try {
    await persistDirectoryHandle(handle);
  } catch {
    // Best-effort: remembering the folder across reloads is a nice-to-have,
    // not essential to using it right now (e.g. IndexedDB unavailable in
    // a private-browsing context) -- don't fail the whole pick over it.
  }
  return handle;
}

/** Passive check, safe to call anywhere (e.g. on page load) -- never prompts. */
export async function hasReadWritePermission(handle) {
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** The actual permission prompt -- like `pickSongsDirectory`, MUST be called from a real user gesture (a click). */
export async function requestReadWritePermission(handle) {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistDirectoryHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, DIR_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPersistedDirectoryHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const request = tx.objectStore(DB_STORE).get(DIR_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** Every chart JSON file directly inside the songs folder, as summaries for the song list. Files that aren't valid chart JSON are skipped, not fatal. */
export async function listSongs(dirHandle) {
  const summaries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    try {
      const file = await handle.getFile();
      const chartData = JSON.parse(await file.text());
      summaries.push({ fileName: name, fileHandle: handle, ...summarizeChart(chartData, file.lastModified) });
    } catch {
      // Not a valid chart file -- skip it rather than fail the whole listing.
    }
  }
  summaries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return summaries;
}

export async function readChartFile(fileHandle) {
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

export async function writeChartFile(dirHandle, fileName, chartData) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(chartData, null, 2));
  await writable.close();
  return fileHandle;
}
