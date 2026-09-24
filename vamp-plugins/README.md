# Vamp plugins for the Docker build

Chordino (chord detection, `pianobot chords`) is a compiled **Vamp
plugin**, not a Python package — `pip` can't install it, and it isn't
something this Dockerfile can safely download automatically (the
plugin's own binary distribution).

**One-time step, before running `docker build`:**

1. Download the **Linux** build of the NNLS Chroma Vamp plugin (which
   provides Chordino) from
   https://www.vamp-plugins.org/download.html#nnls-chroma
2. Unpack it and place its files directly in this folder
   (`vamp-plugins/`) — typically a `.so` file (or files) plus a `.cat`
   and/or `.n3` descriptor file that ship alongside it. Keep whatever
   filenames the download uses.
3. Build the image as usual (`docker build ...`). The Dockerfile copies
   everything in this folder into the container's Vamp plugin search
   path (`/usr/local/lib/vamp`).

This folder is `.gitignore`d (except this README) — the plugin binary
itself isn't something to commit to the repo.

If you skip this step, the image still builds and everything else
still works — `pianobot chords` will just report that the Chordino
plugin isn't installed, exactly like on a native, non-Docker install.
