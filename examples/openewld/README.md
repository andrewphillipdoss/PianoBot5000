# OpenEWLD lead sheets

Five real jazz-age standards pulled from
[OpenEWLD](https://github.com/00sapo/OpenEWLD), a public-domain-filtered
subset of the old Wikifonia leadsheet corpus. OpenEWLD's own README
states its MusicXML files "are intended to contain only Public Domain
content," which is why these are safe to keep committed here (unlike
community iReal Pro playlists or the full unofficial Wikifonia
archive, which carry unresolved copyright status on the songs
themselves -- see the main README's chart-sourcing discussion).

- `Summertime.mxl` -- George Gershwin
- `Ain't Misbehavin'.mxl` -- Fats Waller
- `Sweet Georgia Brown.mxl` -- Ben Bernie / Maceo Pinkard
- `Tea for Two.mxl` -- Vincent Youmans
- `Swing Low, Sweet Chariot.mxl` -- traditional spiritual

None of these carry an explicit tempo marking in the MusicXML, so
`pianobot chart` falls back to its default 120 BPM -- pass `--tempo`
yourself for a more authentic feel (`--tempo 80` for a ballad-paced
"Summertime", for instance).

Try one:
```bash
pianobot chart "examples/openewld/Summertime.mxl" -o summertime.mid --tempo 80
```
