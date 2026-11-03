# Maintaining help

Edit `src/help/content.ts`; `HelpDialog.vue` and the generated [HELP.md](HELP.md)
use that same content. Generator ranges come directly from `GENERATOR_FIELDS`.
Keep topic IDs stable, link related topics, and add new editor tabs to
`editorHelpTopics` or `dockHelpTopics`. Help navigation must never modify a draft.

Run `yarn help:generate`, `yarn help:check`, `yarn type-check`, and `yarn test`.
Run `yarn test:help-browser` for navigation/layout changes. That check launches Vite
and headless Chrome in an isolated `dist/help-browser/profile`; set `CHROME_PATH`
if Chrome is elsewhere. It checks desktop and phone navigation, keyboard behavior,
reading-position restoration, search, every topic's mobile width, and unchanged
project data. Screenshots are written to `dist/help-browser` for visual inspection.
Run `yarn build` to update the committed Pages application in `docs/`.

The 2026.11.03 content audit used the implementation below, including displayed
labels and normalization/scheduling rules. Recheck these sources when changing a
documented behavior; prior prose is not the authority for runtime behavior.

| Area | Sources |
| --- | --- |
| Navigation, transport, MIDI, export scope | `src/App.vue`, `EditorSurface.vue`, `TrackStrip.vue`, `SequenceGrid.vue`, `LiveAudioDialog.vue` |
| Save, import, library exports and merge | `PresetManager.vue`, `src/presets.ts`, `src/presetStorage.ts` |
| Masks, rests, timing, warp and activation | `src/domain/sequenceEditor.ts`, `rhythmTrack.ts`, `scheduling.ts`, `src/audio/stepDurations.ts`, `timeWarp.ts`, `src/trackActivation.ts` |
| Engines, source snapshots, control ranges | `SynthEngineControls.vue`, `GeneratorControls.vue`, `src/audio/generatorSettings.ts`, `partialGenerator.ts`, `partialBank.ts`, `partialWavetable.ts`, `tonewheelWavetable.ts` |
| Envelopes, routes, voices and effects | `TrackModulationControls.vue`, `ModulationControls.vue`, `EditorSurface.vue`, `src/audio/modulation.ts`, `glide.ts`, `waveshaper.ts`, `masterPulse.ts` |
| Sections, locks, snapshots, returns and samples | `DevelopmentPanel.vue`, `src/domain/development.ts`, `developmentSchedule.ts`, `src/audio/sampleAssets.ts` |
| Curve gestures, snapping and validation | `AutomationCurveEditor.vue`, `src/domain/automationEditor.ts` |
| Render ranges, formats and stems | `src/audio/developmentRender.ts`, `browserDevelopment.ts`, `renderCache.ts`, `wav.ts`, `DevelopmentPanel.vue` |
| CLI and MCP entry points | `cli/cli.ts`, `cli/projectCommands.ts`, `cli/mcp.ts`, `MCP.md` |

Corrections include conventional binary notation (`10` = `1010`), explicit signed
note mapping, the one-step base gate for an isolated attack, identical initial
wavetable configurations, mixed-source wavetable support, current dock names,
Export Library including the current draft, whole-preset track merging,
render-range bars following the first track's numerator, and the distinction
between 24-bit mixes and float32 stems with the master stage applied once.
