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
2. **Add a Song** -- title/key/tempo/time signature, once per song
   (pre-filled from whatever was already typed if you back out of
   Record Chords to here -- this screen used to always reset to blank
   defaults on remount, silently discarding anything already entered).
   Time signature (2/4 through 6/4 -- compound meters like 6/8 aren't
   modeled separately, pick whichever beat count reads naturally) sets
   the count-in length, the metronome's accent pattern, and the default
   pickup-bar length, and is changeable later too: on the record screens
   (it's part of what forces a fresh take there, see below) and from an
   already-saved song's Song view, same as tempo -- section start/end
   beats are already fixed, so changing it there only changes how many
   "bars" they're displayed as and future recording, never the
   already-saved chord/melody positions. Quantization
   (quarter/8th/16th/32nd notes) lives on the record screens themselves
   instead (see below) -- chords default to 8th notes, melody to 16th,
   and both are changeable there in every mode, re-record included --
   and again from an already-saved song's Song view (see below), which
   re-snaps the already-recorded chart to the new grid since there's no
   raw MIDI left to re-derive from at that point. Quarter notes is
   useful for chords especially -- a coarser grid than the 8th-note
   default for a song whose chords never change faster than once a beat.
3. **Record Chords** -- Space (or click) starts a count-in, then records;
   Space again stops. Live feedback: held notes + the detected chord --
   triads, sus2/sus4, 6th chords, 7th chords (dom7/maj7/min7/m7b5/dim7/
   minMaj7), and 9th chords (dom9/maj9/min9), plus slash notation
   (`C/E`) whenever the lowest note(s) held read as a distinct bass note
   rather than as part of the chord voicing itself -- see below for how.
   Every chord symbol shown anywhere in the app (here, Chords review,
   Section Complete, Song view) also carries a small second line of
   scale-degree "insignia" underneath it (e.g. `1 3 5 b7` under
   `Cdom7`) -- what each note in the chord actually *is*, not just the
   chord's name as a whole (`describeChordTones` in theory.js). The
   metronome clicks the beat (strong on the downbeat) plus a much
   quieter eighth-note subdivision in between, so the off-the-beat feel
   is easier to place while playing. Tempo is editable right here too
   (and through Chords review), not fixed at song setup.
4. **Chords review** -- the detected chord chart, section length
   auto-computed (trailing dead air trimmed, rounded to the nearest 4
   bars), adjustable by a 4-bar step before proceeding. Changing the
   quantization *or the tempo* here re-derives this exact take from its
   still-available raw MIDI at the new grid/BPM -- no re-recording
   needed; a wrong tempo typed at setup is fixable here, not just a
   rounding tweak, since every beat position is recomputed from the
   fixed real-world capture duration.
5. **Record Melody** -- capturing starts with one pickup bar before the
   chords enter by default (the status pill says so explicitly), so a
   pickup/anacrusis note has somewhere to go (it comes back with a
   negative beat position) -- a checkbox here turns the pickup bar off
   entirely for a song that never needs a lead-in, capturing starting
   right on the downbeat instead. A snap-strength picker alongside the
   quantization grid controls how hard notes snap to it (see below for
   why). The chords then play back (audibly, synthesized) for exactly
   the section's length while you play the melody over them -- no
   manual stop, it auto-finishes when the chords do. Space mid-take
   scraps it and restarts the count-in.
6. **Section Complete** -- Chord Chart view (bars + chord symbols,
   consecutive repeats of the same chord merged into one wider entry
   rather than listed twice) of what was captured, Re-record
   Chords/Melody, **+ Add Another Section** (records the next section
   right away, saving all of them together on Finalize), or Finalize
   (writes the chart JSON to your songs folder). Changing melody
   quantization/snap-strength here re-derives it from raw MIDI too (no
   tempo picker here though -- see SectionComplete.jsx's own docstring
   for why that's a deliberate boundary, not an oversight).
7. **Song view** -- click a song in My Songs to see every section's chord
   chart and a simple piano-roll of its melody (time left-to-right, pitch
   low-to-high; not real notation, see below), a Play button that plays
   the whole song back (all sections, chords + melody together), an
   editable tempo (every chord/melody beat is stored in beats, not
   seconds, so this only ever changes future playback speed -- nothing
   about the recorded data itself needs to change), a quantization
   picker (re-snaps the saved chart to a new grid, no re-recording), a
   time signature picker (see above), an optional metronome for playback
   (off by default -- "hear the song," not a take -- on by request, e.g.
   to follow along precisely), **+ Add Section** (appends a new section
   to this already-saved song), Re-record Chords/Melody for *any*
   section, not just the last (see below for how), and **Delete Song**
   (a native `confirm()` prompt, not just a styled button -- there's no
   undo once a chart file is gone; `songStorage.js`'s `deleteChartFile`
   just calls the folder handle's own `removeEntry`).

**Multi-section songs lay out sequentially on one shared beat timeline**
(section B starts exactly where A ends) -- both "add a section" entry
points (mid-recording and from an already-saved song's Song view) go
through the exact same append logic (`songStorage.js`'s
`appendSectionData`). Any section can be re-recorded, not just the last:
re-recording a section in the middle shifts every later section's
start/end by the length delta (`songStorage.js`'s `replaceSectionData`).
That only works unambiguously because every chord/melody entry is tagged
with the section it belongs to right when it's written (`entry.section`)
-- otherwise a pickup note straddling a section boundary is genuinely
indistinguishable, by beat position alone, from a legitimate tail note of
the section before it. A chart saved before that tag existed falls back
to inferring it from beat position instead (`entrySectionLabel`), same as
it always effectively did.

**The Chord Chart view wraps into multiple rows once a section runs
long** -- capped at 8 bars per row (`chordChartLayout.js`) -- rather than
one row that just squeezes every chord narrower as the section grows.
Each chord's width is relative to a full row's capacity, not to its own
row's total, so a 2-bar chord is always twice as wide as a 1-bar chord
and twice as wide as a half-bar chord, consistently across every row.

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

**A screen's idle-screen setting pickers (quantization, snap strength,
the pickup checkbox, tempo, time signature) must force a fresh
`RecordingSession` when changed, not just update what's displayed** --
`useRecordingSession.js` only ever reads its settings once, at
construction (a plain lazy-ref singleton, React's own documented pattern
for "build this once without `useEffect`"), so changing one of these on
`RecordChords`/`RecordMelody`'s own idle screen updated the picker itself
and the eventually-saved chart, but silently left the *actual upcoming
take* still using whatever was set when that screen first mounted -- a
real bug this project shipped once. The fix is a React `key` on
`<RecordChords>`/`<RecordMelody>` in `RecordSongFlow.jsx`, keyed on
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
rebase was missing) without Section A ever showing the bug. Also: the
Chord Chart panel's row wrapping (`chordChartLayout.js`, above) caps rows
by bar count, not pixel width -- CSS `flex-wrap` on `.chord-bar-row` is a
safety net under that, for the case where enough short chords' `min-width`
floors alone add up past the panel's actual width even within one
nominally-fitting row.

**Slash chords are detected from the chords pass itself, not a separate
take** (`detectChords`/`isolatedBassPitchClass` in theory.js) -- the
notes at the very bottom of a struck cluster are read as a distinct
"bass note" whenever they're a single note or that same note doubled
an octave (or several) up, exactly what a left hand plays as a bass
note under a right-hand voicing. Two shapes are recognized: the bass
note can be one of the chord's own tones just voiced lowest (a genuine
inversion, e.g. E-G-C read as `C/E`) -- the combined pitch-class set
already spells a known chord, so this is tried first, and also quietly
covers a doubled root under a full chord (no slash, since bass equals
root) -- or the bass can be *foreign* to the chord entirely (e.g. a C
triad over a D bass, common in hymns/pop, written `C/D`), where the
combined set spells nothing recognizable but the notes above the
isolated bass, on their own, do. A walking bass under one held chord
(`C`, then `C/E`, then `C/G`) is treated as a real chord change, not a
repeat, for exactly the same reason slash notation exists in the first
place. Playback (`voiceChordSimple`) adds the bass note back in a full
octave below the rest of the voicing, both for song playback and for
the chords heard playing under you while recording the melody pass.

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
                          (chords + melody together, no count-in, plus
                          an optional metronome)
  songStorage.js          File System Access I/O + the on-disk chart
                          JSON shape (matches pianobot.charts.simple_format)
                          + the pure section-composition logic (build,
                          append, replace any section, re-quantize)
  chordChartLayout.js     pure: split a section's chords into display
                          rows capped at a max bar count each, with
                          proportional (not per-row-relative) widths
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
