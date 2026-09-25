# Recorder

A browser app (React + Web MIDI) for recording songs straight off a real
piano: play the chords, play the melody along with them, and it builds a
chart -- the exact same JSON format the legacy `pianobot chart` CLI reads,
so a song recorded here needs no export/translation step to use there.

**Chrome only** -- Web MIDI and the File System Access API aren't
supported in Safari/Firefox. Runs entirely client-side; no server, no
build artifact beyond the static site `vite build` produces.

## What works right now

The full single-section record-a-song flow, end to end, verified against
real MIDI hardware and re-verified (with simulated hardware) after every
change since:

1. **My Songs** -- lists every chart JSON file in a folder you pick once
   (remembered across reloads via IndexedDB; re-grant permission with one
   click if the browser ever forgets).
2. **Add a Song** -- title/key/tempo, once.
3. **Record Chords** -- Space (or click) starts a count-in, then records;
   Space again stops. Live feedback: held notes + the detected chord
   (triads and 7th chords -- dom7/maj7/min7/m7b5/dim7/minMaj7).
4. **Chords review** -- the detected chord chart, section length
   auto-computed (trailing dead air trimmed, rounded to the nearest 4
   bars), adjustable by a 4-bar step before proceeding.
5. **Record Melody** -- the chords play back (audibly, synthesized) for
   exactly the section's length while you play the melody over them; no
   manual stop, it auto-finishes when the chords do. Space mid-take
   scraps it and restarts the count-in.
6. **Section Complete** -- Chord Chart view (bars + chord symbols) of
   what was captured, Re-record Chords/Melody, Finalize (writes the
   chart JSON to your songs folder).

**Deliberately out of scope for now** (see the design discussion in this
repo's history for why): real lead-sheet notation rendering (the
"toggle to see actual engraved music" view from the design wireframe --
this pass only has the Chord Chart view), and multi-section songs (the
"Song with N Sections" view, "+ Add Section"). Both are big enough to
deserve their own pass once this core loop was proven working.

A small dev-only diagnostic screen, **MIDI Test**, is still in the top
nav -- useful for debugging Web MIDI/chord-detection issues in isolation
without going through the whole recording flow.

## Code layout

```
src/
  theory.js              pure music theory: chord recognition (reverse
                          of voicing), quantization, bar-trimming,
                          MIDI-message-to-note pairing, playback voicing
  recordingPipeline.js    pure: raw captured MIDI -> chart chords/melody
  recordingSession.js     the real-time state machine + Web Audio
                          lookahead scheduler (count-in, capture, the
                          melody pass's chord-backing playback)
  songStorage.js          File System Access I/O + the on-disk chart
                          JSON shape (matches pianobot.charts.simple_format)
  pianoSynth.js           the synthesized piano voice + metronome click
  midi.js                 raw Web MIDI access/parsing
  hooks/
    useMidiInput.js       React glue for midi.js (port list, live events,
                          a raw message tap for recordingSession.js)
    useRecordingSession.js React glue for recordingSession.js
    useSongLibrary.js     React glue for songStorage.js (folder picking/
                          permission state, song list, saving)
  screens/                one component per screen in the design wireframe
```

Each layer above the UI is deliberately framework-free and pure/testable
without a browser: `theory.js`, `recordingPipeline.js`, and the pure half
of `songStorage.js` have full unit test coverage. `recordingSession.js`'s
state-machine timing is unit tested too (with pianoSynth mocked and a
very fast fake tempo, since real Web Audio doesn't exist in the test
environment); how it actually sounds/syncs is verified by ear and via a
simulated-MIDI-hardware Playwright walkthrough, not by unit test.

## Install / run

```bash
cd recorder
npm install
npm run dev       # http://localhost:5173, open in Chrome
npm test          # unit tests
npm run build     # production build
```
