"""The `pianobot` command-line tool.

Beginner note: this file is the "front door" to the whole project --
it's what actually runs when you type `pianobot ...` in a terminal.
It doesn't do any of the real work itself; it just reads the
command-line arguments the user typed, prints friendly status/preview
output, and calls into pipeline.py (and the individual stage modules)
to do everything else.

Commands:
  pianobot convert AUDIO [-o OUT] [--work-dir DIR] [--tempo BPM]
      Run the whole pipeline end to end and write a MIDI file. This is
      the one you actually want day to day.

  pianobot stems AUDIO [--work-dir DIR]
  pianobot structure AUDIO [--work-dir DIR]
  pianobot melody AUDIO [--work-dir DIR]
  pianobot chords AUDIO [--work-dir DIR]
  pianobot assemble AUDIO [-o OUT] [--work-dir DIR] [--tempo BPM]
      Run ONE stage at a time and print a preview of what it found, so
      you can tell exactly which stage is misbehaving if `convert`
      doesn't produce what you expect. Each of these reads/writes the
      *same* on-disk cache under <work-dir>/analysis/ that `convert`
      uses, so you can freely mix step-by-step runs with full
      `convert` runs -- anything already cached gets reused, not
      recomputed. `assemble` is the exception: it never runs any
      model itself, it only reads whatever `structure`/`melody`/
      `chords` already cached, so it's instant and is the fastest way
      to experiment with the final MIDI-writing step in assemble.py.
"""

from __future__ import annotations

from pathlib import Path

# Typer is a library that turns plain Python functions into a full
# command-line tool -- reading arguments/options, generating --help
# text, validating types, etc. -- based on each function's own
# parameter names and type hints. With more than one @app.command(),
# Typer requires you to name the command, e.g. `pianobot stems song.mp3`.
import typer
# Rich is a library for nicer-looking terminal output (colors, bold
# text, etc.) than Python's plain built-in `print`.
from rich.console import Console

from . import chords as chords_stage
from . import melody as melody_stage
from . import pipeline
from . import stems as stems_stage
from . import structure as structure_stage
from .pipeline import run_pipeline

app = typer.Typer(add_completion=False, help="Turn a song audio file into a piano-arrangement MIDI file.")
console = Console()

# MIDI pitch 0-11 (mod 12) maps onto these note names, repeating every
# octave -- e.g. MIDI 60 is 60 % 12 = 0 -> "C", in octave 60 // 12 - 1 = 4 -> "C4".
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _note_name(midi_pitch: int) -> str:
    """MIDI note number -> human-readable name, e.g. 60 -> "C4"."""
    return f"{_NOTE_NAMES[midi_pitch % 12]}{midi_pitch // 12 - 1}"


def _default_work_dir(audio: Path) -> Path:
    """Where stems/analysis get cached if the user doesn't pass --work-dir."""
    return Path(".pianobot") / audio.stem


def _preview(items: list, formatter, limit: int = 15) -> None:
    """Print up to `limit` formatted items, then say how many more there are."""
    for item in items[:limit]:
        console.print(f"  {formatter(item)}")
    if len(items) > limit:
        console.print(f"  ... and {len(items) - limit} more")


# Shared option definitions, reused by every command below so
# --work-dir means exactly the same thing (and has the exact same
# --help text) everywhere.
_AUDIO_ARG = typer.Argument(..., exists=True, help="Input song audio file (wav/mp3/...).")
_WORK_DIR_OPT = typer.Option(None, "--work-dir", help="Directory for stems/intermediate analysis. Defaults to ./.pianobot/<audio-stem>")
_SUBDIVISIONS_OPT = typer.Option(
    4, "--subdivisions-per-beat",
    help="Melody quantization grid resolution: 4 = 16th notes, 2 = 8th notes, 1 = beats only. "
         "Raise it if a fast vocal run is getting collapsed/dropped; lower it if the melody "
         "sounds fussy/jittery (picking up Basic Pitch's timing noise as real rhythm). "
         "See melody.clean_melody's docstring for the full tradeoff.",
)


@app.command()
def convert(
    audio: Path = _AUDIO_ARG,
    output: Path = typer.Option(None, "-o", "--output", help="Output MIDI path. Defaults to <audio-stem>.mid"),
    work_dir: Path = _WORK_DIR_OPT,
    tempo: float = typer.Option(120.0, "--tempo", help="Tempo (BPM) written into the MIDI file's initial tempo event."),
    subdivisions_per_beat: int = _SUBDIVISIONS_OPT,
) -> None:
    """Run the full pipeline: stems -> melody/chords/structure -> MIDI."""
    # `output or audio.with_suffix(".mid")` means: if `output` is
    # falsy (None, since the user didn't pass -o), fall back to
    # swapping the input file's extension for ".mid" -- e.g.
    # "song.mp3" -> "song.mid" -- and use that instead.
    output = output or audio.with_suffix(".mid")
    work_dir = work_dir or _default_work_dir(audio)

    # Rich's Console.print understands a small markup language for
    # styling -- [bold]...[/bold] makes that text bold in the terminal,
    # [green]...[/green] colors it green, and so on.
    console.print(f"[bold]PianoBot5000[/bold]: {audio} -> {output}")
    console.print(f"  work dir: {work_dir}")

    # This is the actual pipeline call -- everything above was just
    # figuring out what arguments to pass it. See pipeline.py for what
    # happens next.
    result_path = run_pipeline(
        audio_path=audio, work_dir=work_dir, out_path=output, tempo=tempo,
        subdivisions_per_beat=subdivisions_per_beat,
    )

    console.print(f"[green]Wrote {result_path}[/green]")


@app.command()
def stems(audio: Path = _AUDIO_ARG, work_dir: Path = _WORK_DIR_OPT) -> None:
    """Stage 1 only: run Demucs and print where each separated stem landed.

    Useful on its own to (a) trigger Demucs' one-time model-weight
    download ahead of time, and (b) let you open vocals.wav/bass.wav/
    etc. in an audio player to sanity-check the separation quality
    before trusting anything downstream of it.
    """
    work_dir = work_dir or _default_work_dir(audio)
    console.print(f"[bold]Separating stems[/bold] for {audio} ...")
    stem_set = stems_stage.separate_stems(audio, work_dir)
    console.print("[green]Done.[/green] Stems written to:")
    for name in ("vocals", "drums", "bass", "other"):
        console.print(f"  {name}: {getattr(stem_set, name)}")


@app.command()
def structure(audio: Path = _AUDIO_ARG, work_dir: Path = _WORK_DIR_OPT) -> None:
    """Stage 2 only: run allin1 (beats + sections) and print a summary."""
    work_dir = work_dir or _default_work_dir(audio)
    analysis_dir = pipeline.analysis_dir_for(work_dir)
    console.print(f"[bold]Analyzing structure[/bold] for {audio} ...")
    beats, raw_sections = pipeline.cache_json(
        analysis_dir / "structure.json", lambda: structure_stage.analyze_structure(audio)
    )
    sections = structure_stage.label_repeats(raw_sections)

    downbeat_count = sum(1 for b in beats if b.is_downbeat)
    console.print(f"[green]Found {len(beats)} beats[/green] ({downbeat_count} downbeats)")
    console.print(f"[green]Found {len(sections)} sections:[/green]")
    _preview(sections, lambda s: f"[{s.label}] {s.source_label!r}  {s.start:.2f}s - {s.end:.2f}s")


@app.command()
def melody(
    audio: Path = _AUDIO_ARG,
    work_dir: Path = _WORK_DIR_OPT,
    subdivisions_per_beat: int = _SUBDIVISIONS_OPT,
) -> None:
    """Stage 3 only: run Basic Pitch on the vocal stem and print the melody.

    Runs stem separation first if it hasn't been done yet (reused from
    cache if it has). If `structure` hasn't been run yet, the raw
    notes are still shown, but they won't be cleaned up/quantized
    since there's no beat grid to snap onto -- run `pianobot
    structure` first to see the fully cleaned melody.
    """
    work_dir = work_dir or _default_work_dir(audio)
    analysis_dir = pipeline.analysis_dir_for(work_dir)

    stem_set = stems_stage.separate_stems(audio, work_dir)
    console.print(f"[bold]Extracting melody[/bold] from {stem_set.vocals} ...")
    raw_notes = pipeline.cache_json(
        analysis_dir / "melody_raw.json", lambda: melody_stage.extract_melody_notes(stem_set.vocals)
    )
    console.print(f"[green]Basic Pitch found {len(raw_notes)} raw notes[/green] (before cleanup)")

    structure_cache = analysis_dir / "structure.json"
    if not structure_cache.exists():
        console.print("[yellow]No cached structure.json yet -- run 'pianobot structure' first "
                       "to see the cleaned-up, beat-quantized melody.[/yellow]")
        _preview(raw_notes, lambda n: f"{_note_name(n.pitch)}  {n.start:.2f}s - {n.end:.2f}s  vel={n.velocity}")
        return

    beats, _sections = pipeline.load_json(structure_cache)
    cleaned = melody_stage.clean_melody(raw_notes, beats, subdivisions_per_beat)
    console.print(f"[green]Cleaned up to {len(cleaned)} monophonic, quantized notes:[/green]")
    _preview(cleaned, lambda n: f"{_note_name(n.pitch)}  {n.start:.2f}s - {n.end:.2f}s  vel={n.velocity}")


@app.command()
def chords(audio: Path = _AUDIO_ARG, work_dir: Path = _WORK_DIR_OPT) -> None:
    """Stage 4 only: run Chordino on the bass+other mix and print the chords.

    Runs stem separation first if it hasn't been done yet (reused from
    cache if it has). If `structure` hasn't been run yet, the raw
    chords are still shown, but they won't be snapped to the beat grid
    or voiced into triads -- run `pianobot structure` first to see the
    final left-hand voicing.
    """
    work_dir = work_dir or _default_work_dir(audio)
    analysis_dir = pipeline.analysis_dir_for(work_dir)

    stem_set = stems_stage.separate_stems(audio, work_dir)
    harmonic_mix = pipeline.write_harmonic_mix(stem_set, work_dir)
    console.print(f"[bold]Detecting chords[/bold] from {harmonic_mix} ...")
    raw_chords = pipeline.cache_json(
        analysis_dir / "chords_raw.json", lambda: chords_stage.extract_chords(harmonic_mix)
    )
    console.print(f"[green]Chordino found {len(raw_chords)} raw chord segments[/green] (before beat-snapping)")

    def _fmt_chord(c) -> str:
        return f"{_NOTE_NAMES[c.root_pitch_class]}:{c.quality}  {c.start:.2f}s - {c.end:.2f}s"

    structure_cache = analysis_dir / "structure.json"
    if not structure_cache.exists():
        console.print("[yellow]No cached structure.json yet -- run 'pianobot structure' first "
                       "to see beat-snapped chords and their left-hand triad voicing.[/yellow]")
        _preview(raw_chords, _fmt_chord)
        return

    beats, _sections = pipeline.load_json(structure_cache)
    snapped = chords_stage.snap_chords_to_beats(raw_chords, beats)
    console.print(f"[green]Snapped to {len(snapped)} beat-aligned chords:[/green]")
    _preview(snapped, _fmt_chord)

    triads = chords_stage.voice_triads(snapped)
    console.print(f"[green]Voiced as {len(triads)} left-hand notes ({len(snapped)} triads x 3 notes each)[/green]")


@app.command()
def assemble(
    audio: Path = _AUDIO_ARG,
    output: Path = typer.Option(None, "-o", "--output", help="Output MIDI path. Defaults to <audio-stem>.mid"),
    work_dir: Path = _WORK_DIR_OPT,
    tempo: float = typer.Option(120.0, "--tempo", help="Tempo (BPM) written into the MIDI file's initial tempo event."),
    subdivisions_per_beat: int = _SUBDIVISIONS_OPT,
) -> None:
    """Stage 5 only: build the final MIDI file purely from already-cached
    structure/melody/chords analysis -- runs no models at all, so it's
    instant. Handy for iterating on assemble.py without waiting on
    Demucs/Basic Pitch/Chordino/allin1 every time. Requires
    `structure`, `melody`, and `chords` to have already been run (in
    any order) so their results are cached under <work-dir>/analysis/.
    """
    work_dir = work_dir or _default_work_dir(audio)
    output = output or audio.with_suffix(".mid")
    analysis_dir = pipeline.analysis_dir_for(work_dir)

    required = {
        "structure.json": "pianobot structure",
        "melody_raw.json": "pianobot melody",
        "chords_raw.json": "pianobot chords",
    }
    missing = [(f, cmd) for f, cmd in required.items() if not (analysis_dir / f).exists()]
    if missing:
        console.print("[red]Missing cached analysis -- run these first:[/red]")
        for f, cmd in missing:
            console.print(f"  {f} is missing -- run: {cmd} {audio}")
        raise typer.Exit(code=1)

    # We already confirmed all three cache files exist above, so just
    # load them straight back with `load_json` -- no need to fall back
    # to re-running any model here.
    beats, raw_sections = pipeline.load_json(analysis_dir / "structure.json")
    sections = structure_stage.label_repeats(raw_sections)
    raw_melody = pipeline.load_json(analysis_dir / "melody_raw.json")
    clean_melody_notes = melody_stage.clean_melody(raw_melody, beats, subdivisions_per_beat)
    raw_chords = pipeline.load_json(analysis_dir / "chords_raw.json")
    snapped_chords = chords_stage.snap_chords_to_beats(raw_chords, beats)
    chord_notes = chords_stage.voice_triads(snapped_chords)

    from . import assemble as assemble_stage
    pm = assemble_stage.assemble_midi(clean_melody_notes, chord_notes, sections, tempo=tempo)
    result_path = assemble_stage.write_midi(pm, output)
    console.print(f"[green]Wrote {result_path}[/green] "
                  f"({len(clean_melody_notes)} melody notes, {len(chord_notes)} chord notes, {len(sections)} sections)")


# This `if` block only runs if you execute this file *directly*
# (e.g. `python cli.py`), not when it's imported by something else
# (like the `pianobot` console-script entry point declared in
# pyproject.toml, which imports `app` and calls it a different way).
# It's a standard Python idiom for "let this file be both an importable
# module and a directly-runnable script."
if __name__ == "__main__":
    app()
