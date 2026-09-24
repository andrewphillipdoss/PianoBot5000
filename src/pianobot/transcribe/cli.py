"""The `pianobot transcribe` command group -- the original audio-to-MIDI
pipeline (Demucs/Basic Pitch/Chordino/allin1), kept around as an
optional mode. See the top-level pianobot/cli.py for the project's
current primary path (`pianobot chart ...`), which starts from a known
chart instead of trying to guess one from a recording.

Commands (unchanged from before this became a sub-app -- just moved):
  pianobot transcribe convert AUDIO [-o OUT] [--work-dir DIR] [--tempo BPM]
      Run the whole pipeline end to end and write a MIDI file.

  pianobot transcribe stems AUDIO [--work-dir DIR]
  pianobot transcribe structure AUDIO [--work-dir DIR]
  pianobot transcribe melody AUDIO [--work-dir DIR]
  pianobot transcribe chords AUDIO [--work-dir DIR]
  pianobot transcribe assemble AUDIO [-o OUT] [--work-dir DIR] [--tempo BPM]
      Run ONE stage at a time and print a preview of what it found.
      Each of these reads/writes the same on-disk cache under
      <work-dir>/analysis/ that `convert` uses.
"""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from ..theory import NOTE_NAMES
from . import chords as chords_stage
from . import melody as melody_stage
from . import pipeline
from . import stems as stems_stage
from . import structure as structure_stage
from .pipeline import run_pipeline

app = typer.Typer(add_completion=False, help="Legacy audio-transcription pipeline (Demucs/Basic Pitch/Chordino/allin1).")
console = Console()


def _note_name(midi_pitch: int) -> str:
    """MIDI note number -> human-readable name, e.g. 60 -> "C4"."""
    return f"{NOTE_NAMES[midi_pitch % 12]}{midi_pitch // 12 - 1}"


def _default_work_dir(audio: Path) -> Path:
    """Where stems/analysis get cached if the user doesn't pass --work-dir."""
    return Path(".pianobot") / audio.stem


def _preview(items: list, formatter, limit: int = 15) -> None:
    """Print up to `limit` formatted items, then say how many more there are."""
    for item in items[:limit]:
        console.print(f"  {formatter(item)}")
    if len(items) > limit:
        console.print(f"  ... and {len(items) - limit} more")


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
    output = output or audio.with_suffix(".mid")
    work_dir = work_dir or _default_work_dir(audio)

    console.print(f"[bold]PianoBot5000 (transcribe)[/bold]: {audio} -> {output}")
    console.print(f"  work dir: {work_dir}")

    result_path = run_pipeline(
        audio_path=audio, work_dir=work_dir, out_path=output, tempo=tempo,
        subdivisions_per_beat=subdivisions_per_beat,
    )

    console.print(f"[green]Wrote {result_path}[/green]")


@app.command()
def stems(audio: Path = _AUDIO_ARG, work_dir: Path = _WORK_DIR_OPT) -> None:
    """Stage 1 only: run Demucs and print where each separated stem landed."""
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
    """Stage 3 only: run Basic Pitch on the vocal stem and print the melody."""
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
        console.print("[yellow]No cached structure.json yet -- run 'pianobot transcribe structure' first "
                       "to see the cleaned-up, beat-quantized melody.[/yellow]")
        _preview(raw_notes, lambda n: f"{_note_name(n.pitch)}  {n.start:.2f}s - {n.end:.2f}s  vel={n.velocity}")
        return

    beats, _sections = pipeline.load_json(structure_cache)
    cleaned = melody_stage.clean_melody(raw_notes, beats, subdivisions_per_beat)
    console.print(f"[green]Cleaned up to {len(cleaned)} monophonic, quantized notes:[/green]")
    _preview(cleaned, lambda n: f"{_note_name(n.pitch)}  {n.start:.2f}s - {n.end:.2f}s  vel={n.velocity}")


@app.command()
def chords(audio: Path = _AUDIO_ARG, work_dir: Path = _WORK_DIR_OPT) -> None:
    """Stage 4 only: run Chordino on the bass+other mix and print the chords."""
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
        return f"{NOTE_NAMES[c.root_pitch_class]}:{c.quality}  {c.start:.2f}s - {c.end:.2f}s"

    structure_cache = analysis_dir / "structure.json"
    if not structure_cache.exists():
        console.print("[yellow]No cached structure.json yet -- run 'pianobot transcribe structure' first "
                       "to see beat-snapped chords and their left-hand triad voicing.[/yellow]")
        _preview(raw_chords, _fmt_chord)
        return

    beats, _sections = pipeline.load_json(structure_cache)
    snapped = chords_stage.snap_chords_to_beats(raw_chords, beats)
    console.print(f"[green]Snapped to {len(snapped)} beat-aligned chords:[/green]")
    _preview(snapped, _fmt_chord)

    from ..theory import voice_triads
    triads = voice_triads(snapped)
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
    structure/melody/chords analysis -- runs no models at all, so it's instant.
    """
    work_dir = work_dir or _default_work_dir(audio)
    output = output or audio.with_suffix(".mid")
    analysis_dir = pipeline.analysis_dir_for(work_dir)

    required = {
        "structure.json": "pianobot transcribe structure",
        "melody_raw.json": "pianobot transcribe melody",
        "chords_raw.json": "pianobot transcribe chords",
    }
    missing = [(f, cmd) for f, cmd in required.items() if not (analysis_dir / f).exists()]
    if missing:
        console.print("[red]Missing cached analysis -- run these first:[/red]")
        for f, cmd in missing:
            console.print(f"  {f} is missing -- run: {cmd} {audio}")
        raise typer.Exit(code=1)

    beats, raw_sections = pipeline.load_json(analysis_dir / "structure.json")
    sections = structure_stage.label_repeats(raw_sections)
    raw_melody = pipeline.load_json(analysis_dir / "melody_raw.json")
    clean_melody_notes = melody_stage.clean_melody(raw_melody, beats, subdivisions_per_beat)
    raw_chords = pipeline.load_json(analysis_dir / "chords_raw.json")
    snapped_chords = chords_stage.snap_chords_to_beats(raw_chords, beats)

    from ..theory import voice_triads
    chord_notes = voice_triads(snapped_chords)

    from .. import assemble as assemble_stage
    pm = assemble_stage.assemble_midi(clean_melody_notes, chord_notes, sections, tempo=tempo)
    result_path = assemble_stage.write_midi(pm, output)
    console.print(f"[green]Wrote {result_path}[/green] "
                  f"({len(clean_melody_notes)} melody notes, {len(chord_notes)} chord notes, {len(sections)} sections)")
