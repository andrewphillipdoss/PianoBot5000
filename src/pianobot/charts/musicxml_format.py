"""Import a MusicXML lead sheet (chord symbols + melody) into a Chart.

Requires music21 (not part of the base install -- see pyproject.toml's
`charts-musicxml` extra):
    pip install "pianobot5000[charts-musicxml]"

This is meant for sheet music you already have legal access to (your
own scores, a purchased fake book export) -- same spirit as writing a
chart by hand in simple_format.py's JSON, just starting from notation
software's export instead of typing chords out yourself.

Beginner note: MusicXML is the standard file format notation programs
(MuseScore, Finale, Sibelius, Dorico) use to exchange sheet music.
`music21` is a well-established Python library (from MIT) that reads
it into a rich object model -- notes, chord symbols, key signatures,
tempo markings, and so on -- so this file's job is just to walk that
object model and re-shape it into our own ``types.Chart``.

Time units: music21 measures every note/chord's position in
"quarterLength" units -- quarter notes from the start of the piece,
regardless of the notated time signature. That's exactly what our
Chart's "beats" already mean (see types.Chart's docstring), so no unit
conversion is needed there at all, in any time signature. Tempo is the
one place a time-signature-aware conversion *is* needed -- a marking
like "dotted quarter = 80" in 6/8 doesn't mean 80 quarter notes per
minute, and music21's own ``getQuarterBPM()`` does that conversion
correctly, so we lean on it rather than re-deriving it ourselves.

Known limitations, deliberately out of scope for now:
  - Only the first part is read for melody and chords (set
    ``melody_part``/``chord_part`` to pick a different one) -- fine
    for the single-staff "melody + chords" lead-sheet idiom this is
    built for, not a full multi-instrument score.
  - Grace notes/ornaments are skipped rather than approximated.
  - Repeat signs/voltas are read as written, not "expanded" into the
    performed number of times through -- a practice chart usually
    shouldn't be doubled in length just because of a written repeat.
  - Sections come from rehearsal marks if the score has any, otherwise
    the whole piece becomes one section -- there's no attempt to guess
    song form (verse/chorus/...) from the music itself.
"""

from __future__ import annotations

from pathlib import Path

from ..theory import label_repeats, quality_from_chord_symbol
from ..types import Chart, ChordEvent, NoteEvent, Section

_DEFAULT_TEMPO = 120.0
_DEFAULT_VELOCITY = 90


class Music21Unavailable(RuntimeError):
    pass


def load_chart(path: Path, melody_part: int = 0, chord_part: int = 0) -> Chart:
    """Load a chart from a MusicXML file (.musicxml/.xml/.mxl) on disk."""
    try:
        import music21
    except ImportError as exc:
        raise Music21Unavailable(
            "music21 is not installed. Run: pip install 'pianobot5000[charts-musicxml]'"
        ) from exc

    path = Path(path)
    score = music21.converter.parse(str(path))
    return chart_from_score(music21, score, title=path.stem, melody_part=melody_part, chord_part=chord_part)


def chart_from_score(music21, score, title: str, melody_part: int = 0, chord_part: int = 0) -> Chart:
    """Build a Chart from an already-parsed music21 Score (split out
    from ``load_chart`` so tests can build one in memory, with no
    MusicXML file on disk at all).

    Takes the ``music21`` module itself as a parameter rather than
    importing it at module load time, so this file stays importable
    (for tests, or just `import pianobot.charts`) without music21
    installed -- only ``load_chart`` (the file-reading entry point)
    actually needs the real dependency.
    """
    flat = score.flatten()
    total_duration = float(flat.highestTime)

    if score.metadata and score.metadata.title:
        title = str(score.metadata.title)

    tempo_marks = flat.getElementsByClass(music21.tempo.MetronomeMark)
    tempo = float(tempo_marks[0].getQuarterBPM()) if tempo_marks else _DEFAULT_TEMPO

    key_name = _detect_key(music21, score, flat)

    sections = _extract_sections(music21, flat, total_duration)

    parts = list(score.parts) if getattr(score, "parts", None) else [score]
    melody_stream = parts[melody_part] if melody_part < len(parts) else parts[0]
    chord_stream = parts[chord_part] if chord_part < len(parts) else parts[0]

    melody = _extract_melody(music21, melody_stream)
    chords = _extract_chords(music21, chord_stream, total_duration)

    return Chart(title=title, key=key_name, tempo=tempo, sections=sections, chords=chords, melody=melody)


def _detect_key(music21, score, flat) -> str:
    """The score's key, as one of our own note-name spellings (e.g.
    "Eb", not music21's "E-"). Prefers an explicit key signature that
    also declares its mode (major/minor); a bare key signature can't
    tell major from its relative minor on its own (e.g. no
    sharps/flats could be either C major or A minor), so that case
    falls back to music21's own key-finding analysis -- a genuine
    best-effort guess, not a certainty, same as it would be for a
    musician sight-reading an unmarked lead sheet.
    """
    key_objs = flat.getElementsByClass(music21.key.Key)
    if key_objs:
        tonic_name = key_objs[0].tonic.name
    else:
        tonic_name = score.analyze("key").tonic.name
    return tonic_name.replace("-", "b")


def _extract_sections(music21, flat, total_duration: float) -> list[Section]:
    marks = sorted(flat.getElementsByClass(music21.expressions.RehearsalMark), key=lambda m: m.offset)
    if not marks:
        return [Section(start=0.0, end=total_duration, label="A", source_label="")]

    raw_sections = []
    for i, mark in enumerate(marks):
        start = float(mark.offset)
        end = float(marks[i + 1].offset) if i + 1 < len(marks) else total_duration
        if end <= start:
            continue
        raw_sections.append(Section(start=start, end=end, label="", source_label=str(mark.content).strip() or "?"))
    return label_repeats(raw_sections)


def _extract_chords(music21, part, total_duration: float) -> list[ChordEvent]:
    raw = []
    for symbol in part.flatten().getElementsByClass(music21.harmony.ChordSymbol):
        if not symbol.chordKind or symbol.chordKind == "none":
            continue  # an explicit "no chord" placeholder -- nothing to voice
        try:
            root = symbol.root()
        except music21.chord.ChordException:
            continue  # a chord symbol with no pitches at all -- can't do anything with it
        if root is None:
            continue
        third_pc = symbol.third.pitchClass if symbol.third is not None else None
        fifth_pc = symbol.fifth.pitchClass if symbol.fifth is not None else None
        quality = quality_from_chord_symbol(root.pitchClass, third_pc, fifth_pc)
        raw.append((float(symbol.offset), root.pitchClass, quality))

    raw.sort(key=lambda t: t[0])
    chords = []
    for i, (start, root_pc, quality) in enumerate(raw):
        end = raw[i + 1][0] if i + 1 < len(raw) else total_duration
        if end <= start:
            continue
        chords.append(ChordEvent(root_pitch_class=root_pc, quality=quality, start=start, end=end))
    return chords


def _extract_melody(music21, part) -> list[NoteEvent]:
    notes: list[NoteEvent] = []
    # Holds an in-progress tied note as (pitch, start, end, velocity)
    # while we're still waiting to see whether it keeps being tied.
    pending: tuple[int, float, float, int] | None = None

    def _flush() -> None:
        nonlocal pending
        if pending is not None:
            pitch, start, end, velocity = pending
            notes.append(NoteEvent(pitch=pitch, start=start, end=end, velocity=velocity))
            pending = None

    for element in part.flatten().notesAndRests:
        # ChordSymbol is itself a subclass of Chord (and so shows up in
        # notesAndRests too) -- it's harmony data, not a melody note,
        # so it must be excluded explicitly before the Chord check below.
        if isinstance(element, music21.harmony.ChordSymbol):
            continue
        if isinstance(element, music21.note.Rest):
            _flush()
            continue

        if getattr(element.duration, "isGrace", False) or element.duration.quarterLength <= 0:
            continue  # grace notes/ornaments: out of scope for a practice chart

        if isinstance(element, music21.chord.Chord):
            # An actual chorded melody line (unusual for a lead sheet,
            # but happens on e.g. a choral part) -- take the top note,
            # the way a musician reading it as a single line would.
            pitch = max(p.midi for p in element.pitches)
        else:
            pitch = element.pitch.midi

        start = float(element.offset)
        end = start + float(element.duration.quarterLength)
        tie = element.tie

        if (pending is not None and pending[0] == pitch and abs(pending[2] - start) < 1e-6
                and tie is not None and tie.type in ("stop", "continue")):
            # A continuation of the note already in `pending` -- extend
            # it instead of starting a new NoteEvent, so a tied note
            # across a barline becomes one held note, not two.
            pending = (pending[0], pending[1], end, pending[3])
            if tie.type == "stop":
                _flush()
        else:
            _flush()
            if tie is not None and tie.type == "start":
                pending = (pitch, start, end, _DEFAULT_VELOCITY)
            else:
                notes.append(NoteEvent(pitch=pitch, start=start, end=end, velocity=_DEFAULT_VELOCITY))

    _flush()
    return notes
