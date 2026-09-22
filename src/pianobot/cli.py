from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from .pipeline import run_pipeline

app = typer.Typer(add_completion=False, help="Turn a song audio file into a piano-arrangement MIDI file.")
console = Console()


@app.command()
def convert(
    audio: Path = typer.Argument(..., exists=True, help="Input song audio file (wav/mp3/...)."),
    output: Path = typer.Option(None, "-o", "--output", help="Output MIDI path. Defaults to <audio-stem>.mid"),
    work_dir: Path = typer.Option(None, "--work-dir", help="Directory for stems/intermediate analysis. Defaults to ./.pianobot/<audio-stem>"),
    tempo: float = typer.Option(120.0, "--tempo", help="Tempo (BPM) written into the MIDI file's initial tempo event."),
) -> None:
    """Run the full pipeline: stems -> melody/chords/structure -> MIDI."""
    output = output or audio.with_suffix(".mid")
    work_dir = work_dir or Path(".pianobot") / audio.stem

    console.print(f"[bold]PianoBot5000[/bold]: {audio} -> {output}")
    console.print(f"  work dir: {work_dir}")

    result_path = run_pipeline(audio_path=audio, work_dir=work_dir, out_path=output, tempo=tempo)

    console.print(f"[green]Wrote {result_path}[/green]")


if __name__ == "__main__":
    app()
