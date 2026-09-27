import { useState } from 'react';
import { useSongPlayback } from '../hooks/useSongPlayback.js';
import { PARTS } from '../parts.js';
import { clipToSectionLength, processTake } from '../recordingPipeline.js';
import {
  appendSectionData,
  emptyChartData,
  nextSectionLabel,
  readChartBeatsPerBar,
  readChartQuantization,
  replaceSectionData,
  sectionBasslineAsInternal,
  sectionChordsAsInternal,
  sectionMelodyAsInternal,
} from '../songStorage.js';
import RecordPart from './RecordPart.jsx';
import SectionHub from './SectionHub.jsx';
import SongSetup from './SongSetup.jsx';

const EMPTY_SECTION = { sectionLengthBeats: null, parts: { chords: null, melody: null, bassline: null } };

/** A finished take (RecordingSession's result) -> what the section keeps of it. */
function takeFromResult(result) {
  return {
    events: result.part === 'chords' ? result.chords : result.notes,
    skippedClusterCount: result.skippedClusterCount ?? 0,
    // Everything needed to re-derive this exact take later at a new
    // quantization (or, for a lone first take, a corrected tempo)
    // without re-recording it.
    rawMessages: result.rawMessages,
    captureDurationSeconds: result.captureDurationSeconds,
    pickupBeats: result.pickupBeats,
    setsLength: result.setsLength,
    recordedLengthBeats: result.sectionLengthBeats,
  };
}

/** Re-run a take's own raw MIDI through the pipeline -- same take, new tempo/grid/strength. */
function rederiveTake(part, take, { tempo, settings, beatsPerBar }) {
  const result = processTake(part, take.rawMessages, tempo, {
    captureDurationSeconds: take.captureDurationSeconds,
    sectionLengthBeats: take.setsLength ? null : take.recordedLengthBeats,
    subdivisionsPerBeat: settings[`${part}Quantization`],
    quantizeStrength: settings[`${part}QuantizeStrength`],
    pickupBeats: take.pickupBeats,
    beatsPerBar,
  });
  return {
    ...take,
    events: part === 'chords' ? result.chords : result.notes,
    skippedClusterCount: result.skippedClusterCount ?? 0,
    recordedLengthBeats: result.sectionLengthBeats,
  };
}

/** An already-saved section, as the hub's starting point -- its parts have no raw MIDI left, only their events. */
function sectionFromChart(chartData, sectionIndex) {
  const section = chartData.sections[sectionIndex];
  const saved = (events) => (events.length > 0 ? { events, rawMessages: null, skippedClusterCount: 0 } : null);
  return {
    sectionLengthBeats: section.end_beat - section.start_beat,
    parts: {
      chords: saved(sectionChordsAsInternal(chartData, section)),
      melody: saved(sectionMelodyAsInternal(chartData, section)),
      bassline: saved(sectionBasslineAsInternal(chartData, section)),
    },
  };
}

function hasAnyTake(section) {
  return PARTS.some((part) => section.parts[part]);
}

/** One part's events as they'll actually be kept -- cut to the section's (possibly since-adjusted) length. */
function partEvents(section, part) {
  const events = section.parts[part]?.events ?? [];
  return section.sectionLengthBeats === null ? events : clipToSectionLength(events, section.sectionLengthBeats);
}

/** The section in the shape songStorage.js's appendSectionData/replaceSectionData take. */
function sectionForSave(section) {
  return {
    sectionLengthBeats: section.sectionLengthBeats,
    chords: partEvents(section, 'chords'),
    melody: partEvents(section, 'melody'),
    bassline: partEvents(section, 'bassline'),
  };
}

/**
 * The whole record-a-song flow: song setup once (skipped when adding to
 * or editing an existing song), then each section's hub (SectionHub.jsx)
 * -- Chords, Melody and Bassline, recorded in any order, as many times
 * as it takes -- then either "Add Another Section" (a fresh hub for the
 * next one) or save.
 *
 * Three modes:
 *   newSong     - baseChartData is null; starts at setup; each finished
 *                 section builds up from an empty chart.
 *   addSection  - baseChartData is an already-saved song; starts at a
 *                 fresh hub for its next section.
 *   editSection - opens `sectionIndex` of an already-saved song in its
 *                 hub, with its saved parts already in place. Any part
 *                 can be re-recorded, cleared or added; saving replaces
 *                 just that section (every later section shifts to
 *                 absorb a length change -- see songStorage.js's
 *                 replaceSectionData).
 *
 * The rule that makes "any order" work is one line: a take sets the
 * section's length only when there's nothing else in the section yet
 * (see recordingPipeline.js). So whichever part comes first -- or comes
 * back first after everything else was cleared -- decides it, and every
 * other take plays along with what's there.
 *
 * Tempo is tracked here, not fixed at setup, so it can change on the
 * record screen and the hub. Chart data is stored in beats, so changing
 * it only changes playback speed -- except when the section's single
 * take is the one that set its length, and still has its raw MIDI: then
 * it's re-derived at the new tempo (correcting a tempo typed wrong at
 * setup, without re-recording), length included. With more than one
 * take recorded, they're already synchronized with each other in beats,
 * and re-deriving any of them would pull it out of step with the rest.
 */
export default function RecordSongFlow({ mode = 'newSong', baseChartData = null, sectionIndex = null, onCancel, onSaved, saveSong }) {
  const isEditing = mode === 'editSection';

  const [song, setSong] = useState(() =>
    baseChartData ? { title: baseChartData.title, key: baseChartData.key, tempo: baseChartData.tempo, beatsPerBar: readChartBeatsPerBar(baseChartData) } : null
  );
  const [settings, setSettings] = useState(() => readChartQuantization(baseChartData ?? {}));
  const [screen, setScreen] = useState(mode === 'newSong' ? 'setup' : 'hub');
  const [recordingPart, setRecordingPart] = useState(null);
  const [section, setSection] = useState(() => (isEditing ? sectionFromChart(baseChartData, sectionIndex) : EMPTY_SECTION));
  // Sections finished earlier *this session* (via "Add Another
  // Section") but not yet folded into the saved chart -- only ever
  // grows in newSong/addSection modes.
  const [completedSections, setCompletedSections] = useState([]);
  const playback = useSongPlayback();

  const sectionLabel = isEditing ? baseChartData.sections[sectionIndex].label : nextSectionLabel((baseChartData?.sections.length ?? 0) + completedSections.length);
  const hasFreshWork = completedSections.length > 0 || PARTS.some((part) => section.parts[part]?.rawMessages);

  function handleTempoChange(tempo) {
    setSong((s) => ({ ...s, tempo }));
    const takes = PARTS.filter((part) => section.parts[part]);
    const [onlyPart] = takes;
    const onlyTake = section.parts[onlyPart];
    if (takes.length === 1 && onlyTake.setsLength && onlyTake.rawMessages) {
      const rederived = rederiveTake(onlyPart, onlyTake, { tempo, settings, beatsPerBar: song.beatsPerBar });
      setSection({ sectionLengthBeats: rederived.recordedLengthBeats, parts: { ...section.parts, [onlyPart]: rederived } });
    }
  }

  function handleSettingChange(part, partial) {
    const nextSettings = { ...settings, ...partial };
    setSettings(nextSettings);
    const take = section.parts[part];
    if (take?.rawMessages) {
      // The section keeps its length (it may have been adjusted by hand
      // since) -- only this part's events are re-derived.
      const rederived = rederiveTake(part, take, { tempo: song.tempo, settings: nextSettings, beatsPerBar: song.beatsPerBar });
      setSection((s) => ({ ...s, parts: { ...s.parts, [part]: rederived } }));
    }
  }

  function handleClear(part) {
    setSection((s) => {
      const parts = { ...s.parts, [part]: null };
      // Nothing left to play against -- the next take sets the length afresh.
      return { parts, sectionLengthBeats: PARTS.some((p) => parts[p]) ? s.sectionLengthBeats : null };
    });
  }

  function handleLengthChange(deltaBeats) {
    setSection((s) => ({ ...s, sectionLengthBeats: Math.max(song.beatsPerBar, s.sectionLengthBeats + deltaBeats) }));
  }

  function handleTakeDone(result) {
    setSection((s) => ({
      sectionLengthBeats: result.setsLength ? result.sectionLengthBeats : s.sectionLengthBeats,
      parts: { ...s.parts, [result.part]: takeFromResult(result) },
    }));
    setScreen('hub');
  }

  function handlePlaySection() {
    const preview = appendSectionData(emptyChartData({ title: song.title, key: song.key, tempo: song.tempo, beatsPerBar: song.beatsPerBar }), {
      sectionLabel,
      ...sectionForSave(section),
    });
    playback.play(preview);
  }

  function handleBack() {
    playback.stop();
    if (mode === 'newSong' && completedSections.length === 0) {
      setScreen('setup'); // this section's takes stay put -- see SongSetup's `initial`
      return;
    }
    if (hasFreshWork && !window.confirm("Leave without saving? What you've recorded here will be lost.")) return;
    onCancel();
  }

  async function finalize() {
    playback.stop();
    const thisSection = hasAnyTake(section) ? sectionForSave(section) : null;
    let chartData = isEditing
      ? replaceSectionData(baseChartData, sectionIndex, thisSection)
      : [...completedSections, ...(thisSection ? [{ sectionLabel, ...thisSection }] : [])].reduce(
          (acc, s) => appendSectionData(acc, s),
          baseChartData ?? emptyChartData({ title: song.title, key: song.key, tempo: song.tempo })
        );
    // Whatever settings were actually used this session, even if they
    // differ from what the chart started with.
    chartData = { ...chartData, tempo: song.tempo, beatsPerBar: song.beatsPerBar, ...settings };
    // Left over from before every section offered all three parts --
    // whether a song has a bassline is now just whether one was recorded.
    delete chartData.hasBassline;
    delete chartData.basslineFirst;
    const savedSummary = await saveSong(chartData);
    onSaved(savedSummary);
  }

  if (screen === 'setup') {
    return (
      <SongSetup
        initial={song}
        onBack={onCancel}
        onSubmit={(submittedSong) => {
          setSong(submittedSong);
          setScreen('hub');
        }}
      />
    );
  }

  if (screen === 'record') {
    const part = recordingPart;
    const isLine = part !== 'chords';
    const pickupKey = `${part}PickupBeats`;
    const backing = Object.fromEntries(PARTS.filter((p) => p !== part).map((p) => [p, partEvents(section, p)]));
    return (
      <RecordPart
        // useRecordingSession only ever reads these once, at construction
        // (see its docstring) -- keying on all of them forces a fresh
        // mount (and a fresh RecordingSession) the moment any changes,
        // rather than the take silently using the old value.
        key={`${part}-${settings[`${part}Quantization`]}-${settings[`${part}QuantizeStrength`]}-${settings[pickupKey]}-${song.tempo}-${song.beatsPerBar}-${settings.metronomeSubdivisionsPerBeat}`}
        part={part}
        title={song.title}
        sectionLabel={sectionLabel}
        tempo={song.tempo}
        onTempoChange={handleTempoChange}
        subdivisionsPerBeat={settings[`${part}Quantization`]}
        onSubdivisionsPerBeatChange={(value) => setSettings((s) => ({ ...s, [`${part}Quantization`]: value }))}
        quantizeStrength={isLine ? settings[`${part}QuantizeStrength`] : undefined}
        onQuantizeStrengthChange={(value) => setSettings((s) => ({ ...s, [`${part}QuantizeStrength`]: value }))}
        hasPickupBar={isLine && settings[pickupKey] > 0}
        onHasPickupBarChange={(checked) => setSettings((s) => ({ ...s, [pickupKey]: checked ? song.beatsPerBar : 0 }))}
        pickupBeats={isLine ? settings[pickupKey] : 0}
        beatsPerBar={song.beatsPerBar}
        metronomeSubdivisionsPerBeat={settings.metronomeSubdivisionsPerBeat}
        onMetronomeSubdivisionsPerBeatChange={(value) => setSettings((s) => ({ ...s, metronomeSubdivisionsPerBeat: value }))}
        sectionLengthBeats={section.sectionLengthBeats}
        backing={backing}
        onBack={() => setScreen('hub')}
        onDone={handleTakeDone}
      />
    );
  }

  // screen === 'hub'
  return (
    <SectionHub
      title={song.title}
      sectionLabel={sectionLabel}
      keySignature={song.key}
      tempo={song.tempo}
      onTempoChange={handleTempoChange}
      beatsPerBar={song.beatsPerBar}
      section={section}
      settings={settings}
      onSettingChange={handleSettingChange}
      isPlaying={playback.isPlaying}
      onPlay={handlePlaySection}
      onStopPlayback={playback.stop}
      onRecord={(part) => {
        playback.stop();
        setRecordingPart(part);
        setScreen('record');
      }}
      onClear={handleClear}
      onLengthChange={handleLengthChange}
      backLabel={mode === 'newSong' && completedSections.length === 0 ? 'Song setup' : 'Cancel'}
      onBack={handleBack}
      onAddSection={
        isEditing
          ? undefined // editing replaces exactly one section -- add a section as its own action from the song view
          : () => {
              playback.stop();
              setCompletedSections((prev) => [...prev, { sectionLabel, ...sectionForSave(section) }]);
              setSection(EMPTY_SECTION);
            }
      }
      finalizeLabel={mode === 'newSong' ? 'Finalize Song' : 'Save Changes'}
      canFinalize={hasAnyTake(section) || completedSections.length > 0}
      onFinalize={finalize}
    />
  );
}
