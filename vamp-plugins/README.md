# Vamp plugins for the Docker build

Chordino (chord detection, `pianobot chords`) is a compiled **Vamp
plugin**, not a Python package. The Dockerfile now builds it
automatically from source (`github.com/c4dm/nnls-chroma`) against
Debian's packaged Vamp SDK — its old prebuilt-binary download page
(vamp-plugins.org) points at a dead host, so there was no binary left
to fetch, but the source still builds cleanly. Nothing in this folder
is required any more.

This folder still exists in case you ever want to add or override a
plugin build of your own: anything placed here (a `.so` plus its
`.cat`/`.n3` descriptor) gets copied into the image's Vamp plugin
search path (`/usr/local/lib/vamp`) alongside the auto-built Chordino.
It's `.gitignore`d (except this README) — plugin binaries aren't
something to commit to the repo.
