# Recorder

A browser app (React + Web MIDI) for recording songs straight off a real
piano: play the chords, play the melody along with them, and it builds a
chart -- the exact same JSON format the legacy `pianobot chart` CLI reads,
so a song recorded here needs no export/translation step to use there.

**Chrome only** -- Web MIDI and the File System Access API aren't
supported in Safari/Firefox. Runs entirely client-side; no server, no
build artifact beyond the static site `vite build` produces.

## What works right now

The full multi-section record-a-song flow, end to end, verified against
real MIDI hardware and re-verified (with simulated hardware) after every
change since:

1. **My Songs** -- lists every chart JSON file in a folder you pick once
   (remembered across reloads via IndexedDB; re-grant permission with one
   click if the browser ever forgets).
2. **Add a Song** -- title/key/tempo/quantization (8th/16th/32nd notes),
   once per song.
3. **Record Chords** -- Space (or click) starts a count-in, then records;
   Space again stops. Live feedback: held notes + the detected chord
   (triads and 7th chords -- dom7/maj7/min7/m7b5/dim7/minMaj7).
4. **Chords review** -- the detected chord chart, section length
   auto-computed (trailing dead air trimmed, rounded to the nearest 4
   bars), adjustable by a 4-bar step before proceeding.
5. **Record Melody** -- capturing starts with one pickup bar before the
   chords enter, so a pickup/anacrusis note has somewhere to go (it comes
   back with a negative beat position); the chords then play back
   (audibly, synthesized) for exactly the section's length while you play
   the melody over them -- no manual stop, it auto-finishes when the
   chords do. Space mid-take scraps it and restarts the count-in.
6. **Section Complete** -- Chord Chart view (bars + chord symbols,
   consecutive repeats of the same chord merged into one wider entry
   rather than listed twice) of what was captured, Re-record
   Chords/Melody, **+ Add Another Section** (records the next section
   right away, saving all of them together on Finalize), or Finalize
   (writes the chart JSON to your songs folder).
7. **Song view** -- click a song in My Songs to see every section's chord
   chart and a simple piano-roll of its melody (time left-to-right, pitch
   low-to-high; not real notation, see below), a Play button that plays
   the whole song back (all sections, chords + melody together), **+ Add
   Section** (appends a new section to this already-saved song), and
   Re-record Chords/Melody for its *last* section (see below for why only
   the last one).

**Multi-section songs lay out sequentially on one shared beat timeline**
(section B starts exactly where A ends) -- both "add a section" entry
points (mid-recording and from an already-saved song's Song view) go
through the exact same append logic (`songStorage.js`'s
`appendSectionData`). Only the *last* section can be re-recorded for now:
an earlier one would cascade a length change through every section after
it, and raises real ambiguity about which melody notes (a pickup note
straddles the section boundary) belong to which section once one in the
middle is touched -- deferred rather than risk silently misattributing or
dropping notes, since the common case (re-record what you just did) is
always the last section anyway.

**Deliberately out of scope for now** (see the design discussion in this
repo's history for why): real lead-sheet notation rendering (the
"toggle to see actual engraved music" view from the design wireframe --
this pass has the Chord Chart view plus a plain piano-roll for melody,
not engraved notation) is a deliberately separate, later piece.

A small dev-only diagnostic screen, **MIDI Test**, is still in the top
nav -- useful for debugging Web MIDI/chord-detection issues in isolation
without going through the whole recording flow.

## Code layout

```
src/
  theory.js              pure music theory: chord recognition (reverse
                          of voicing) and its inverse (parsing a saved
                          symbol back), quantization, bar-trimming,
                          MIDI-message-to-note pairing, playback voicing
  recordingPipeline.js    pure: raw captured MIDI -> chart chords/melody,
                          at whatever quantization grid the song was set
                          up with
  recordingSession.js     the real-time state machine + Web Audio
                          scheduler (count-in, capture, the melody pass's
                          chord-backing playback, all scheduled
                          precisely up front rather than incrementally)
  songPlayback.js         one-shot playback of an already-saved song
                          (chords + melody together, no count-in)
  songStorage.js          File System Access I/O + the on-disk chart
                          JSON shape (matches pianobot.charts.simple_format)
                          + the pure section-composition logic (build,
                          append, replace-the-last-section)
  pianoSynth.js           the synthesized piano voice + metronome click;
                          a fully analytic, click-free envelope for
                          anything scheduled ahead of time (chord backing,
                          song playback), vs. the simpler live two-call
                          note-on/note-off path for real-time MIDI input
  midi.js                 raw Web MIDI access/parsing
  hooks/
    MidiProvider.jsx      one shared MIDI connection for the whole app
                          (port list, selection persisted across
                          reloads, a raw message tap for recordingSession.js)
    useRecordingSession.js React glue for recordingSession.js
    useSongPlayback.js    React glue for songPlayback.js
    useSongLibrary.js     React glue for songStorage.js (folder picking/
                          permission state, song list, saving)
  screens/                one component per screen in the design wireframe
```

Each layer above the UI is deliberately framework-free and pure/testable
without a browser: `theory.js`, `recordingPipeline.js`, and the pure half
of `songStorage.js` have full unit test coverage. `recordingSession.js`'s
state-machine timing is unit tested too (with pianoSynth mocked and a
very fast fake tempo, since real Web Audio doesn't exist in the test
environment); `pianoSynth.js`'s envelope scheduling is verified against a
minimal fake Web Audio context whose gain param throws if ever read
mid-schedule (the exact bug the click-free envelope exists to avoid). How
it all actually sounds/syncs in a real browser is verified by ear and via
a simulated-MIDI-hardware Playwright walkthrough, not by unit test.

## Install / run

```bash
cd recorder
npm install
npm run dev       # http://localhost:5173, open in Chrome
npm test          # unit tests
npm run build     # production build
```
