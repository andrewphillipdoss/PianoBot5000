"""Stem separation via Demucs.

Install: pip install "pianobot5000[stems]"
Demucs pulls in torch and downloads model weights (~80-300MB) on first
run; CPU inference works but is slow (a few minutes per song). A GPU
laptop will be much faster.

Beginner note: Demucs is a pre-trained AI model (someone else already
trained it on thousands of songs) that we call like a black box: we
give it an audio file, it gives us back four separate audio files
(vocals, drums, bass, everything else). We don't need to know how it
works internally -- we just need to know how to call it and what shape
of answer to expect back, which is what this file wraps up.
"""

# See types.py for what `from __future__ import annotations` does.
from __future__ import annotations

# `shutil` has filesystem helper functions; we only use `shutil.which`,
# which checks whether a command-line program (like ffmpeg) exists on
# the system PATH -- the same way typing its name in a terminal would
# find it.
import shutil
# `subprocess` lets Python launch and control another program, as if
# you'd typed a command into a terminal yourself. We use it to run
# Demucs as a separate command-line process.
import subprocess
# `sys` gives us access to interpreter details; we use `sys.executable`,
# the full path to the exact Python program currently running this
# script, so we can be sure we launch Demucs with the same Python
# environment (and thus the same installed packages) as us.
import sys
from pathlib import Path

# The `.` means "from this same package" -- i.e. from types.py, which
# sits right next to this file inside the pianobot/ folder.
from .types import StemSet

_MODEL = "htdemucs"  # the specific Demucs model to use; "htdemucs" splits audio into 4 stems: vocals, drums, bass, other
_STEM_NAMES = ("vocals", "drums", "bass", "other")  # the filenames (minus ".wav") Demucs writes out for that model


# A custom error type. It behaves exactly like Python's built-in
# RuntimeError, but having our own name means code elsewhere can catch
# "DemucsUnavailable" specifically, instead of catching every possible
# RuntimeError (which could hide unrelated bugs).
class DemucsUnavailable(RuntimeError):
    pass  # no extra behavior needed -- we just want a distinctly-named error


def separate_stems(audio_path: Path, work_dir: Path) -> StemSet:
    """Run Demucs on ``audio_path``, writing stems under ``work_dir``.

    Returns a StemSet pointing at the separated .wav files. Idempotent:
    if the expected outputs already exist under work_dir, reuses them.

    ("Idempotent" is a fancy way of saying: running this function
    twice on the same song produces the same result and doesn't
    redo expensive work the second time -- like how flipping a light
    switch to "on" twice in a row is the same as flipping it once.)
    """
    # `Path(...)` is safe to call even if `audio_path`/`work_dir` are
    # already Path objects -- it just hands them back unchanged. This
    # guards against a caller accidentally passing in a plain string.
    audio_path = Path(audio_path)
    work_dir = Path(work_dir)
    # The `/` operator between Path objects joins path segments, the
    # same way you'd type folder/subfolder/file by hand -- but it does
    # so correctly on both Linux/macOS (using "/") and Windows (using "\").
    # audio_path.stem is the filename without its extension, e.g. "song"
    # for "song.mp3" -- Demucs nests its output one folder per input file.
    out_dir = work_dir / "demucs" / _MODEL / audio_path.stem

    # `all(...)` returns True only if every item in the generator is
    # True. Here we check: does every expected stem .wav file already
    # exist? If even one is missing, we need to (re-)run Demucs.
    if not all((out_dir / f"{name}.wav").exists() for name in _STEM_NAMES):
        _run_demucs(audio_path, work_dir / "demucs")

    # Build and return the StemSet dataclass (defined in types.py) that
    # points at each separated file's path. Note: we don't check here
    # that these files actually exist -- if _run_demucs silently failed
    # to produce one, the problem would surface later when something
    # tries to open it, since that's simpler than duplicating checks.
    return StemSet(
        original=audio_path,
        vocals=out_dir / "vocals.wav",
        drums=out_dir / "drums.wav",
        bass=out_dir / "bass.wav",
        other=out_dir / "other.wav",
    )


# The leading underscore in `_run_demucs` is a Python convention (not
# a hard rule the language enforces) meaning "this is an internal
# helper -- other files shouldn't need to call it directly."
def _run_demucs(audio_path: Path, out_root: Path) -> None:
    try:
        # We only try to `import demucs` inside this function (rather
        # than at the top of the file) so that everything else in
        # PianoBot5000 keeps working even if Demucs isn't installed --
        # the ImportError only happens once someone actually tries to
        # separate stems.
        import demucs.separate  # noqa: F401 (imported only to check it's installed; we call it via subprocess below, not directly)
    except ImportError as exc:
        # `raise ... from exc` re-raises a new, friendlier error while
        # keeping a record of the original ImportError attached (so if
        # you print the full traceback, you can still see exactly what
        # Python complained about).
        raise DemucsUnavailable(
            "demucs is not installed. Run: pip install 'pianobot5000[stems]'"
        ) from exc

    # Make sure the output folder exists before Demucs tries to write
    # into it. `parents=True` creates any missing parent folders too;
    # `exist_ok=True` means "don't error if it's already there."
    out_root.mkdir(parents=True, exist_ok=True)
    # Build the command-line invocation as a list of strings, exactly
    # as if you'd typed:
    #   python -m demucs.separate -n htdemucs -o <out_root> <audio_path>
    # into a terminal. Using a list (instead of one big string) avoids
    # quoting/escaping bugs with filenames that contain spaces.
    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "-n",
        _MODEL,
        "-o",
        str(out_root),
        str(audio_path),
    ]
    # Actually launch Demucs as a subprocess and wait for it to finish.
    # capture_output=True collects whatever it prints instead of
    # spilling it into our own terminal; text=True gives us back that
    # output as a normal string rather than raw bytes.
    result = subprocess.run(cmd, capture_output=True, text=True)
    # A returncode of 0 means "the program exited successfully" (this
    # is a Unix/Linux/Windows-wide convention, not specific to Demucs).
    # Anything else means something went wrong.
    if result.returncode != 0:
        # Only show the last 4000 characters of stderr (Demucs' error
        # output) so one bad run doesn't flood the terminal with a
        # gigantic wall of text -- the useful error message is almost
        # always near the end anyway.
        raise RuntimeError(
            f"demucs failed (exit {result.returncode}):\n{result.stderr[-4000:]}"
        )


def is_available() -> bool:
    """Quick check: are the things Demucs needs actually installed?

    Handy to call before kicking off a long pipeline run, so you get a
    clear "you're missing X" message up front instead of a crash
    halfway through.
    """
    # `shutil.which("ffmpeg")` returns the path to ffmpeg if it's
    # installed and on the system PATH, or None if it can't be found.
    # Demucs needs ffmpeg to read/write most audio formats.
    return shutil.which("ffmpeg") is not None and _has_module("demucs")


def _has_module(name: str) -> bool:
    """True if the given Python package can be imported."""
    try:
        # `__import__("demucs")` does the same thing as writing
        # `import demucs`, but lets us pass the package name in as a
        # string/variable instead of hard-coding it in the syntax.
        __import__(name)
        return True
    except ImportError:
        return False
