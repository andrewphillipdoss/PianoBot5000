"""The `pianobot` command-line tool.

Beginner note: this file is the "front door" to the whole project --
it's what actually runs when you type `pianobot song.mp3 -o out.mid`
in a terminal. It doesn't do any of the real work itself; it just
reads the command-line arguments the user typed, prints a couple of
friendly status messages, and calls `run_pipeline` (from pipeline.py)
to do everything else.
"""

from __future__ import annotations

from pathlib import Path

# Typer is a library that turns a plain Python function into a full
# command-line tool -- reading arguments/options, generating --help
# text, validating types, etc. -- based on the function's own
# parameter names and type hints.
import typer
# Rich is a library for nicer-looking terminal output (colors, bold
# text, etc.) than Python's plain built-in `print`.
from rich.console import Console

from .pipeline import run_pipeline

# `typer.Typer()` creates the command-line app object itself.
# `add_completion=False` turns off Typer's shell-autocomplete-install
# prompts, which aren't useful for a small prototype like this.
app = typer.Typer(add_completion=False, help="Turn a song audio file into a piano-arrangement MIDI file.")
# One shared Console instance for all of our printed output, reused
# below in the `convert` function.
console = Console()


# The `@app.command()` decorator registers the function right below it
# as a command Typer's CLI can run. Since this is currently the *only*
# registered command, Typer lets you invoke it without naming it
# explicitly -- i.e. `pianobot song.mp3` works directly, you don't need
# to type `pianobot convert song.mp3`.
@app.command()
def convert(
    # Typer reads each parameter's type hint and default value to
    # figure out how to parse it from the command line, and what kind
    # of --help text to generate.
    #
    # `typer.Argument(...)` marks this as a required, un-named
    # (positional) argument -- e.g. `pianobot myfile.mp3`. `...`
    # (Python's "Ellipsis" object) is Typer's convention for "this has
    # no default; it's required." `exists=True` makes Typer
    # automatically check the file exists and show a clean error if not,
    # rather than letting our own code crash on a missing file later.
    audio: Path = typer.Argument(..., exists=True, help="Input song audio file (wav/mp3/...)."),
    # `typer.Option(...)` marks these as optional, named flags -- e.g.
    # `-o out.mid` or `--output out.mid`. Passing `None` as the default
    # means "if the user doesn't specify one, leave it as None", which
    # we then fill in with a sensible computed default just below.
    output: Path = typer.Option(None, "-o", "--output", help="Output MIDI path. Defaults to <audio-stem>.mid"),
    work_dir: Path = typer.Option(None, "--work-dir", help="Directory for stems/intermediate analysis. Defaults to ./.pianobot/<audio-stem>"),
    tempo: float = typer.Option(120.0, "--tempo", help="Tempo (BPM) written into the MIDI file's initial tempo event."),
) -> None:
    """Run the full pipeline: stems -> melody/chords/structure -> MIDI."""
    # `output or audio.with_suffix(".mid")` means: if `output` is
    # falsy (None, since the user didn't pass -o), fall back to
    # swapping the input file's extension for ".mid" -- e.g.
    # "song.mp3" -> "song.mid" -- and use that instead.
    output = output or audio.with_suffix(".mid")
    # Similarly, default the work directory to ".pianobot/<song-name>"
    # in the current folder if the user didn't specify --work-dir.
    work_dir = work_dir or Path(".pianobot") / audio.stem

    # Rich's Console.print understands a small markup language for
    # styling -- [bold]...[/bold] makes that text bold in the terminal,
    # [green]...[/green] colors it green, and so on.
    console.print(f"[bold]PianoBot5000[/bold]: {audio} -> {output}")
    console.print(f"  work dir: {work_dir}")

    # This is the actual pipeline call -- everything above was just
    # figuring out what arguments to pass it. See pipeline.py for what
    # happens next.
    result_path = run_pipeline(audio_path=audio, work_dir=work_dir, out_path=output, tempo=tempo)

    console.print(f"[green]Wrote {result_path}[/green]")


# This `if` block only runs if you execute this file *directly*
# (e.g. `python cli.py`), not when it's imported by something else
# (like the `pianobot` console-script entry point declared in
# pyproject.toml, which imports `app` and calls it a different way).
# It's a standard Python idiom for "let this file be both an importable
# module and a directly-runnable script."
if __name__ == "__main__":
    app()
