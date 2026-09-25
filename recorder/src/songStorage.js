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

import { DEFAULT_QUANTIZE_SUBDIVISIONS_PER_BEAT } from './recordingPipeline.js';
import { formatChordSymbol, parseChordSymbol } from './theory.js';

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
 * A brand new, sectionless chart shell -- the starting point every
 * song is built up from by appending sections onto it one at a time
 * (see `appendSectionData`).
 *
 * `quantization` (subdivisions/beat -- see recordingPipeline.js) isn't
 * part of the legacy CLI's own chart format, but the legacy reader
 * ignores unknown top-level keys, so it round-trips harmlessly here:
 * re-recording an already-saved song reads it back out and keeps using
 * the same grid it was originally recorded at, rather than silently
 * resetting to the default.
 */
export function emptyChartData({ title, key, tempo, quantization = DEFAULT_QUANTIZE_SUBDIVISIONS_PER_BEAT }) {
  return { title, key, tempo, quantization, sections: [], chords: [], melody: [] };
}

/** 0 -> "A", 1 -> "B", ... -- this app's whole section-labeling scheme, single letters in order recorded. */
export function nextSectionLabel(existingSectionCount) {
  return String.fromCharCode('A'.charCodeAt(0) + existingSectionCount);
}

/**
 * Lay one more section onto a chart's single, shared, global beat
 * timeline -- sections are always contiguous (each one starts exactly
 * where the previous ends), so appending is just "add a section
 * spanning [end of the last one, that + sectionLengthBeats)" and
 * offset this section's own chords/melody (in the internal
 * NoteEvent/ChordEvent shape -- see theory.js/recordingPipeline.js) by
 * that same start beat, converting them to the on-disk field names
 * (`beat`/`duration_beats`/...) and chord objects to plain lead-sheet
 * symbol strings along the way. A pickup note's beat is negative
 * *relative to its own section* (see recordingPipeline.js's
 * PICKUP_BEATS) -- offsetting it the same way as every other note
 * correctly lands it in the tail of whatever came right before this
 * section, which is really where and when it's played.
 */
export function appendSectionData(chartData, { sectionLabel, sectionLengthBeats, chords, melody }) {
  const startBeat = chartData.sections.length === 0 ? 0 : chartData.sections.at(-1).end_beat;
  return {
    ...chartData,
    sections: [...chartData.sections, { label: sectionLabel, start_beat: startBeat, end_beat: startBeat + sectionLengthBeats }],
    chords: [
      ...chartData.chords,
      ...chords.map((c) => ({
        beat: c.start + startBeat,
        duration_beats: c.end - c.start,
        chord: formatChordSymbol(c.rootPitchClass, c.quality),
      })),
    ],
    melody: [
      ...chartData.melody,
      ...melody.map((n) => ({
        beat: n.start + startBeat,
        duration_beats: n.end - n.start,
        pitch: n.pitch,
        velocity: n.velocity,
      })),
    ],
  };
}

/** Build the chart JSON object for a brand new, single-section song -- `emptyChartData` + `appendSectionData` in one call. */
export function buildChartData({ title, key, tempo, quantization, sectionLabel, sectionLengthBeats, chords, melody }) {
  return appendSectionData(emptyChartData({ title, key, tempo, quantization }), { sectionLabel, sectionLengthBeats, chords, melody });
}

/**
 * Convert one already-saved section's on-disk chords back into the
 * internal ChordEvent shape `appendSectionData`/RecordMelody expect --
 * the reverse of what building a chart does. Needed for "re-record
 * just the melody," which keeps the existing chords/length and only
 * replaces the melody, so those chords have to come back out in a
 * form the recording flow can play back and re-save.
 */
export function sectionChordsAsInternal(chartData, section) {
  return chartData.chords
    .filter((c) => c.beat >= section.start_beat && c.beat < section.end_beat)
    .map((c) => {
      const parsed = parseChordSymbol(c.chord);
      return { ...parsed, start: c.beat - section.start_beat, end: c.beat + c.duration_beats - section.start_beat };
    });
}

/**
 * Replace the *last* section's chords+melody+length in place --
 * re-recording it. Deliberately last-section-only: an earlier section
 * would cascade a length change through every section after it, and
 * raises real ambiguity about which melody notes (a pickup note
 * straddles the section boundary -- see appendSectionData) belong to
 * which section once one in the middle is touched. Rather than risk
 * silently misattributing or dropping notes, that's deferred; the
 * common case (re-record what you just did) is exactly what this
 * covers, since a freshly-added section is always the last one.
 */
export function replaceLastSectionData(chartData, { sectionLengthBeats, chords, melody }) {
  const lastSection = chartData.sections.at(-1);
  const withoutLastSection = {
    ...chartData,
    sections: chartData.sections.slice(0, -1),
    chords: chartData.chords.filter((c) => c.beat < lastSection.start_beat),
    melody: chartData.melody.filter((n) => n.beat < lastSection.start_beat),
  };
  return appendSectionData(withoutLastSection, { sectionLabel: lastSection.label, sectionLengthBeats, chords, melody });
}

/**
 * Same idea as theory.js's `mergeConsecutiveChords`, for the on-disk
 * `{beat, duration_beats, chord}` shape (`chord` a plain lead-sheet
 * symbol string, not root/quality) -- applied when *viewing* a song,
 * so a chart saved before chords were merged at record time still
 * displays merged rather than repeating the same symbol.
 */
export function mergeConsecutiveChordEntries(chords) {
  const merged = [];
  for (const entry of chords) {
    const prev = merged[merged.length - 1];
    if (prev && prev.chord === entry.chord) {
      prev.duration_beats = entry.beat + entry.duration_beats - prev.beat;
    } else {
      merged.push({ ...entry });
    }
  }
  return merged;
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
