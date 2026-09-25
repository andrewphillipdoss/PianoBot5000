# PianoBot5000 -- chart-based path only (`pianobot chart ...`). This
# is deliberately tiny: no torch, no audio libraries, nothing to
# compile -- pretty_midi/typer/rich are all the chart path needs, and
# none of them need a C compiler on this base image. For the heavier,
# optional audio-transcription mode (`pianobot transcribe ...`,
# Demucs/Basic Pitch/Chordino/allin1), see Dockerfile.transcribe
# instead -- that one is genuinely worth containerizing; this one
# mostly exists for parity/consistency, since `pip install pianobot5000`
# on the host works just as well without Docker at all.
FROM python:3.11-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir -e .
COPY examples ./examples
COPY tests ./tests

CMD ["pianobot", "--help"]
