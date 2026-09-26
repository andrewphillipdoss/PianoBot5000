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

import { DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT, DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT, PICKUP_BEATS } from './recordingPipeline.js';
import { formatChordSymbol, parseChordSymbol, quantizeBeat } from './theory.js';

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
 * `chordsQuantization`/`melodyQuantization` (subdivisions/beat -- see
 * recordingPipeline.js) aren't part of the legacy CLI's own chart
 * format, but the legacy reader ignores unknown top-level keys, so
 * they round-trip harmlessly here: re-recording an already-saved song
 * reads them back out and keeps using the same grid it was originally
 * recorded at, rather than silently resetting to the default.
 */
export function emptyChartData({
  title,
  key,
  tempo,
  chordsQuantization = DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT,
  melodyQuantization = DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT,
}) {
  return { title, key, tempo, chordsQuantization, melodyQuantization, sections: [], chords: [], melody: [] };
}

/**
 * Read a chart's quantization settings back out, tolerating a chart
 * saved before chords/melody had separate settings (a single
 * `quantization` field, applied to both) -- falls back through that,
 * then to the current defaults, so an old file never throws or
 * silently loses its own recorded grid.
 */
export function readChartQuantization(chartData) {
  return {
    chordsQuantization: chartData.chordsQuantization ?? chartData.quantization ?? DEFAULT_CHORDS_SUBDIVISIONS_PER_BEAT,
    melodyQuantization: chartData.melodyQuantization ?? chartData.quantization ?? DEFAULT_MELODY_SUBDIVISIONS_PER_BEAT,
  };
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
 *
 * Every entry is tagged with the section it belongs to (`section:
 * sectionLabel`) directly, rather than leaving that to be inferred
 * later from its beat position -- see `entrySectionLabel` for why that
 * inference is genuinely ambiguous right at a section boundary, which
 * is exactly what this tag exists to avoid for anything recorded from
 * here on.
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
        section: sectionLabel,
      })),
    ],
    melody: [
      ...chartData.melody,
      ...melody.map((n) => ({
        beat: n.start + startBeat,
        duration_beats: n.end - n.start,
        pitch: n.pitch,
        velocity: n.velocity,
        section: sectionLabel,
      })),
    ],
  };
}

/** Build the chart JSON object for a brand new, single-section song -- `emptyChartData` + `appendSectionData` in one call. */
export function buildChartData({ title, key, tempo, chordsQuantization, melodyQuantization, sectionLabel, sectionLengthBeats, chords, melody }) {
  return appendSectionData(emptyChartData({ title, key, tempo, chordsQuantization, melodyQuantization }), { sectionLabel, sectionLengthBeats, chords, melody });
}

/**
 * Which section (by label) an on-disk chord/melody entry belongs to.
 * A chart saved by this app now tags every entry directly (`entry.
 * section`, written by `appendSectionData`/`replaceSectionData`), so
 * this is unambiguous for anything recorded going forward. A chart
 * saved before that tag existed falls back to inferring it from the
 * entry's beat position against each section's own [start_beat,
 * end_beat) range, widened at the bottom by one pickup bar so a
 * pickup note (which lands *before* its own section's start_beat --
 * see appendSectionData) is still attributed to the section it was
 * actually played into rather than the one before it.
 *
 * That widened-range fallback is genuinely ambiguous right at the
 * boundary -- a real pickup note for section i and a legitimate tail
 * note of section i-1 can occupy the exact same beat, indistinguishable
 * by position alone. Checked latest-section-first so a boundary note
 * resolves to being *someone's* pickup (the more common case for a
 * note landing in that narrow window) rather than the earlier
 * section's tail; this only matters for legacy untagged data, which is
 * exactly why new charts don't rely on it.
 */
export function entrySectionLabel(entry, sections) {
  if (entry.section != null) return entry.section;
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (entry.beat >= section.start_beat - PICKUP_BEATS && entry.beat < section.end_beat) return section.label;
  }
  return sections.at(-1)?.label ?? null;
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
    .filter((c) => entrySectionLabel(c, chartData.sections) === section.label)
    .map((c) => {
      const parsed = parseChordSymbol(c.chord);
      return { ...parsed, start: c.beat - section.start_beat, end: c.beat + c.duration_beats - section.start_beat };
    });
}

/**
 * Replace *any* section's chords+melody+length in place -- re-recording
 * it. Every later section shifts by the length delta (both its own
 * start_beat/end_beat and its tagged chord/melody entries' beats);
 * every earlier section is untouched. This only works unambiguously
 * because every entry knows which section it belongs to (see
 * `entrySectionLabel`) -- without that tag, a length change in the
 * middle of a chart couldn't tell a pickup note meant for the
 * following section apart from a genuine tail note of the section
 * being replaced.
 */
export function replaceSectionData(chartData, sectionIndex, { sectionLengthBeats, chords, melody }) {
  const originalSections = chartData.sections;
  const targetSection = originalSections[sectionIndex];
  const lengthDeltaBeats = sectionLengthBeats - (targetSection.end_beat - targetSection.start_beat);
  const labelToIndex = new Map(originalSections.map((s, i) => [s.label, i]));
  const startBeat = targetSection.start_beat;

  function orderOf(entry) {
    return labelToIndex.get(entrySectionLabel(entry, originalSections)) ?? originalSections.length - 1;
  }
  // Filtering three times and concatenating in this order (rather than
  // one pass) keeps the result in beat-ascending order, which
  // mergeConsecutiveChordEntries relies on -- Array.filter preserves
  // each group's original relative order, and the whole array was
  // already beat-ascending before this replace.
  function rebuild(entries, replaced) {
    const before = entries.filter((e) => orderOf(e) < sectionIndex);
    const after = entries.filter((e) => orderOf(e) > sectionIndex).map((e) => ({ ...e, beat: e.beat + lengthDeltaBeats }));
    return [...before, ...replaced, ...after];
  }

  return {
    ...chartData,
    sections: originalSections.map((s, i) => {
      if (i < sectionIndex) return s;
      if (i === sectionIndex) return { label: s.label, start_beat: startBeat, end_beat: startBeat + sectionLengthBeats };
      return { ...s, start_beat: s.start_beat + lengthDeltaBeats, end_beat: s.end_beat + lengthDeltaBeats };
    }),
    chords: rebuild(
      chartData.chords,
      chords.map((c) => ({
        beat: c.start + startBeat,
        duration_beats: c.end - c.start,
        chord: formatChordSymbol(c.rootPitchClass, c.quality),
        section: targetSection.label,
      }))
    ),
    melody: rebuild(
      chartData.melody,
      melody.map((n) => ({
        beat: n.start + startBeat,
        duration_beats: n.end - n.start,
        pitch: n.pitch,
        velocity: n.velocity,
        section: targetSection.label,
      }))
    ),
  };
}

/**
 * Re-snap every already-saved chord/melody entry onto a new
 * quantization grid, for a song whose raw MIDI is long gone (recording
 * is the only point that's ever available -- see ChordsReview.jsx/
 * SectionComplete.jsx for the from-raw-MIDI version used right after a
 * take, while it still is). This can only ever re-round each entry's
 * own already-quantized `beat`/`duration_beats`, never re-recognize
 * anything -- so, same as those two screens, it can't fail, just
 * shift boundaries to the new grid (with the same "never round a note
 * away to nothing" guard as the recording pipeline).
 *
 * Beats here are global (offset by each section's own start_beat, all
 * multiples of a full bar), not section-relative -- but that's exactly
 * equivalent for quantization purposes, since a whole-bar offset is
 * already on-grid at *any* subdivision.
 */
export function requantizeChartData(chartData, { chordsQuantization, melodyQuantization }) {
  return {
    ...chartData,
    chordsQuantization,
    melodyQuantization,
    chords: requantizeEntries(chartData.chords, chordsQuantization),
    melody: requantizeEntries(chartData.melody, melodyQuantization),
  };
}

function requantizeEntries(entries, subdivisionsPerBeat) {
  const step = 1 / subdivisionsPerBeat;
  return entries.map((entry) => {
    const start = quantizeBeat(entry.beat, subdivisionsPerBeat);
    let end = quantizeBeat(entry.beat + entry.duration_beats, subdivisionsPerBeat);
    if (end <= start) end = start + step;
    return { ...entry, beat: start, duration_beats: end - start };
  });
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

/** Write chart JSON straight to an already-held file handle -- e.g. re-saving a live edit (SongView.jsx's quantization change) to the exact file a song was already opened from, no directory lookup needed. */
export async function writeChartToHandle(fileHandle, chartData) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(chartData, null, 2));
  await writable.close();
}

export async function writeChartFile(dirHandle, fileName, chartData) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  await writeChartToHandle(fileHandle, chartData);
  return fileHandle;
}
