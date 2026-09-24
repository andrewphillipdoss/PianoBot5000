"""The `pianobot` command-line tool.

Commands:
  pianobot chart CHART_FILE [-o OUT] [--key KEY] [--style STYLE] [--tempo BPM]
      The primary path: render a hand-authored (or imported) chord/
      melody chart straight to a piano-arrangement MIDI file. No audio,
      no ML models -- see examples/practice-changes.json for the chart
      format, and pianobot/charts/simple_format.py's docstring for the
      full schema.

  pianobot transcribe ...
      The original audio-to-MIDI pipeline (Demucs/Basic Pitch/Chordino/
      allin1) -- kept as an optional mode for when you actually want to
      guess a chart from a recording instead of starting from a known
      one. Run `pianobot transcribe --help` for its own commands.
"""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from . import assemble as assemble_stage
from .charts import simple_format
from .charts.arrange import render_to_midi_inputs
from .charts.transpose import transpose_chart
from .transcribe.cli import app as transcribe_app

app = typer.Typer(add_completion=False, help="Turn a chord/melody chart into a piano-arrangement MIDI file.")
console = Console()

app.add_typer(
    transcribe_app, name="transcribe",
    help="Legacy audio-transcription pipeline (Demucs/Basic Pitch/Chordino/allin1).",
)


@app.command()
def chart(
    chart_file: Path = typer.Argument(..., exists=True, help="Chart JSON file, e.g. examples/practice-changes.json"),
    output: Path = typer.Option(None, "-o", "--output", help="Output MIDI path. Defaults to <chart-stem>.mid"),
    key: str = typer.Option(None, "--key", help="Transpose to this key before rendering, e.g. --key Eb. Defaults to the chart's own key."),
    style: str = typer.Option("simple", "--style", help="Left-hand arrangement style. Only 'simple' (block triads) is implemented so far."),
    tempo: float = typer.Option(None, "--tempo", help="Override the chart's own tempo (BPM)."),
) -> None:
    """Render a chart to a piano-arrangement MIDI file."""
    output = output or chart_file.with_suffix(".mid")
    loaded = simple_format.load_chart(chart_file)
    if key:
        loaded = transpose_chart(loaded, key)
    if tempo is not None:
        loaded.tempo = tempo

    console.print(f"[bold]PianoBot5000[/bold]: {chart_file} ({loaded.title!r}, key {loaded.key}) -> {output}")

    melody_notes, chord_notes, sections = render_to_midi_inputs(loaded, style=style)
    pm = assemble_stage.assemble_midi(melody_notes, chord_notes, sections, tempo=loaded.tempo)
    result_path = assemble_stage.write_midi(pm, output)

    console.print(f"[green]Wrote {result_path}[/green] "
                  f"({len(melody_notes)} melody notes, {len(chord_notes)} chord notes, {len(sections)} sections)")


# This `if` block only runs if you execute this file *directly*
# (e.g. `python cli.py`), not when it's imported by something else
# (like the `pianobot` console-script entry point declared in
# pyproject.toml, which imports `app` and calls it a different way).
if __name__ == "__main__":
    app()
