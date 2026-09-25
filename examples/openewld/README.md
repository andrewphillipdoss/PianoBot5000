# OpenEWLD lead sheets

All 502 distinct lead sheets from
[OpenEWLD](https://github.com/00sapo/OpenEWLD), a public-domain-filtered
subset of the old Wikifonia leadsheet corpus. OpenEWLD's own README
states its MusicXML files "are intended to contain only Public Domain
content," which is why these are safe to keep committed here, unlike
community iReal Pro playlists or the full unofficial Wikifonia archive
(6,675 files), whose underlying songs are still under copyright -- see
the main README's chart-sourcing discussion.

`dataset/<composer>/<song>/<song>.mxl` mirrors OpenEWLD's own layout
exactly, so the folder names double as a browsable title/composer
index -- e.g. `dataset/George_Gershwin-Ira_Gershwin/Summertime/`.
(The upstream repo's `OpenEWLD.db` catalog has richer metadata --
genre, style, tonality, first-performance date -- but it also mixes in
some CC-BY-NC-licensed metadata columns from secondhandsongs.com
alongside CC0 Discogs data, so it isn't bundled here; the score files
themselves are the only thing guaranteed public domain, and the only
thing this project actually needs. Query it directly from the
upstream repo if you want the fuller metadata.)

Every one of these 502 files has been run through
`pianobot.charts.musicxml_format.load_chart()` and confirmed to parse
without error (see `tests/test_musicxml_import.py`'s spot-check test).

Genres/eras represented: mostly 1900s-1940s American popular song and
jazz standards (Gershwin, Kern, Waller, Berlin, ...), plus a fair
number of traditional spirituals/gospel (Swing Low Sweet Chariot, Go
Tell It on the Mountain, Down by the Riverside, Were You There When
They Crucified My Lord, ...), hymns/carols (O Little Town of
Bethlehem, What Child Is This?), folk songs (Shenandoah, Red River
Valley, Home on the Range), and a handful of others (Für Elise, Ave
Maria, Happy Birthday to You).

Try one:
```bash
pianobot chart "examples/openewld/dataset/DuBose_Heyward-George_Gershwin-Ira_Gershwin/Summertime/Summertime.mxl" \
    -o summertime.mid --tempo 80
```

Find one by name without digging through folders:
```bash
find examples/openewld/dataset -iname "*tea_for_two*"
```
