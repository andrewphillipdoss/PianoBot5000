"""Chordino returns Harte-notation chord labels (e.g. "C:maj", "A:min7",
"N"). This parsing logic is pure and testable without the vamp host or
the Chordino plugin binary being installed.

Beginner note: "pure" here means the function being tested
(`_parse_harte_label`) only looks at the text you hand it and returns
an answer -- no files, no network calls, no randomness. That makes it
trivial to test with plain input/output examples, unlike the actual
Chordino model call, which needs the real plugin installed and an
audio file to analyze.
"""

from __future__ import annotations

import pytest

# Note the leading underscore: `_parse_harte_label` is meant as an
# "internal" helper inside chords.py (see the comment about leading
# underscores in stems.py). Importing and testing it directly anyway
# is a reasonable choice here, since this parsing logic has several
# tricky edge cases (like the Bb-vs-BB case-sensitivity bug we found
# and fixed) that are worth pinning down with their own tests.
from pianobot.chords import _parse_harte_label


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
    pc, quality = _parse_harte_label(label)
    assert pc == expected_pc
    assert quality == expected_quality
