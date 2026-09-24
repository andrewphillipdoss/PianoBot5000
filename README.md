# PianoBot5000

Song audio in, piano-arrangement MIDI out: left hand plays beat-snapped
chord triads, right hand plays a cleaned-up monophonic melody line, and
song sections are written in as MIDI markers.

```
Song audio
  -> Demucs (stem separation: vocals / drums / bass / other)
      -> Basic Pitch on vocals -> monophonic, beat-quantized melody   (right hand)
      -> Chordino on bass+other -> triads snapped to the beat grid    (left hand)
      -> allin1 -> beats + sections, sections grouped into A/B/C...   (markers)
  -> pretty_midi assembly -> piano MIDI file
```

Each ML stage is an existing open-source model wrapped in its own
module; each "code we'd write" box (cleanup, voicing, labeling,
assembly) is plain Python with no ML dependency, so it can be unit
tested without any model installed.

See [`docs/pipeline-roadmap.html`](docs/pipeline-roadmap.html) for two
concrete, not-yet-built next steps (swing-aware quantization, and
consolidating repeated sections into one learned pattern) and the
longer-term idea behind them. Download and open it in a browser to
view it rendered — GitHub only shows its source.

## Project layout

```
src/pianobot/
  types.py        data contracts shared between stages (NoteEvent, ChordEvent, Beat, Section, ...)
  stems.py         Demucs wrapper
  melody.py        Basic Pitch wrapper + monophonic/quantize cleanup
  chords.py        Chordino (vamp) wrapper + beat-snapped, voice-led triad voicing
  structure.py     allin1 wrapper + A/B/C repeat labeling
  assemble.py      pretty_midi assembly -> .mid file
  pipeline.py      orchestrates the stages, caches intermediate JSON per stage
  cli.py           `pianobot` CLI entrypoint (Typer)
  synth.py         synthetic test-song generator (no real audio file needed)
tests/             unit tests for the non-ML stages + chord-label parsing
```

Also usable as a library — every stage module is a plain function you
can import and call directly (`from pianobot import melody, chords, ...`).

## Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"          # core + pretty_midi/typer/rich + pytest, no ML models yet
```

Each model stage is an optional extra, since they have very different
weight and install stories:

```bash
pip install -e ".[melody]"       # Basic Pitch -- CPU-friendly, weights ship in the pip package
pip install -e ".[stems]"        # Demucs -- pulls torch, downloads ~80-300MB of weights on first run
pip install -e ".[structure]"    # allin1 -- pulls torch, downloads weights on first run
pip install -e ".[chords]"       # vamp python bindings only -- see Chordino setup below
pip install -e ".[all]"          # all four
```

### Chordino setup (extra step, not pip-installable)

Chord detection uses **Chordino**, part of the NNLS Chroma **Vamp
plugin** — this is a compiled audio-analysis plugin, not a Python
package, so `pip install` alone isn't enough:

1. `pip install -e ".[chords]"` installs the `vamp` Python host bindings.
2. Download and install the NNLS Chroma Vamp plugin for your OS from
   https://www.vamp-plugins.org/download.html#nnls-chroma into your
   system's Vamp plugin path:
   - Linux: `~/vamp/` or `/usr/local/lib/vamp/`
   - macOS: `~/Library/Audio/Plug-Ins/Vamp/`
   - Windows: `%ProgramFiles%\Vamp Plugins\`
3. Verify it's found:
   ```bash
   python -c "import vamp; print('nnls-chroma:chordino' in vamp.list_plugins())"
   ```

If you'd rather avoid the system-plugin step, `pianobot/chords.py` is
written as a single-purpose module behind the same `ChordEvent`
interface everything else consumes — swapping in `madmom` or another
chord estimator later only means rewriting `extract_chords()`.

### macOS install notes (especially Intel Macs)

**Use Python 3.10, 3.11, or 3.12 — not 3.13 or 3.14.** PyTorch (needed
by `stems`/Demucs and `structure`/allin1) dropped Intel-macOS (x86_64)
wheels entirely after 2.2.2, and that last x86_64-compatible release
only has wheels up to Python 3.12 — there is no working combination of
newer Python + Intel Mac + torch. Apple Silicon Macs aren't affected by
this specific issue, but 3.10-3.12 is still the safest bet for wheel
coverage across the whole ML stack generally.

Given that, `pip install -e ".[stems]"` / `".[structure]"` pin
`torch<2.3` automatically on Intel Macs (via an environment marker in
`pyproject.toml` — it's a no-op everywhere else), and `".[melody]"`
pins `numba<0.63` for the same reason (numba also dropped Intel-macOS
wheels in later releases; `basic-pitch` pulls it in transitively via
`librosa`). You shouldn't need to do anything extra for either — just
make sure your venv's Python is 3.10-3.12.

**`vamp` (the `[chords]` extra) may fail with "Failed to build 'vamp'
when getting requirements to build wheel."** Its `setup.py` imports
`numpy` directly without declaring it as a build dependency, so pip's
isolated build environment doesn't have it. Fix:
```bash
pip install --no-build-isolation vamp
pip install -e ".[chords]"
```
(requires numpy already installed in your venv, which `".[dev]"` gives you).

## Usage

```bash
pianobot convert path/to/song.mp3 -o song.mid
```

Options: `--work-dir` (where stems + intermediate analysis JSON are
cached, default `./.pianobot/<song-name>/`), `--tempo` (BPM written
into the MIDI file), `--subdivisions-per-beat` (melody quantization
grid resolution — default 4, i.e. 16th notes; raise it if a fast vocal
run is getting collapsed/dropped, lower it if the melody sounds
fussy/jittery from picking up transcription noise as real rhythm; see
`melody.clean_melody`'s docstring for the full tradeoff). Note this
grid is always "straight" (evenly subdivided) — it doesn't attempt to
detect or preserve a swing feel.

Re-running on the same song reuses cached stems/analysis instead of
re-running the models — handy for iterating on `assemble.py` or the
cleanup/voicing logic without waiting on Demucs/allin1 again. Delete
the relevant file under `<work-dir>/analysis/` (or the whole work dir)
to force a stage to re-run.

### Debugging: run one stage at a time

If `convert` doesn't produce what you expect, run each stage on its
own and inspect its output before moving to the next — much faster
than guessing which of the four models is at fault:

```bash
pianobot stems     song.mp3   # Demucs: prints where vocals/drums/bass/other.wav landed
pianobot structure song.mp3   # allin1: prints beat/downbeat count + detected sections
pianobot melody    song.mp3   # Basic Pitch: prints the raw, then cleaned-up melody notes
pianobot chords    song.mp3   # Chordino: prints the raw, then beat-snapped/voiced chords
pianobot assemble  song.mp3 -o song.mid   # no models -- just builds the MIDI from what's cached
```

Every one of these (plus `convert`) reads and writes the same on-disk
cache under `<work-dir>/analysis/`, so you can run them in any order,
any number of times, and mix them freely with full `convert` runs —
whatever's already cached gets reused instead of recomputed. `melody`
and `chords` will show you raw model output immediately even before
`structure` has run; they just can't show the beat-quantized/snapped
version until there's a beat grid to snap onto. `assemble` is the odd
one out: it never touches a model, so it's instant and is the fastest
way to experiment with the final MIDI-writing step, as long as
`structure`, `melody`, and `chords` have each been run at least once
first (in any order).

### No song file yet? Generate a synthetic one

```bash
python -c "from pianobot.synth import generate_synthetic_song; generate_synthetic_song('synthetic.wav')"
pianobot convert synthetic.wav -o synthetic.mid
```

`synth.py` generates a short toy "song" (a vibrato melody line over a
chord pad and a kick pulse) at a known tempo/chord progression, so you
can sanity-check each model's output against ground truth instead of
just "it didn't crash."

## Testing

```bash
pytest
```

The test suite only covers the non-ML stages (melody cleanup, chord
snapping/voicing, section labeling, MIDI assembly) plus the Chordino
label parser — these run anywhere, no models or plugin binaries
required. There isn't yet an end-to-end test that runs the real
Demucs/Basic Pitch/Chordino/allin1 models, since that needs all four
installed (see above).

## Status / what's been verified so far

Built and run in a sandboxed, no-GPU container with PyPI access but
**no access to model-weight hosts** (huggingface.co,
dl.fbaipublicfiles.com are blocked by that environment's network
policy) — this is specific to that container, not a requirement of
the project itself:

- All non-ML logic (cleanup, voicing, labeling, MIDI assembly) — unit
  tested, passing.
- Basic Pitch — installed and ran end-to-end (its weights ship inside
  the pip package, no separate download needed).
- Demucs — installs and imports fine; weight download blocked in that
  sandbox. Should work normally with regular internet access.
- allin1 — not yet attempted; same weight-download constraint expected.
- Chordino — needs the manual Vamp-plugin install described above,
  which isn't attemptable in a throwaway container; parsing/voicing
  logic is unit tested against synthetic Harte-label fixtures instead.

Next step on a real machine: `pip install -e ".[all]"`, do the
Chordino plugin install, and run `pianobot` on a real song file to see
the first true end-to-end output.
