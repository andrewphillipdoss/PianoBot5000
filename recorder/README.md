# Recorder

A browser app (React + Web MIDI) for recording songs straight off a real
piano: play the chords, the melody and the bassline -- in any order, each
one along with whatever's already there -- and it builds a chart -- the exact same JSON format the legacy `pianobot chart` CLI reads,
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
2. **Add a Song** -- title/key/tempo/time signature, once per song
   (pre-filled from whatever was already typed if you back out of the
   section hub to here). Time signature (2/4 through 6/4 -- compound
   meters like 6/8 aren't modeled separately, pick whichever beat count
   reads naturally) sets the count-in length, the metronome's accent
   pattern and the default pickup-bar length, and is changeable later
   from Song view. Nothing here asks which parts the song has -- every
   section offers all three.
3. **Section hub** (`SectionHub.jsx`) -- one card each for **Chords**,
   **Melody** and **Bassline**, recordable in any order and re-recordable
   or clearable at any time. Whichever part is recorded first sets the
   section's length, recognized from what was played (see below) and
   adjustable a bar at a time afterwards; every take after that plays
   along with the parts already there and stops by itself at the end. A
   part left empty is simply not in the song. Each card shows its take
   -- the chord chart as a measure grid (see below), melody and bassline
   as piano rolls -- and, while the take's raw MIDI is still around, a
   quantization (and, for lines, snap-strength) picker that re-derives
   it without re-recording. Changing the tempo here re-derives a lone
   first take at the new BPM (fixing a tempo typed wrong at setup);
   once more than one part exists they're already in step with each
   other in beats, so tempo then just changes playback speed. **▶ Play
   section** plays what's there. **+ Add Another Section** moves on to
   the next one; **Finalize Song** writes the chart JSON.
4. **Record** (`RecordPart.jsx`) -- the one record screen, for any part.
   Space (or click) starts a count-in. A section's first take runs until
   Space again; any later one plays the section back (other parts
   audible, synthesized) and stops on its own -- a melody or bassline
   take can start with a pickup bar for lead-in notes (a checkbox turns
   it off), and Space mid-take scraps it and starts over. The metronome
   clicks quarter notes or eighth notes (a picker on every record
   screen -- eighths add a much quieter click between beats). Live
   feedback: held notes, plus the detected chord when recording chords.
   What each part listens for is said right on the screen:
   - **Chords** -- triads, sus2/sus4, 6ths, 7ths (dom7/maj7/min7/m7b5/
     dim7/minMaj7) and 9ths, slash notation (`C/D`) when a bass note
     foreign to the chord sits under it, and a small line of scale-degree
     "insignia" under every symbol (`1 3 5 ♭7` under `C7`,
     `describeChordTones`). A slipped note or a stray melody note won't
     spoil the take -- see below.
   - **Melody** -- play freely, both hands if you like; the top note is
     kept (`extractTopLine`).
   - **Bassline** -- single low notes or octaves; otherwise the lowest
     note at or below middle C is kept (`extractBassLine`).
5. **Song view** -- every section's chord chart, melody and (when it has
   one) bassline, a Play button for the whole song (plus an optional
   metronome), editable tempo and time signature (both only change
   playback/display -- everything is stored in beats), quantization
   pickers that re-snap the saved chart, **Edit Section** for *any*
   section (reopens its hub with its saved parts in place -- re-record,
   clear or add any of them), **+ Add Section**, and **Delete Song** (a
   native `confirm()` -- there's no undo once a chart file is gone).

**Multi-section songs lay out sequentially on one shared beat timeline**
(section B starts exactly where A ends) -- both "add a section" entry
points (mid-recording and from an already-saved song's Song view) go
through the exact same append logic (`songStorage.js`'s
`appendSectionData`). Any section can be edited, not just the last:
a length change to a section in the middle shifts every later section's
start/end by the length delta (`songStorage.js`'s `replaceSectionData`).
That only works unambiguously because every chord/melody entry is tagged
with the section it belongs to right when it's written (`entry.section`)
-- otherwise a pickup note straddling a section boundary is genuinely
indistinguishable, by beat position alone, from a legitimate tail note of
the section before it. A chart saved before that tag existed falls back
to inferring it from beat position instead (`entrySectionLabel`), same as
it always effectively did.

**The Chord Chart is a measure grid, laid out like a lead sheet**
(`chordChartLayout.js`'s `layoutMeasures`, drawn by `ChordChart.jsx`) --
every measure the same width, four to a line (two on a phone), each with
its bar number, barlines on both sides, faint ticks on every beat and a
double barline at the section's end. Each chord sits at the beat it
actually lands on, with a band under it showing how long it lasts; a
chord held across a barline carries on into the next measure as a fainter
band, named only where it starts -- the same way an empty bar on a real
chart means "keep playing." Where a bar starts and stops is something to
see, not to work out from how wide a chord's box is.

**Any part can go first, and the rule that makes that work is one line**
(`recordingPipeline.js`): a take sets the section's length only when
there's nothing else in the section yet. So whichever part comes first
-- or comes back first after everything else was cleared -- decides it
(open-ended, stopped by hand, no pickup bar since there's no downbeat to
lead into yet), and every other take is fixed-length, played against
the rest (`recordingSession.js` schedules the other parts as a backing
track, all up front on the Web Audio clock) and clipped to the section.
`processTake` is the single entry point for every part.

**The section's length is recognized from the first take's music, not
from when it was stopped** (`recognizeSectionBars` in theory.js). Whole
empty bars before the first note (waiting a moment after the count-in)
and after the last one (reaching for the stop key) are dropped; a rest in
the middle stays. What's left is counted in whole bars: at least every
bar something was *struck* in, at most every bar something was still
*sounding* in -- and within that range a 4-bar phrase wins, then a
2-bar one. So an 8-bar tune whose last chord lands in bar 7 and rings
through bar 8 reads as 8 bars, a chord held on while reaching for the
stop key doesn't add one, and a 5- or 6-bar phrase stays 5 or 6 instead
of being rounded to 4 or 8 (rounding down used to cut off the last bar
outright). A release a beat or less past a barline doesn't count as
holding into the next bar. While recording, the live bar counter on the
record screen counts the same way, starting from the bar the first note
lands in.

**Chord clustering ("were these notes struck together?") is independent
of the quantization grid** -- it runs on raw, unquantized timing with its
own fixed hand-roll tolerance; the chosen display grid only rounds a
chord's boundaries *after* clustering has already decided which notes
belong to it. This matters at coarse grids especially: quantizing first
(this pipeline's old behavior) meant the threshold needed to bridge one
grid step of rounding error was, at 8th notes, *wider than a routine
eighth-note chord change* -- two genuinely different chords a normal half-
beat apart would get merged into one unrecognizable cluster.

**Melody quantization softens instead of hard-snapping by default** --
`quantizeBeat`'s `strength` (0-1, default 0.6, a "Snap strength" picker
on the record screens) blends a note only part of the way to its
nearest grid point rather than landing on it exactly. A full snap is a
strict nearest-neighbor rule with no way to tell "played a little early
on purpose" apart from ordinary human timing looseness -- a note
sitting close to the midpoint between two grid points can flip to a
"surprising" one purely because it landed a few ms on the far side of
that midpoint, and that failure mode gets worse at finer grids/faster
tempos, not better. The melody line is also enforced monophonic after
quantizing (`clipOverlappingNotes`) -- a held note released a little
late, or two notes' boundaries rounding toward each other, otherwise
leaves two notes audibly overlapping in a line that's melodically one
voice.

**Chords recording drops accidentally brushed keys before clustering**
(`dropAccidentalTouches`) -- a stray note held only a handful of
milliseconds, or barely touched (very low velocity), is filtered out
rather than folded into the chord as a wrong extra pitch class or
breaking recognition outright. Separately, a same-pitch note-on
arriving with no note-off in between and only a few ms after the first
(`RETRIGGER_DEBOUNCE_SECONDS` in theory.js) is treated as contact bounce
(common on some keyboards) rather than a real second strike, which
otherwise reads as a spurious "double hit" the player never played.

**Chord recognition withstands slips and stray notes, in three tiers**
(`recognizeCluster` in theory.js), tried in order for every cluster of
notes struck together:
1. the whole set as played;
2. a *foreign bass* -- the bottom note (single, or doubled in octaves)
   read as a separate bass under the chord above it, only when it's at
   least a minor 3rd below the next note up and its pitch class doesn't
   recur higher (that's what makes it a slash chord rather than an
   inversion, which stays plain `C`, never `C/E`);
3. *one slip* -- drop the single note that most looks like a mistake and
   try again: an inner note over the bass, then the softest, then the
   shortest. If two different drops would each give a different chord,
   the cluster is left out rather than guessed at.

Anything still unrecognizable (a lone melody note, a two-note brush) is
dropped from the take -- never the whole take -- and the hub mentions
how many moments were left out (`skippedClusterCount`).

**Melody and bassline are extracted, not demanded** (`extractTopLine`/
`extractBassLine` in theory.js) -- both reduce whatever was actually
played to one voice, working in real seconds before any beat
conversion: notes struck within 50ms of each other are one moment, and
that moment's top (or bottom) note is its candidate. A candidate is then
dropped if an earlier, still-sounding note sits above it (below, for the
bass) -- a held melody note over a moving accompaniment stays the
melody -- with 100ms of legato overlap forgiven. The bassline also
ignores anything above middle C (MIDI 60), so a right-hand-only moment
never becomes "bass."

**A captured note's start time is anchored to the count-in's own nominal
schedule, not to a fresh clock read inside its setTimeout callback** --
the fix for a real bug where notes could consistently land on the wrong
side of a fine (32nd-note) grid line. `performance.now()` read fresh
inside a `setTimeout` fires whenever that callback actually runs, which
can lag the nominal boundary by tens of milliseconds under any
main-thread contention; deriving it instead from `start()`'s own
timestamp plus the nominal count-in duration makes it immune to that,
and ties note timestamps to the exact same clock the audible
click/chord-backing schedule already uses.

**The record screen's idle-screen setting pickers (quantization, snap
strength, the pickup checkbox, tempo, time signature, metronome) must force a fresh
`RecordingSession` when changed, not just update what's displayed** --
`useRecordingSession.js` only ever reads its settings once, at
construction (a plain lazy-ref singleton, React's own documented pattern
for "build this once without `useEffect`"), so changing one of these on
the record screen's own idle screen updated the picker itself
and the eventually-saved chart, but silently left the *actual upcoming
take* still using whatever was set when that screen first mounted -- a
real bug this project shipped once. The fix is a React `key` on
`<RecordPart>` in `RecordSongFlow.jsx`, keyed on
exactly the settings that must trigger a new take, forcing a full
remount (and a fresh `RecordingSession`) the moment any of them changes
while still on the idle screen -- not a change to the hook itself, which
still only reads its props once by design. Caught by making a
Playwright check *actively poll* intermediate states rather than just
wait for a final one to appear; a wait-for-text check has a blind spot
for a state (like a brief pickup bar) that starts and ends before the
wait resolves.

**A multi-section chart's entries live on one shared *global* beat
timeline, but a section's own display (`MelodyRoll`, the record/review
screens) expects beats relative to that section's own downbeat** -- 0 =
this section's start, negative = its own pickup notes. Section A's
`start_beat` is 0, so global and section-relative coordinates are
identical there by coincidence, which is exactly why a later section's
melody could go on rendering as empty (SongView's own copy of this
rebase was missing) without Section A ever showing the bug. Also:
`.chip-row` (the little pill-shaped stat/setting row at the top of most
screens) wraps, once enough settings chips stopped fitting on one line
at ordinary window widths.

**Slash chords are detected from the chords take itself, not a separate
one** -- tier 2 above. Slash notation only ever shows up when the bass
note is genuinely *foreign* to the chord above it (e.g. a C triad over a
D bass, common in hymns/pop, written `C/D`); an inversion (E-G-C) is
still the same chord, not a different one with a borrowed note, so it
reads as plain `C`. A walking foreign bass under one held chord (`C`,
then `C/D`, then `C/F`) is treated as a real chord change, not a repeat.
Playback (`voiceChordSimple`) adds the bass note back in a full octave
below the rest of the voicing, both for song playback and for the
backing heard while recording another part. A recorded **bassline** is
its own thing -- a separate line, stored in `chartData.bassline` --
and doesn't rename the chords.

**The recognized chord vocabulary reaches past plain triads/7ths** --
sus2/sus4 (a triad with its 3rd replaced), major/minor 6th chords, and
full 9th chords (a 7th chord plus a 9th) are all standard chord
vocabulary (see e.g. Kostka & Payne, *Tonal Harmony*, for roman-numeral/
triad theory, and Mark Levine, *The Jazz Theory Book*, for the
extended/6th/sus vocabulary) that a plain triad-or-7th-only recognizer
would reject outright as "not a chord." Recognition dispatches purely
by how many *distinct* pitch classes were played (3, 4, or 5), then
matches against that size's own interval table -- widening the
vocabulary only ever means adding another entry to one of those tables,
in `theory.js`. This surfaces a couple of genuine, textbook harmonic
ambiguities along the way, on top of the augmented-triad/diminished-7th
symmetry that already existed: a sus2 and a sus4 chord can be the exact
same 3 notes read from a different root (`Csus4` = C-F-G = `Fsus2`),
and a half-diminished 7th always shares its 4 notes with the minor 6th
chord built a minor 3rd below its own root (`Bm7b5` = B-D-F-A =
`Dm6`) -- both resolved the same way the existing symmetric cases
already were, by preferring whichever candidate's root is the actual
bass note played. 11ths/13ths are deliberately left out -- they'd need
6-7 distinct pitch classes, which a piano chord struck by two hands
essentially never actually produces in one cluster, so there's a real,
low ceiling on how much further this vocabulary is worth chasing.

**The synthesized instrument voice aims for a Rhodes-ish electric piano
character, not a generic bell tone** (`connectRhodesPartials` in
pianoSynth.js) -- a plain sine fundamental, a quiet octave partial for
body, and a "tine" partial a hair sharp of a pure 3rd harmonic (real
tine-and-pickup electric pianos are never perfectly harmonic, and that
slight sharpness is a lot of what reads as "electric" rather than
"bell") that decays out on its own short, fixed schedule regardless of
how long the note is held -- the bright, percussive "bark" of a real
Rhodes attack settling into a plainer sustained tone. A quiet, slow
tremolo (the classic Rhodes vibrato/tremolo switch) is layered on top.
All of this is still built from the same click-free, fully analytic
gain envelope architecture the piano voice already had -- see
pianoSynth.js's own docstring for why that constraint exists and how it
stays satisfied.

**MIDI input has been reachable from any screen since `MidiProvider`
started wrapping the whole app; output now is too** (`midi.js`'s
`listOutputs`/`sendNoteOn`/`sendNoteOff`, exposed from `useMidi()`
alongside input) -- a real MIDI output port (a hardware synth/module, or
a DAW) can be picked the same way an input is, and any screen can send
notes to it via `useMidi().sendNoteOn`/`sendNoteOff`, as an alternative
to this app's own synthesized voice. Unlike input (where this app always
needs *something* selected for recording to work at all, so it falls
back to the first available port), output starts and stays unselected
until deliberately picked -- silently sending notes to whatever external
device happened to enumerate first would be a far more surprising
default than silently listening to the wrong keyboard. The MIDI Test
screen has a minimal picker + a "send test note" button to prove the
whole path end to end; nothing else in the app sends to it yet.

**Deliberately out of scope for now** (see the design discussion in this
repo's history for why): real lead-sheet notation rendering (the
"toggle to see actual engraved music" view from the design wireframe --
this pass has the Chord Chart's measure grid plus plain piano-rolls for
melody and bassline, not engraved notation) is a deliberately separate, later piece.

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
  recordingPipeline.js    pure: one take of any part (raw captured MIDI)
                          -> chords or a melody/bass line, setting the
                          section's length or clipped to it
  recordingSession.js     the real-time state machine + Web Audio
                          scheduler (count-in, capture, the backing
                          track of the section's other parts, all
                          scheduled precisely up front)
  songPlayback.js         one-shot playback of an already-saved song
                          (chords + melody + bassline together, no
                          count-in, plus an optional metronome)
  songStorage.js          File System Access I/O + the on-disk chart
                          JSON shape (matches pianobot.charts.simple_format)
                          + the pure section-composition logic (build,
                          append, replace any section, re-quantize)
  chordChartLayout.js     pure: lay a section's chords out as measures
                          (the Chord Chart's measure grid)
  parts.js                the three parts a section can have
  pianoSynth.js           the synthesized Rhodes-ish electric piano voice
                          + metronome click; a fully analytic, click-free
                          envelope for anything scheduled ahead of time
                          (chord backing, song playback), vs. the simpler
                          live two-call note-on/note-off path for
                          real-time MIDI input
  midi.js                 raw Web MIDI access/parsing (input) and
                          raw-byte message sending (output)
  hooks/
    MidiProvider.jsx      one shared MIDI connection for the whole app
                          (input + output port lists, selection persisted
                          across reloads, a raw message tap for
                          recordingSession.js) -- wraps the whole app, so
                          reachable via useMidi() from any screen
    useRecordingSession.js React glue for recordingSession.js
    useSongPlayback.js    React glue for songPlayback.js
    useSongLibrary.js     React glue for songStorage.js (folder picking/
                          permission state, song list, saving)
  screens/                one component per screen -- SongSetup,
                          SectionHub, RecordPart, SongView, ... --
                          orchestrated by RecordSongFlow
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
