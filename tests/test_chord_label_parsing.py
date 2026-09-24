"""Chordino returns Harte-notation chord labels (e.g. "C:maj", "A:min7",
"N"). This parsing logic (now in theory.py, shared with the chart-based
path) is pure and testable without the vamp host or the Chordino
plugin binary being installed.

Beginner note: "pure" here means the function being tested
(`parse_harte_label`) only looks at the text you hand it and returns
an answer -- no files, no network calls, no randomness. That makes it
trivial to test with plain input/output examples, unlike the actual
Chordino model call, which needs the real plugin installed and an
audio file to analyze.
"""

from __future__ import annotations

import pytest

from pianobot.theory import parse_harte_label


# `@pytest.mark.parametrize` runs the same test function once for each
# row in the list below, plugging in that row's values as the named
# arguments. This is a compact way to write "one test, many examples"
# instead of copy-pasting the same test body eight times.
@pytest.mark.parametrize(
    "label,expected_pc,expected_quality",
    [
        ("C:maj", 0, "maj"),
        ("A:min", 9, "min"),
        ("G:7", 7, "maj"),  # dominant 7th -> major triad
        ("D:min7", 2, "min"),
        ("F#:dim", 6, "dim"),
        ("Bb:aug", 10, "aug"),
        ("N", None, "N"),
        ("", None, "N"),
    ],
)
def test_parse_harte_label(label, expected_pc, expected_quality):
    pc, quality = parse_harte_label(label)
    assert pc == expected_pc
    assert quality == expected_quality
