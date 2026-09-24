"""The chart-based path: start from a known chord/melody chart (a lead
sheet) instead of guessing one from an audio recording. This is now the
project's primary way to produce a piano-arrangement MIDI file -- see
the top-level README. The old audio-transcription path still exists,
moved to ``pianobot.transcribe``.

  simple_format.load_chart(path)          JSON chart file -> Chart
  transpose.transpose_chart(chart, key)   Chart -> Chart in a new key
  arrange.render_to_midi_inputs(chart)    Chart -> (melody, chords, sections) ready for pianobot.assemble
"""
