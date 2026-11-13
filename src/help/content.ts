import { GENERATOR_FIELDS, type GeneratorMode } from '../audio/generatorSettings';
import { POSITION_FUNCTIONS } from '../audio/partialBank';
import { DRUM_VOICE_OPTIONS } from '../domain/rhythmTrack';

/** Shared by the offline in-app guide and HELP.md. Keep instructions tied to UI labels. */
export interface HelpSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  steps?: string[];
  table?: { headings: string[]; rows: string[][] };
  code?: string;
  topics?: string[];
  links?: { label: string; href: string }[];
}
export interface HelpTopic {
  id: string;
  group: string;
  title: string;
  summary: string;
  location: string;
  keywords?: string;
  target?: { kind: 'editor' | 'dock'; value: string };
  sections: HelpSection[];
  related: string[];
}
const editor = (value: string): HelpTopic['target'] => ({ kind: 'editor', value });
const dock = (value: string): HelpTopic['target'] => ({ kind: 'dock', value });
const controls = (mode: GeneratorMode): HelpSection => ({
  title: 'Control ranges',
  table: { headings: ['Control', 'Range', 'Default'], rows: GENERATOR_FIELDS[mode].map(f => [f.label, `${f.min} to ${f.max}`, String(f.default)]) },
});

export const helpTopics: HelpTopic[] = [
  {
    id: 'welcome', group: 'Start here', title: 'Help & tutorials',
    summary: 'Find a control, learn a workflow, or solve a playback problem without leaving your project.',
    location: 'Help button · F1', keywords: 'contents manual guide getting started',
    sections: [
      { title: 'Start a tutorial', topics: ['tutorial-melody', 'tutorial-drums', 'tutorial-phrases', 'tutorial-filter', 'tutorial-wavetable', 'tutorial-samples', 'tutorial-export'] },
      { title: 'Find your way', bullets: [
        'The table of contents lists every topic. Search matches titles, control names, tutorials and the full reference; try “grain”, “MIDI”, “snapshot” or “no sound”.',
        'Each editor’s Help button opens its own reference. F1 opens help for the current editor. Open controls takes you back to the relevant panel without changing your project.',
        'Use related topics or Back to follow a trail. Search, topic and reading position are kept while you close and reopen help; a context link opens the requested topic directly.',
        'On a narrow screen, Contents opens the full topic list. Search and Close stay within reach. Escape closes help; Tab moves through links and controls.',
      ] },
      { title: 'Three things to know', paragraphs: [
        'A preset is a saved project. Editing changes the current draft; Save or Save As is required to update the library. Export and sharing use the draft.',
        'Sequence integers select notes or drum hits. Timing, articulation and sound design are separate controls. A zero starts no note, but a previous gate, release or effect tail may continue.',
        'Internal audio plays GateRunner’s synths and effects. MIDI Output sends notes to your selected external device. Sound controls do not become MIDI effects.',
      ] },
    ], related: ['tutorial-melody', 'workspace', 'troubleshooting', 'shortcuts'],
  },
  {
    id: 'tutorial-melody', group: 'Tutorials', title: 'Tutorial: first melody',
    summary: 'Create, hear and save a short melodic pattern.', location: 'Project → New · Track editor → Sequence', target: editor('sequence'),
    sections: [
      { title: 'Build the pattern', steps: [
        'Use Project → New to start an unnamed draft with the default pattern. Use Clear instead for a blank sequence. Neither action creates a saved preset. If asked about an existing draft, save it first if you want to keep it.',
        'Select a melodic track. In the inspector, choose Forte number 7-35.11. Its pitch classes are C, D, E, F, G, A, B.',
        'Open Sequence and enter 1 2 4 8 3 5 7 0. Powers of two select one position; combined bits select chords.',
        'In Playback, set Numerator to 4, Denominator to 4, Track Note Length to 50% and Fixed Note Length to 0. Each step is a sixteenth note; eight steps take two beats.',
        'Press Play, or Space outside an editable control. You should hear four single notes followed by three chords; the last step starts nothing. Stop before continuing.',
        'Click cells in the note grid to change the same sequence. Use Double to repeat its contents or + 16 steps to append empty steps.',
        'Use Project → Save and enter a name to keep the draft in your library. After saving, Save updates that preset and Save As keeps a separate version. The status changes from Draft or Unsaved changes to Saved.',
      ] },
      { title: 'Try another sound', paragraphs: ['Open Generator, select Additive, Partial source → Waveform, and choose Sine or Triangle. Raise Track Repeats in Playback for a longer arrangement. Changing Forte number remaps the same integers into a different pitch-class set.'] },
    ], related: ['sequence', 'playback', 'presets', 'engines'],
  },
  {
    id: 'tutorial-drums', group: 'Tutorials', title: 'Tutorial: drum groove',
    summary: 'Draw a kit pattern, change velocities and choke open hats.', location: 'Add rhythmic track · Sequence · Drum Sounds', target: editor('sequence'),
    sections: [
      { title: 'Build the groove', steps: [
        'Use the arrangement toolbar to add a rhythmic track and select it. Open Sequence, clear the integer sequence and use + 16 steps.',
        'Set Numerator 4 and Denominator 4 in Playback. In the grid, toggle Kick at steps 1 and 9, Snare at 5 and 13, and Closed Hi-Hat on odd-numbered steps. Use the row arrows to reach a lane.',
        'Play the pattern. New grid hits use the maximum velocity for the selected bit width. Drum Sounds edits the selected lane’s synthesis, filtering and sends.',
        'To experiment with quieter hits, stop and inspect Velocity bits per lane in Sequence. With 2 bits each lane has levels 0–3; 0 is off and 3 is full. The integer field can enter intermediate velocities.',
        'For a separate two-lane example with 2 bits, 9 means first lane level 1 plus second lane level 2: 1 + 2 × 4. Changing lane order or bit width reinterprets existing numbers, so keep a saved copy before experimenting.',
        'Add Open Hi-Hat if needed. Give closed and open hats the same XOR group, such as 1. They now cut each other off; if both trigger together, the later lane wins.',
        'Save the preset. MIDI channel defaults to 10 for a rhythmic track; change it in Playback if your device expects another channel.',
      ] },
    ], related: ['drums', 'drum-sounds', 'articulation', 'midi'],
  },
  {
    id: 'tutorial-phrases', group: 'Tutorials', title: 'Tutorial: phrases & variation',
    summary: 'Arrange two phrases and add a repeatable accent.', location: 'Phrases · Articulation', target: dock('phrases'),
    sections: [
      { title: 'Arrange a verse and fill', steps: [
        'Select a track containing a sequence. Open Phrases, enable Develop this track and choose Capture sequence. Name the captured phrase Main.',
        'Capture again, name the copy Fill, and change its Integer sequence. You can also edit saved phrases in Sequence using Editing pattern.',
        'Use Add section twice. Select Main for the first section and Fill for the second. Set each length to 2 bars. These explicit sections determine the arrangement; Track Repeats no longer multiplies it.',
        'Keep Boundary at cut to end gates at section boundaries, or choose carry if overlapping gates and ties should continue. Release and effect tails can remain after a cut.',
        'In Articulation, select Main in Articulation scope and Add step control. Step 0 means the first step. Set Velocity to 1 and Gate × to 0.5 for an accented, shorter attack.',
        'Expand Accent, slide, conditions & locks. Set Every N repetitions to 2 if the attack should occur only on even repetitions. This condition removes the attack on other repetitions; it does not just switch off the accent.',
        'Play to hear the prepared arrangement. Keep Saved variation seed unchanged for repeatable chance and humanization; change it for a different variation. Save.',
      ] },
    ], related: ['phrases', 'articulation', 'automation', 'activation'],
  },
  {
    id: 'tutorial-filter', group: 'Tutorials', title: 'Tutorial: moving filter',
    summary: 'Draw a filter sweep and learn exact point editing.', location: 'Filter · Automation', target: dock('motion'),
    sections: [
      { title: 'Draw an opening sweep', steps: [
        'Choose a melodic track with several attacks. In Generator, use Additive → Waveform → Sawtooth so the filter has harmonics to remove.',
        'In Filter, enable the filter, choose lowpass, set Key Follow to 0% and Q to 1.',
        'Open Automation and enable Develop this track. Choose Add motion curve, set Control to the filter cutoff/base control, Clock to song and Curve to linear.',
        'Select the first graph point. Set Beat to 0 and Value to 48. Select the other point and set Beat to 4 and Value to 96. These values are MIDI pitch units for cutoff, not Hz.',
        'Use Fit points. Drag a point to audition a different shape on the next Play. Snap affects graph edits; typed beat/value inputs remain exact.',
        'Play an arrangement at least four beats long to hear the full sweep. Editing a developed track stops playback; Play again after the edit.',
        'For repeating per-note motion, use Clock → note, or use an envelope/LFO in Modulation. Save when satisfied.',
      ] },
    ], related: ['automation', 'filter', 'modulation', 'snapshots'],
  },
  {
    id: 'tutorial-wavetable', group: 'Tutorials', title: 'Tutorial: morphing timbre',
    summary: 'Blend two spectra and animate their position with a vector LFO.', location: 'Generator · Modulation', target: editor('generator'),
    sections: [
      { title: 'Make two different endpoints', steps: [
        'On a melodic track, choose Additive and enable Multidimensional wavetable in Generator.',
        'For a fresh wavetable, a Brightness axis and Configuration 1 and Configuration 2 are created. Both begin as copies of the current source; edit them to make the morph audible.',
        'Choose Configuration 1, set its Brightness position to 0%, and set Partial source to Waveform with Sine. Choose Configuration 2 at 100% and use Sawtooth.',
        'Move the Brightness axis value between 0% and 100%. This is the playback position; each configuration’s position defines where that saved sound lives.',
        'Set the base Brightness value to 50%. In Modulation → Vector modulation add a vector LFO, set its shape to sine, enable tempo sync and choose a 1/1 cycle.',
        'Set Global depth to 0.5 and the Brightness route to 100%. The axis moves across its full range. Play a long note or repeated chords to hear the change.',
        'If there is no motion, check that the wavetable, LFO and route are enabled and the endpoint spectra differ. Save the result.',
      ] },
    ], related: ['wavetable', 'vector', 'partials', 'modulation'],
  },
  {
    id: 'tutorial-samples', group: 'Tutorials', title: 'Tutorial: sample instrument',
    summary: 'Import a WAV, tune it, and turn it into a playable source.', location: 'Samples · Phrases', target: dock('samples'),
    sections: [
      { title: 'Play an imported sound', steps: [
        'Open Samples and import a supported mono or stereo WAV. The sample asset count increases; importing alone does not assign a voice.',
        'Choose Add sample voice. On a rhythmic track, select Replace drum lane; on a melodic track the sample replaces the melodic source.',
        'Choose the Sample alternative. Set Root MIDI note to the recording’s original pitch (60 is middle C) and Tune semitones for any correction.',
        'Set Start seconds and optional End seconds to trim the region. Choose one-shot for a single playback or loop to repeat the region while a gate is held.',
        'Open Phrases and enable Develop this track. Enter notes in Sequence, then Play. Use the sample attack/release and melodic amp envelope together to shape the sound.',
        'For a granular cloud instead, use Generator → Granular sampler and choose the imported asset in Grain sample. This is a separate source from Add sample voice.',
        'Use Render → Portable project for sharing with embedded audio. Save also preserves sample assets in the preset library.',
      ] },
    ], related: ['samples', 'granular', 'render', 'presets'],
  },
  {
    id: 'tutorial-export', group: 'Tutorials', title: 'Tutorial: export & backup',
    summary: 'Deliver audio to a DAW and keep an editable project.', location: 'Export · Render · Project', target: dock('render'),
    sections: [
      { title: 'Choose your deliverables', steps: [
        'Use Save or Save As so the current draft has a saved copy. Check mute/solo before auditioning; exports use the project tracks rather than the temporary listening selection.',
        'Use Export → Download WAV for the full mix, including releases and effects. The file is stereo 48 kHz, 24-bit PCM. Cancel stops an in-progress export.',
        'For an excerpt, open Render, enable Selected range, choose bars, beats or seconds, and set Start and Exclusive end. Start 0, End 4 in bars selects the first four project bars; each uses the first track’s numerator in beats.',
        'Choose Export stems for separate tracks and returns. Allow multiple downloads if the browser requests it. Keep stems.json with the WAV files; it identifies which files should be summed.',
        'Use Export → Download MIDI if the DAW should play its own instruments. MIDI retains notes, timing, velocity and channels, but does not carry the synth sounds or audio effects.',
        'Use Project → Export Preset for one editable draft or Export Library for the library, including the current draft. For sample-heavy projects, Render → Portable project embeds the audio in a single JSON package.',
        'To verify a backup, import the JSON through Project → Import JSON. Imported presets are added alongside existing ones. Keep an external copy because the local browser library is not a cloud backup.',
      ] },
    ], related: ['render', 'midi', 'presets', 'cli'],
  },
  {
    id: 'workspace', group: 'Workspace & projects', title: 'Workspace & transport',
    summary: 'Move between the arrangement, mixer, inspector and track editors.', location: 'Main workspace',
    sections: [
      { title: 'Workspace map', table: { headings: ['Area', 'What it does'], rows: [
        ['Project bar', 'Browse the preset library; rename, save, import and export projects. Unsaved changes refers to the current draft.'],
        ['Transport', 'Play/Stop, Return to start, tempo (1–499 BPM), song-loop duration, Audio / MIDI and Export. Live tempo changes preserve your place in the loop. Stop rendered Development playback before changing tempo. Return to start restarts only if already playing.'],
        ['Inspector', 'Global Forte set and A4 tuning, selected-track gain/velocity, shortcuts to devices and master output. Hide it to make more room.'],
        ['Arrangement', 'Select a track, inspect its scheduled notes, zoom the timeline, and add melodic or rhythmic tracks. Double-click a pattern to edit it.'],
        ['Mixer', 'Track and master faders, mute/solo and instrument access. Track gain affects internal audio; velocity affects note dynamics and MIDI.'],
        ['Editor dock', 'Track editor, Phrases, Articulation, Automation, Routing, Samples and Render. Collapse it when you need more arrangement space.'],
      ] } },
      { title: 'Tracks and playback', bullets: [
        'Drag track rows to reorder. The track ⋮ menu also offers duplicate, delete and move up/down, including on touch screens. Reordering changes the bit positions in Track Activation (B).',
        'Each track has its own pattern timing. The longest track defines the song loop; shorter tracks become silent after their repeats until the song restarts.',
        'Mute/solo are audition controls. Developed projects resolve their schedule before Play; samples, returns and unsupported live controls also require audio rendering. Stop cancels preparation. Editing or changing mute/solo stops prepared playback, and the next Play prepares the new state.',
        'Track previews show scheduled onsets and gates after timing and articulation. They are not audio waveforms, so release and effect tails can extend past the visible gates.',
      ] },
    ], related: ['shortcuts', 'playback', 'presets', 'master'],
  },
  {
    id: 'presets', group: 'Workspace & projects', title: 'Presets, folders & sharing',
    summary: 'Save drafts, organize the local library and move projects between devices.', location: 'Preset name · Project menu · Render', keywords: 'backup import export JSON storage IndexedDB merge library URL',
    sections: [
      { title: 'Draft versus saved preset', table: { headings: ['Action', 'Result'], rows: [
        ['Save', 'Updates the selected preset, or asks for a name to save an unnamed draft for the first time.'], ['Save As', 'Creates a separately named preset from the draft.'],
        ['New', 'Starts an unnamed draft with default settings and the default pattern, without adding to the library.'],
        ['Clear', 'Starts an unnamed draft with default settings and one empty melodic track, without changing saved presets.'],
        ['Rename / Delete', 'Change the selected saved preset’s name or remove it. These actions are unavailable for unnamed drafts.'],
        ['Export Preset', 'Downloads the current draft as a single-preset JSON file, even before it has a saved name.'], ['Export Library', 'Downloads the library with the current draft substituted for its selected preset, or included as an extra preset if unnamed. This does not save that draft back to browser storage.'],
        ['Import JSON', 'Adds presets/folders from a single preset, library or portable project without overwriting existing presets. Imported IDs are remapped as needed.'],
      ] }, paragraphs: ['Unnamed drafts show Untitled draft and a Draft status. Save or export the draft to keep it after closing or reloading the page. Loading another preset, New and Clear ask before discarding an unsaved draft; cancelling keeps your work.'] },
      { title: 'Preset Browser', paragraphs: ['Click the preset name or Untitled draft to open the browser. Search names or folder paths, choose a folder in the tree, and use New Folder or New Preset. New Preset in the browser creates a named library entry; Project → New starts an unnamed working draft. Folder and preset menus support rename, move and delete. Folder deletion also removes its descendants after confirmation. Merge tracks into current adds all tracks from another preset to the working draft, including unnamed drafts, after confirmation, retaining the current project’s shared tempo and harmony. Save the merged draft when ready.'] },
      { title: 'Storage and portability', bullets: [
        'The saved library lives in this browser’s IndexedDB and can include embedded samples. Existing older libraries migrate automatically. A failed save keeps the previous stored library and current draft; export the draft before clearing storage.',
        'The URL reflects the current project state. Render → Share URL copies an explicit project URL. Large samples can make URLs impractical; Portable project embeds everything in a JSON file instead.',
        'Browser data is local to its profile and origin. Another browser/device will not automatically see the library; import a backup there. Clearing site data can remove local projects.',
      ] },
    ], related: ['tutorial-export', 'samples', 'render', 'troubleshooting'],
  },
  {
    id: 'sequence', group: 'Sequencing & timing', title: 'Melodic encoding & note grid',
    summary: 'Understand integers, chords, negative values and the visual sequence editor.', location: 'Inspector → Forte number · Track editor → Sequence', target: editor('sequence'), keywords: 'binary bitmask scale pitch harmony octave rest grid',
    sections: [
      { title: 'How integers become notes', paragraphs: ['Choose a Forte pitch-class set in the inspector. Its ordered pitches repeat across the MIDI range. Each set bit in an integer’s absolute value selects one position, counting bit 0 from the right. Octave shift sets the reference position. Positive integers select upward from it; negative integers select downward from it. Only pitches within MIDI 0–127 can sound.'], table: { headings: ['Integer', 'Binary magnitude', 'Positions from the reference'], rows: [
        ['0', '0', 'No new attack'], ['1', '1', '0'], ['2', '10', '+1'], ['5', '101', '0 and +2'], ['7', '111', '0, +1 and +2'], ['10', '1010', '+1 and +3'], ['-5', '101', '0 and −2'],
      ] } },
      { title: 'Use the grid or text', bullets: [
        'Separate decimal integers with spaces. The grid and Integer sequence field edit the same data; each column is a step and each row a pitch. The grid’s displayed step numbers start at 1.',
        'Click a cell to toggle a pitch. + 16 steps appends zeros; Double duplicates the whole sequence. Page controls reach more than 32 steps, and row arrows reach more than eight pitches.',
        'Negative melodic values and values above the safe integer range cannot be edited in the grid; use the text field for supported signed sequences. Keep melodic magnitudes within 9,007,199,254,740,991 for exact integer representation. Drum masks use BigInt instead.',
        'For developed tracks, Editing pattern selects the base sequence or a captured phrase. Capturing phrases does not by itself replace the base sequence; sections select which phrases play.',
        'Zero is an empty attack step. Gate lengths normally extend toward the next nonempty step, subject to Note Length and articulation. Use a shorter gate to create audible silence.',
      ] },
    ], related: ['tutorial-melody', 'playback', 'drums', 'phrases'],
  },
  {
    id: 'drums', group: 'Sequencing & timing', title: 'Drum lanes & velocity masks',
    summary: 'Pack simultaneous percussion hits and velocity levels into decimal integers.', location: 'Rhythmic track → Sequence', target: editor('sequence'),
    sections: [
      { title: 'Packed velocity values', paragraphs: ['A rhythmic track uses an ordered list of GM-oriented percussion voices. Each lane occupies 1–7 velocity bits. The first lane uses the least significant bits; a value of zero in a lane means no hit. Nonzero values are divided by the maximum lane value to get velocity. Track Velocity Multiplier applies afterward.'], code: 'mask = sum(laneValue[i] × 2^(bits × i))\n2 bits, lane values [1, 2] → 1 + 2 × 4 = 9\n2 bits, lane values [3, 3] → 3 + 3 × 4 = 15', bullets: [
        'Enter nonnegative decimal BigInt masks; the rhythmic parser rejects invalid tokens. Very large drum masks remain exact.',
        'The grid adds a full-velocity hit or clears the lane. Use the integer field for intermediate velocities, or Articulation for per-hit velocity overrides.',
        'Add voice chooses an unused kit voice. Move/remove lanes with the lane controls; at least one remains. Lane order and bit width change the interpretation of existing masks.',
      ] },
      { title: 'Choke groups and MIDI', paragraphs: ['XOR group 0 means no group. Groups 1–8 let a hit stop other voices in the same group. If grouped voices fire together, the later/higher lane wins. Repeated hits of the same voice replace its prior hit. MIDI defaults to channel 10, uses each voice’s GM percussion note, and can be routed to a different channel in Playback.'] },
    ], related: ['tutorial-drums', 'drum-sounds', 'articulation', 'midi'],
  },
  {
    id: 'playback', group: 'Sequencing & timing', title: 'Track timing, level & glide',
    summary: 'Set the grid, gate lengths, delay, repeats, padding and fades.', location: 'Track editor → Playback', target: editor('playback'), keywords: 'numerator denominator phase octave gain velocity MIDI channel length',
    sections: [
      { title: 'Timing reference', table: { headings: ['Control', 'Meaning'], rows: [
        ['Numerator (1–16)', 'Quarter-note beats per track bar; used by delay, padding, fades and phrase lengths in bars.'],
        ['Denominator (1–16)', 'Steps per quarter-note beat. 4 gives sixteenth-note steps. This is not the denominator of a conventional time signature.'],
        ['Track Phase (0–1)', 'Shift onsets by this fraction of one step, wrapping within the pattern; length, repeats and padding stay fixed.'],
        ['Octave shift (0–10)', 'Moves the melodic reference by one pitch-class-set octave per unit. It does not retune GM drum notes.'],
        ['Track Note Length (0–400%)', 'Scales the base gate duration in steps. Gaps to the next nonempty step are included when they are shorter than a whole pattern; an isolated attack has a one-step base duration.'],
        ['Fixed Note Length (0–64 steps)', 'Adds steps after the percentage calculation: gate = baseSteps × percent / 100 + fixedSteps.'],
        ['Track Delay (0–64 bars)', 'Wait once before this track begins.'],
        ['Padding Before / After (0–64 bars)', 'Silence around each repetition, including each phrase repetition.'],
        ['Track Repeats', 'Repeat the padded base pattern, then wait for the longest track. Explicit phrase sections determine their own length.'],
        ['Fade In / Out (0–64 bars)', 'Audio fades over the track’s active span. They do not change exported MIDI velocities.'],
      ] } },
      { title: 'Calculate a loop', paragraphs: ['One step lasts 60 / (BPM × denominator) seconds. One track bar lasts numerator × 60 / BPM seconds. Without explicit sections, track length is delay + repeats × (padding before + pattern duration + padding after). At 120 BPM, numerator 4 and denominator 4, a 16-step pattern is 2 seconds.'] },
      { title: 'Level and output', paragraphs: ['Track Gain is −96 to +24 dB for internal audio. Track Velocity Multiplier is 0–4× and affects note dynamics independently. MIDI Channel is 1–16. Master gain is a separate sum-of-tracks control. Polyphony, unison and glide are in Voices & Glide.'] },
    ], related: ['time-warp', 'activation', 'voices', 'phrases'],
  },
  {
    id: 'activation', group: 'Sequencing & timing', title: 'Track Activation (B)',
    summary: 'Switch groups of tracks on and off over equal portions of the song loop.', location: 'Arrangement → Track Activation (B)', keywords: 'bitmask mute song arrangement gating',
    sections: [
      { title: 'Write the activation sequence', paragraphs: ['Leave B blank to disable gating. Otherwise enter nonnegative decimal bitmasks. Bit 0 controls the first track, bit 1 the second, and so on. N masks divide the full longest-track loop into N equal time chunks, regardless of each track’s meter.'], table: { headings: ['Mask', 'Active tracks'], rows: [['0', 'None'], ['1', 'First'], ['2', 'Second'], ['3', 'First and second'], ['5', 'First and third']] } },
      { title: 'Example and boundaries', paragraphs: ['With two tracks, 1 2 3 0 plays the first track alone, then the second, then both, then neither, each for a quarter of the song loop. Activation evaluates the final timed onset. An inactive onset is omitted; an active gate is clipped at the first later inactive boundary. Release and effect tails can still sound.'], bullets: ['Track reordering or deletion changes which track each bit addresses. Review B afterward.', 'The track strip darkens inactive chunks. Mute/solo is separate from saved activation.', 'Phrase sections do not replace B chunks. Ties cannot bridge an inactive chunk.'] },
    ], related: ['workspace', 'playback', 'phrases'],
  },
  {
    id: 'time-warp', group: 'Sequencing & timing', title: 'Time Warp',
    summary: 'Reshape note onsets inside a pattern without changing its overall duration.', location: 'Track editor → Time Warp', target: editor('time-warp'),
    sections: [
      { title: 'Controls', table: { headings: ['Control', 'Use'], rows: [
        ['Enable Time Warp / Warp amount', 'Enable processing and blend between straight timing (0%) and the selected mapping (100%).'],
        ['Warp curve', 'Choose a built-in curve using its thumbnail, or Custom for an expression. Reversing/nonmonotonic curves can reorder attacks.'],
        ['Warp chunks', 'Divide the pattern into equal pieces; apply the mapping independently in each piece.'],
        ['Warp note lengths', 'Map gate ends as well as onsets. Endpoints are bounded to the chunk and durations stay positive. Off keeps the base gate lengths.'],
        ['Grid quantize', 'Off keeps continuous timing. The step/substep choices snap warped positions; they take effect when warp amount is above zero.'],
      ] } },
      { title: 'Custom expressions and order', paragraphs: ['T is normalized time within a chunk, from 0 to 1. T is identity; T*T accelerates the spacing from early to late attacks. The expression editor accepts math functions and the legacy assignment form. Output is blended with identity then constrained to 0–1. Invalid syntax displays an error and uses identity; non-finite evaluations fall back to the original time.', 'Time warp and optional grid snapping happen before the phase shift. Phrase repetition restarts the mapping. Articulation timing offsets are applied afterward, then activation and boundaries limit the result. The preview shows the mapping and step positions, not a change in song length.'] },
    ], related: ['playback', 'articulation', 'automation'],
  },
  {
    id: 'engines', group: 'Instruments', title: 'Synth engines & signal flow',
    summary: 'Choose among nine melodic engines, or combine two with AM/RM.', location: 'Track editor → Generator', target: editor('generator'),
    sections: [
      { title: 'Choose a source', table: { headings: ['Engine', 'Sound and controls'], rows: [
        ['Additive', 'Waveform, Tonewheel, Sequence or Binary partial amplitudes; spectral shaping and multidimensional morphing.'],
        ['Partial Bank', 'The same amplitude sources with movable fractional partial frequencies.'],
        ['Resonant noise', 'White/pink/brown noise through a pitch-tracking resonator bank.'],
        ['Vocal choir', 'Voiced source and breath through five vowel formants with ensemble detuning.'],
        ['Modal percussion', 'Struck bell, bar, glass or harmonic modes with individual decay.'],
        ['Variable pulse', 'Continuous pulse width with a bounded harmonic count.'],
        ['Two-operator FM', 'Sine carrier and modulator with a dedicated index envelope.'],
        ['Plucked string', 'Tuned string with seeded excitation, brightness and pluck position.'],
        ['Granular sampler', 'Overlapping grains from a sample asset.'],
      ] } },
      { title: 'Shared controls', paragraphs: ['Melodic engines share notes, amp/pitch envelopes, glide, voice filtering and track effects. Switching engines retains their stored settings. Amp/pitch/filter and engine motion live in Modulation; drum lane envelopes live in Drum Sounds.', 'Melodic voice processing feeds Drive, track level, enabled modulation effects, echo and fades. Global reverb and auxiliary returns join the mix before master trim, soft clipping and Master Pulse. Drum lanes have their own synthesis/filter/send paths before shared track processing.'] },
      { title: 'Combine engines', paragraphs: ['Choose Amplitude modulation (AM) or Ring modulation (RM). Engine A · Carrier supplies sound; Engine B · Modulator shapes A’s amplitude. AM uses a unipolar modulator; RM uses a bipolar modulator. Depth blends from the original A signal. Engine B frequency ratio (0.125–8×) tunes B relative to the played note. B has independent source settings and source modulation, with shared track notes, amp/pitch envelopes, glide, filter and effects.', 'Single engine or zero depth preserves A’s original sound. Switching combination off retains B’s settings. AM/RM is separate from the Two-operator FM synth engine.'] },
      { title: 'Older presets', paragraphs: ['Active legacy wind/resonance/frozen-noise waveforms migrate to Resonant noise; Choir Ah/Oh migrate to Vocal choir. Inactive waveform metadata on other partial sources does not change their engine. Retired generatorType/fmSynth and virtual-analog fields are ignored; the current FM engine uses its own settings.'] },
    ], related: ['partials', 'partial-bank', 'noise-choir', 'modal', 'pulse-fm', 'pluck', 'granular'],
  },
  {
    id: 'partials', group: 'Instruments', title: 'Partial sources & spectrum',
    summary: 'Build additive amplitudes from waveforms, drawbars, number sequences or binary functions.', location: 'Generator → Additive / Partial Bank → Partial source', target: editor('generator'),
    sections: [
      { title: 'Sources', table: { headings: ['Source', 'Meaning'], rows: [
        ['Tonewheel', 'Nine drawbars (0–8) at organ-style partial ratios, including subharmonic/fractional positions. Each drawbar changes one partial’s level.'],
        ['Waveform', 'Sine, triangle, sawtooth, square and fixed 25%/12.5% pulses. Sine has only a fundamental; raising harmonic count does not invent new harmonics.'],
        ['Sequence', 'Natural, Fibonacci, primes, powers of two, triangular, Lucas, divisor count, Stern, totient, Thue–Morse and Recamán values set amplitudes, not note pitches. Thue–Morse and Recamán start at n=0 with zero amplitude.'],
        ['Binary', 'Popcount, parity, selected bit, Gray code, Gray popcount, bit length, ruler, longest one-run, one-run count, Rudin–Shapiro and bit reversal. The first value sets harmonic 1.'],
      ] } },
      { title: 'Shape the spectrum', bullets: [
        'Harmonic count limits eligible harmonics to 1–64. Playback further removes partials above its pitch-dependent frequency limit.',
        'Amplitude mapping offers linear, power, square-root, inverse, logarithmic, inverse square-root, saturating and modulo. Inverse mappings keep zeros silent; modulo uses the raw remainder, so exact multiples become zero.',
        'Harmonic masks keep odd, even, prime, Fibonacci, powers of two, square, triangular, Thue–Morse or periodic harmonic numbers. Invert swaps kept/removed harmonics; None clears inversion. Period 4 / offset 0 keeps harmonics 1, 5, 9…',
        'Tilt changes level per octave (−24 to +24 dB/oct). Contrast changes the relative amplitude distribution. Positive odd/even balance favors even harmonics; fractional drawbars are unaffected. Peak normalization scales the largest eligible amplitude.',
        'Selected bit uses index 0–5. Bit reversal uses 1–6 low bits; width 3 produces 0, 4, 2, 6, 1, 5, 3, 7 and repeats. Ruler counts trailing zeros in n+1. Rudin–Shapiro counts overlapping 11 pairs modulo two.',
      ] },
      { title: 'Preview and breath', paragraphs: ['The spectrum graph shows magnitudes down to −60 dB relative to the largest partial and reports actual peak amplitude. Negative Fourier coefficients change phase, not bar direction. An all-zero spectrum is marked silent. Preview excludes pitch-dependent band limiting, modulation animation, envelopes, breath and effects.', 'Breath noise adds one filtered pink-noise layer per melodic event. Level sets its blend and Harmonic sets the band-pass center relative to the event’s mean pitch. It is separate from the Resonant noise engine.'] },
    ], related: ['wavetable', 'partial-bank', 'vector', 'modulation'],
  },
  {
    id: 'partial-bank', group: 'Instruments', title: 'Partial Bank',
    summary: 'Move partial frequencies independently of their amplitudes for stretched or inharmonic tones.', location: 'Generator → Synth engine → Partial Bank', target: editor('generator'),
    sections: [
      { title: 'Position functions', paragraphs: ['The selected partial source supplies amplitudes. Position function and Target position function map each original ratio n to a new frequency ratio. Position morph blends between their results; Anchor 1× to played note keeps the fundamental reference fixed.', 'The 20 functions cover harmonic scaling, power/stretch, stiff-string and subharmonic layouts, prime/Fibonacci sequences, pitch grids, clusters, ripple, seeded detuning and custom expressions. Each function exposes its own a, b and c controls and explanation. A jitter seed makes detuning repeatable.'], bullets: ['Custom Position expression uses n for the original ratio and a, b, c for parameters. Example: n*(1+a*(n-1)) spreads higher partials as a rises.', 'Modulation destinations include Position / Target a, b, c and Position morph. Use small changes first; extreme ratios can move partials outside the audible range.', 'The preview shows static positions, not animated modulation. Unison count changes affect newly started notes.'] },
      { title: 'Function reference', table: { headings: ['Function', 'Behavior', 'Parameters'], rows: Object.values(POSITION_FUNCTIONS).map(f => [f.title, f.description, f.parameters.map(p => `${p.title}: ${p.min} to ${p.max}`).join('; ') || 'None']) } },
    ], related: ['partials', 'modulation', 'voices'],
  },
  {
    id: 'noise-choir', group: 'Instruments', title: 'Resonant noise & Vocal choir',
    summary: 'Shape air, reed and vowel textures with resonances and per-note motion.', location: 'Generator → Synth engine · Modulation', target: editor('generator'),
    sections: [
      { title: 'Resonant noise', paragraphs: ['Noise starting point provides editable recipes such as Air column, Reed buzz, Hollow pipe and Wind wash. Choose white, pink or brown Noise color. Resonator base is the center frequency at A4; Pitch tracking from 0–1 sets how much the bank follows notes and glide.'], table: { headings: ['Control', 'Effect'], rows: [['Resonator count / Q', '1–8 resonances; higher Q rings more narrowly.'], ['Spacing exponent', 'Changes frequency spacing between resonators.'], ['Odd/even balance / Tilt', 'Balance alternate resonators and change brightness across the bank.'], ['Unfiltered noise mix', 'Blend raw noise alongside the resonances.'], ['Resonator envelope / LFO', 'In Modulation: ADSR plus signed semitone amount, or rate/depth for recurring motion.']] } },
      { title: 'Vocal choir', paragraphs: ['Choose starting and target vowels from Ah, Eh, Ee, Oh and Oo. Vocal tract shift moves formants in semitones; bandwidth widens or narrows them. Glottal brightness and breath blend shape the excitation. Use 1–8 ensemble singers and detune for thickness. Individual formants exposes five frequency offsets and gains.', 'In Modulation, Vowel transition sets target blend and transition time per note; time 0 gives a fixed blend. Choir vibrato controls singer pitch movement in Hz and cents. A choir starting point applies an editable recipe.'] },
    ], related: ['engines', 'modulation', 'voices'],
  },
  {
    id: 'modal', group: 'Instruments', title: 'Modal percussion',
    summary: 'Strike tuned resonant bodies from a melodic sequence.', location: 'Generator → Synth engine → Modal percussion', target: editor('generator'),
    sections: [
      { title: 'Shape the strike and ring', paragraphs: ['Choose bell, bar, glass or harmonic Resonant material. Resonant modes sets how many ringing frequencies participate. Ring decay sets the overall tail; High mode damping makes upper modes fade faster. Strike brightness changes the initial spectral slope and Strike noise adds a transient.', 'The shared amp envelope still constrains the audible result, so lengthen its release when you want the body to ring. Route an envelope or LFO to Modal damping for changing decay color. This is a melodic engine, distinct from a rhythmic drum lane.'] }, controls('modal'),
    ], related: ['modulation', 'engines', 'drum-sounds'],
  },
  {
    id: 'pulse-fm', group: 'Instruments', title: 'Variable pulse & Two-operator FM',
    summary: 'Animate pulse width or FM index for leads, basses and metallic tones.', location: 'Generator → Synth engine', target: editor('generator'),
    sections: [
      { title: 'Variable pulse', paragraphs: ['Pulse width moves continuously from 0.02 to 0.98; 0.5 is a symmetric pulse. Harmonic count limits brightness and cost. Route an LFO or envelope to Pulse width to animate the timbre. Fixed Pulse 25% and 12.5% waveforms in Additive are separate static spectra.'] },
      { ...controls('pulse'), title: 'Pulse controls' },
      { title: 'Two-operator FM', paragraphs: ['A sine modulator changes a sine carrier’s frequency. Modulator / carrier ratio sets frequency spacing, including fractional ratios; Modulation index sets the strength of added components. Its dedicated ADSR shapes index, while the shared amp envelope shapes loudness. Route additional sources to FM index in Modulation. Increasing index can make the result brighter or metallic.'] },
      { ...controls('fm'), title: 'FM controls' },
    ], related: ['engines', 'modulation', 'voices'],
  },
  {
    id: 'pluck', group: 'Instruments', title: 'Plucked string',
    summary: 'Tune a decaying string with repeatable excitation.', location: 'Generator → Synth engine → Plucked string', target: editor('generator'),
    sections: [
      { title: 'Shape the string', paragraphs: ['String decay sets ringing time. Brightness controls high-frequency loss; Pluck position changes the initial harmonic color. Excitation seed repeats the initial noise pattern. The tuned frequency range is 20–8,000 Hz.', 'Route modulation to Pluck brightness. On a monophonic track, overlapping legato notes retain the vibrating string; separate attacks excite it again. The amp envelope and gate can shorten the audible ring.'] }, controls('pluck'),
    ], related: ['voices', 'modulation', 'playback'],
  },
  {
    id: 'granular', group: 'Instruments', title: 'Granular sampler',
    summary: 'Create a cloud of grains from an imported sample.', location: 'Samples → import · Generator → Granular sampler', target: editor('generator'),
    sections: [
      { title: 'Choose and explore an asset', paragraphs: ['Import a WAV in Samples, then choose it in Grain sample. A missing/unselected asset cannot sound. Sample root sets tuning; Grain size and Grains per second control texture and overlap. Position chooses where grains read; Position scatter and Pitch scatter introduce seeded variation. Stereo assets are mixed to mono before track pan/effects.', 'Up to 32 grains overlap per voice. Route envelopes or LFOs to Grain position and Grain size. This generator uses the selected asset directly; Add sample voice in Samples configures the separate one-shot/loop sampler.'] }, controls('granular'),
    ], related: ['tutorial-samples', 'samples', 'modulation'],
  },
  {
    id: 'wavetable', group: 'Instruments', title: 'Multidimensional wavetable',
    summary: 'Interpolate sparse configurations of additive sources across up to 16 axes.', location: 'Generator → Multidimensional wavetable', target: editor('generator'),
    sections: [
      { title: 'Axes, positions and configurations', paragraphs: ['A wavetable can store Tonewheel, Waveform, Sequence and Binary source snapshots. It is not limited to drawbars. On first enable it creates a Brightness axis and two identical copies of the current source named Configuration 1 and Configuration 2. Edit the copies to make distinct endpoints.'], bullets: [
        'An axis has a name and a current value from 0–100%. All current values together determine the playback position.',
        'Configuration to edit selects a stored sound. Its position fields place it in the morph space; editing its source changes that configuration, not every endpoint.',
        'Copy configuration here copies the selected configuration’s source at the current axis position. It does not capture the interpolated blend. Rename the copy and adjust its source or drawbars.',
        'Nearby configurations blend by inverse squared distance; an exact match selects that configuration. Sparse points are sufficient; every grid corner is not required.',
        'Up to 16 axes and 64 configurations are supported. Adding an axis centers existing configurations on it. Removing an axis removes its coordinates and vector routes; removing the last disables the wavetable while retaining that stored axis. At least one configuration must remain when enabled.',
        'Disabling the wavetable restores the fixed source and retains stored configurations. Vector LFOs in Modulation animate its position.',
      ] },
    ], related: ['tutorial-wavetable', 'vector', 'partials', 'partial-bank'],
  },
  {
    id: 'voices', group: 'Sound & effects', title: 'Voices, unison & glide',
    summary: 'Control note overlap, voice thickness and pitch transitions.', location: 'Track editor → Voices & Glide', target: editor('unison'), keywords: 'polyphony mono legato portamento',
    sections: [
      { title: 'Polyphony and unison', paragraphs: ['Voices sets simultaneous melodic note capacity; 1 selects mono. Chords and overlapping releases use available polyphonic voices. Unison Voices (1–8) adds detuned copies within each note; Unison Detune (0–100 cents) sets spread. More polyphony, unison and partials increase processing cost. Engine B has its own unison controls in its source panel.'] },
      { title: 'Mono glide', paragraphs: ['Glide controls are enabled in mono. Glide Time sets transition duration; Constant Rate interprets it as seconds per octave instead of fixed time per transition. Glide Mode legato slides only between overlapping notes; always slides between each note. Glide Curve chooses exponential or linear pitch movement. Legato keeps envelopes through overlapping notes; without overlap, a new attack retriggers them.', 'Use Note Length or Articulation to overlap gates deliberately. Per-step Slide and Legato in Articulation can override the mono behavior for individual attacks. They do not turn a polyphonic track into a mono track.'] },
    ], related: ['playback', 'modulation', 'articulation'],
  },
  {
    id: 'modulation', group: 'Sound & effects', title: 'Envelopes, LFOs & modulation routes',
    summary: 'Connect reusable motion sources to sound parameters and edit fixed envelopes in one place.', location: 'Track editor → Modulation', target: editor('modulation'), keywords: 'ADSR attack decay sustain release tremolo vibrato matrix spectral',
    sections: [
      { title: 'Envelopes and fixed motion', table: { headings: ['Panel', 'Meaning'], rows: [
        ['Amp envelope', 'Attack rises to peak, decay reaches sustain, sustain holds during the gate and release fades after it ends. This envelope limits voice lifetime.'],
        ['Pitch envelope', 'ADSR plus signed semitone amount. Curve is exponential steepness; 0 is linear.'],
        ['Filter envelope / LFO', 'Move enabled filter cutoff in semitones. LFO supports shape, sync/free rate, phase and retrigger. A disabled filter makes these inaudible.'],
        ['Tremolo / Vibrato', 'Track-level amplitude/pitch motion with free Hz rates and depth. Tremolo also offers stereo phase spread.'],
        ['Chorus / Flanger / Phaser LFO', 'Tempo cycle length and depth; chorus also offers stereo spread. Mix/feedback/tone stay in the effect tabs.'],
        ['Engine motion', 'Resonator envelope/LFO and choir vowel transition/vibrato appear for those engines. Drum lane envelopes remain in Drum Sounds.'],
      ] } },
      { title: 'Routed sources', bullets: [
        'Add named envelopes and LFOs, then add routes from each source to a destination with an amount. A source without an enabled route has no effect. Collapse editors to keep large patches compact.',
        'Destinations include pitch (semitones), level (dB), pan, filter cutoff/resonance/gain, spectral tilt/contrast/odd-even/count/exponent, Partial Bank position parameters and engine-specific controls. Available controls depend on the sound source.',
        'Routes offset the base setting. Multiple routes add, negative amounts invert motion, and bounds apply afterward. Example: tilt −6 plus a bipolar LFO amount 6 spans −12 to 0 dB/oct.',
        'Routed envelopes have ADSR and curve, are per voice, and hold through mono legato. Their release starts from their current value; the amp envelope still determines when the voice ends.',
        'LFOs provide seven shapes, Hz or tempo sync, initial phase, bipolar (−1 to +1) or unipolar (0 to +1) output, and voice-attack, song-start or free timing. Free phase uses the audio context clock; export starts its clock at zero.',
        'Bypass a source/route to retain settings. Removing a source removes its routes. There is no fixed route-count ceiling; active routes, harmonics, unison and sounding voices determine cost.',
        'Filter routes require an enabled filter. Gain routes affect shelf/peaking filters. Mapping exponent applies to Power mapping. Harmonic count reveals only partials supplied by the source.',
      ] },
      { title: 'Tempo divisions', paragraphs: ['A synced division is one full cycle: 1/4 is one quarter-note beat, 1/1 is four beats, 4/1 is sixteen beats. Dotted values last 1.5× and triplets 2/3× the straight duration. These divisions differ from the Playback Denominator, which counts steps per beat.'] },
    ], related: ['vector', 'filter', 'automation', 'voices'],
  },
  {
    id: 'vector', group: 'Sound & effects', title: 'Vector LFOs',
    summary: 'Animate wavetable axes with routed, optionally frequency-modulated LFOs.', location: 'Modulation → Vector modulation', target: editor('modulation'),
    sections: [
      { title: 'Routes and timing', paragraphs: ['Enable a wavetable with at least one axis, then add up to eight vector LFOs. Each route moves an axis by LFO output × Global depth × Route, added to the base position and constrained to 0–100%. Route 0 disconnects that axis; negative routes reverse movement. Enabled LFOs are applied in list order.'], table: { headings: ['Control', 'Meaning'], rows: [
        ['Shape', 'Sine, triangle, rising/falling saw, square, sample-and-hold or smooth random.'], ['Polarity', 'Bipolar moves above/below the base; unipolar moves in one direction.'],
        ['Tempo sync / Rate', 'One cycle per selected division, or a free rate of 0.01–20 Hz.'], ['Phase mode', 'Free running follows transport time; note-event and song-play retrigger modes reset their phase at those events.'],
        ['Initial phase / Smoothing', 'Offset the cycle and soften sharp/random changes.'], ['FM source / FM index', 'Use an earlier LFO to bend this LFO’s phase. Index is phase deviation in cycles, not Hz; earlier-only sources prevent circular routing.'],
      ] } },
      { title: 'If the sound stays still', paragraphs: ['Check wavetable enabled, LFO On, nonzero Global depth and at least one nonzero axis route. Make the stored configurations different. A base at an endpoint with unipolar motion can remain clamped at that endpoint.'] },
    ], related: ['wavetable', 'tutorial-wavetable', 'modulation'],
  },
  {
    id: 'filter', group: 'Sound & effects', title: 'Filter',
    summary: 'Shape tone with a key-following multimode filter and optional modulation.', location: 'Track editor → Filter', target: editor('filter'),
    sections: [
      { title: 'Filter reference', table: { headings: ['Control', 'Meaning'], rows: [
        ['Enable Filter', 'Adds the filter. Cutoff automation needs this enabled.'], ['Mode', 'Lowpass/highpass remove high/low frequencies; bandpass keeps a band; notch removes a band; allpass shifts phase; shelves and peaking boost/cut a region.'],
        ['Cutoff/Base (0–127 MIDI)', 'Pitch units, not Hz; for reference, MIDI 69 is A4 and normally 440 Hz.'], ['Q (0.01–30)', 'Resonance or bandwidth, depending on mode.'],
        ['Key Follow (−200% to +200%)', 'Moves cutoff with note pitch; 0% stays at base and negative values move opposite to pitch.'],
        ['Filter Gain (−48 to +48 dB)', 'Boost/cut amount for shelf and peaking modes.'], ['Rolloff', '−12, −24, −48 or −96 dB/oct; steeper slopes remove more out-of-band energy.'],
      ] } },
      { title: 'Where motion applies', paragraphs: ['Filter envelope and Filter LFO are in Modulation. Melodic filtering is per voice, so simultaneous notes can have different key tracking and envelopes. Drum lanes have individual filters in Drum Sounds, plus a shared track filter. Use Automation for song/note curves and Articulation for eligible per-attack locks.'] },
    ], related: ['tutorial-filter', 'modulation', 'drum-sounds', 'automation'],
  },
  {
    id: 'drive', group: 'Sound & effects', title: 'Waveshaper & Tanh Drive',
    summary: 'Apply transfer curves and a separate always-active tanh stage.', location: 'Track editor → Drive', target: editor('drive'), keywords: 'distortion saturation custom formula clipping',
    sections: [
      { title: 'Waveshaper controls', paragraphs: ['Enable Waveshaper for melodic or rhythmic tracks. Choose a built-in saturation, folding, rectification, polynomial, bell or sine-family curve, or Custom. Input Drive (−24 to +36 dB) feeds only the wet path; Mix blends it with dry. DC block applies a 10 Hz high-pass to the wet path. Disabling the waveshaper retains settings.'], bullets: [
        'The graph is a read-only transfer curve: x is the signed input sample, not time. Inputs outside −1 to +1 use endpoint values; finite outputs are clipped to that same range, not normalized.',
        'Custom formulas support constants PI and E and math functions. Free variables create controls: sin(k*x+p) exposes k and p. Each has editable value, Min, Max and Step; Min < Max and 0 < Step ≤ range.',
        'Invalid syntax or non-finite validation results bypass the whole optional effect, including wet drive and DC block. sqrt(x) fails on negative samples; 1/x fails at zero. Use a valid formula before expecting a change.',
        'Per-curve and custom settings are retained when switching curves. Waveshaper parameters do not support automation. Neither transfer stage uses oversampling; aggressive shaping can alias.',
      ] },
      { title: 'Separate Tanh Drive', paragraphs: ['Tanh Drive (−48 to +72 dB) applies gain before the legacy tanh lookup even when Waveshaper is off. This table clamps at tanh(±1), about ±0.7616, before later gain/effects; it is not a final output ceiling. The master uses a separate soft clip. Drive affects audio playback and WAV, not MIDI.'] },
    ], related: ['master', 'effects', 'cli'],
  },
  {
    id: 'effects', group: 'Sound & effects', title: 'Chorus, flanger, phaser & echo',
    summary: 'Add tempo-aware motion and repeating echoes to each track.', location: 'Track editor → Chorus / Flanger / Phaser / Echo & Sends', target: editor('effects'),
    sections: [
      { title: 'Insert effects', table: { headings: ['Effect', 'Controls and behavior'], rows: [
        ['Chorus', 'Enable, base delay (0.5–20 ms), feedback and wet level. Its LFO depth, tempo cycle and stereo spread are in Modulation.'],
        ['Flanger', 'Enable, short base delay (0.1–20 ms), feedback and wet level. Depth/cycle are in Modulation; moving delay produces comb-filter sweeps.'],
        ['Phaser', 'Enable, allpass stage count, center (MIDI pitch), feedback, resonance and wet level. Each stage pair makes one notch; four stages is a classic starting point. Sweep in Modulation spans ±(Sweep% of five octaves).'],
        ['Feedback Stereo Echo', 'Enable in Echo & Sends. Choose a tempo division for Echo Delay, feedback (0–0.95), wet level and optional ping-pong for alternating stereo repeats.'],
      ] } },
      { title: 'Mix, rate and sends', paragraphs: ['Wet controls use dB from −96 to 0. The phaser’s internal phase blend retains at least 50% wet for audible notches; its output wet control still adjusts the effect level. Feedback increases resonance/repeat persistence. Chorus, flanger and phaser cycles follow BPM through their Modulation controls.', 'Track Reverb Send in Echo & Sends feeds the single Global Reverb. Routing creates additional named auxiliary chains; those sends are separate from the legacy per-track echo and global reverb send.'] },
    ], related: ['modulation', 'reverb', 'routing', 'drive'],
  },
  {
    id: 'reverb', group: 'Sound & effects', title: 'Global Reverb',
    summary: 'Share one convolution reverb across the mix.', location: 'Track editor → Global Reverb · Inspector → Global reverb', target: editor('reverb'),
    sections: [
      { title: 'Controls and levels', paragraphs: ['Enable Global Reverb, then raise a track’s Reverb Send in Echo & Sends. Global Wet controls the shared return; Global Dry trims the dry mix. Low Cut and High Cut filter the reverb input and use MIDI pitch units. Pre-delay is the wait before the reverberation, and Decay sets its duration.', 'Decay Curvature (0.1–10) changes the fade shape: 1 gives the original exponential decay, lower values fade earlier, and higher values hold longer. It does not change decay duration or pre-delay. The deterministic pink-noise impulse is energy-normalized across sample rates. Playback and WAV rendering use the same settings.'] },
      { title: 'Troubleshooting', paragraphs: ['A raised wet return needs an enabled reverb and audible track send. Long releases and reverberation can extend past note blocks and activation boundaries. Reduce decay/send or master level if a dense mix becomes muddy or squashed. Reverb is exported as a separate wet stem.'] },
    ], related: ['effects', 'routing', 'master', 'render'],
  },
  {
    id: 'drum-sounds', group: 'Sound & effects', title: 'Drum Sounds',
    summary: 'Edit each synthesized kit voice’s body, transient, envelope, filter and sends.', location: 'Rhythmic track → Drum Sounds', target: editor('drum-sounds'),
    sections: [
      { title: 'Per-lane sound design', paragraphs: ['Select a lane to show the controls appropriate to its voice. The kit includes kick, rimshot, snare, clap, toms, closed/pedal/open hats, crash/ride/chinese/splash cymbals, cowbell, congas, timbales, triangles, shaker and chimes.', 'Body tuning and decay shape the pitched part; pitch sweep adds an attack bend; noise/transient controls change strike or rattle. Brightness and per-lane filtering shape the spectrum. The editor exposes applicable controls for each voice, rather than one identical synth for every drum.', 'Lane filter mode, frequency in Hz, resonance, slope and gain are independent of the shared track filter. Lane echo/reverb controls feed their applicable paths; shared track Drive and effects process the combined kit. XOR groups are configured in Sequence, not Drum Sounds.'] },
      { title: 'Sound control glossary', table: { headings: ['Controls', 'Use'], rows: [
        ['Tune / Pitch Sweep / Sweep Time / Pitch Shape', 'Set body frequency, initial pitch excursion in octaves, sweep duration and curve shape on voices that expose them.'],
        ['Decay / Amp Shape / Tone Decay / Noise Decay', 'Set the duration/shape of body and noise envelopes; short settings make tight hits.'],
        ['Drive Input / Drive / Wave Power', 'Drive Input applies dB gain before lane distortion. Kick Drive blends its power shaper and Wave Power changes that curve.'],
        ['Noise / Snap / Tone Mix / Noise Wash / Noise Color', 'Choose noise type and balance the transient, pitched body and noise tail; Noise Color is a filter frequency in Hz.'],
        ['Brightness / Harmonicity / FM Index', 'Shape metallic voices through brightness, frequency ratio and frequency-modulation strength.'],
        ['Filter / Filter Freq / Filter Reso / Filter Slope / Filter Gain', 'Select lane filter type, cutoff in Hz, resonance, rolloff and shelf/peaking gain.'],
        ['Velocity Filter / Filter Env', 'These legacy fields are retained and displayed, but the current drum renderers do not apply them. Use supported lane filter automation/locks for changing cutoff.'],
        ['Echo Send / Reverb Send', 'Per-lane dB sends; the destination echo/reverb must also be enabled to hear them.'],
      ] } },
      { title: 'Sampled lanes and articulation', paragraphs: ['Samples can replace a lane’s synthesized voice while preserving lane index and MIDI mapping. Applicable decay, tuning, filter and send controls still work; synthesized noise/transient controls cannot recreate a sample and unsupported locks are rejected. Articulation can lock eligible parameters per hit, with fresh settings on every attack.'] },
      { title: 'Kit MIDI map', table: { headings: ['Voice', 'MIDI note'], rows: DRUM_VOICE_OPTIONS.map(voice => [voice.title, String(voice.midi)]) } },
    ], related: ['drums', 'samples', 'articulation', 'routing'],
  },
  {
    id: 'master', group: 'Sound & effects', title: 'Master output & Master Pulse',
    summary: 'Set final mix level, tuning and synchronized stereo amplitude motion.', location: 'Inspector → Master Output · Mixer',
    sections: [
      { title: 'Master trim and tuning', paragraphs: ['Master gain (−96 to +12 dB, default 0) trims the summed tracks and returns. A soft clip is exactly linear below amplitude 0.75 and approaches full scale above it. Lower master or track levels if the mix sounds compressed. Playback and WAV export share this stage. A4 in the harmony inspector tunes internal melodic audio from 380–500 Hz (default 440); MIDI notes do not encode that tuning.'] },
      { title: 'Master Pulse', table: { headings: ['Control', 'Meaning'], rows: [
        ['Enabled / Shape', 'Pulse both stereo channels together, including reverb. Choose Sine, Triangle or Pulse.'], ['Rate mode', 'Free frequency 0.1–80 Hz or a tempo division for each cycle.'],
        ['Depth', '0% leaves the level unchanged; 100% reaches silence at the envelope minimum.'], ['Pulse width / Edge softness', 'Pulse mode only: duty cycle 5–95% and smoothed transitions 0.1–50 ms.'],
        ['Frequency shortcuts', 'Delta 2, Theta 6, Alpha 10, Beta 20 and Gamma 40 Hz set example rates; the labels do not promise mental effects.'],
      ] }, paragraphs: ['Pulse follows master soft clipping, resets on Play/Restart and stays continuous across song loops. It is included in the mixed WAV. MIDI is unchanged. Stems carry the settings for applying this stage once after recombination.'] },
    ], related: ['reverb', 'render', 'modulation'],
  },
  {
    id: 'phrases', group: 'Developing a track', title: 'Phrases, sections & conditions',
    summary: 'Arrange reusable patterns into fixed-length sections with deterministic variation.', location: 'Editor dock → Phrases', target: dock('phrases'),
    sections: [
      { title: 'Enable and capture', paragraphs: ['Develop this track enables phrases, articulation and automation. Saved variation seed controls repeatable choices. Capture sequence creates a named phrase from the base sequence. Edit phrase text here or use Editing pattern in Sequence. Phrase sound overrides set eligible voice settings relative to the track’s base.', 'Without sections, the base sequence, delay, padding and repeats still set playback length. A stored phrase bank alone does not arrange a song.'] },
      { title: 'Sections', bullets: [
        'Add section chooses a phrase and positive length in bars or beats. One phrase bar uses that track’s numerator in quarter-note beats. Delay occurs once before the arrangement; Track Repeats does not multiply explicit sections.',
        'Each section repeats its phrase to fill its length; the last repetition may be partial. Phase, padding and time warp restart on each phrase repetition. Move sections up or delete them with their row controls.',
        'Cut ends gates and blocks ties at the boundary. Carry permits overlapping gates and valid ties to continue. Both can leave release/effect tails audible.',
        'Fill marks a section for Fill only conditions. Conditional alternatives fit the default phrase’s repetition slot: longer choices are truncated and shorter choices leave space, so later sections do not move.',
      ] },
      { title: 'Conditions', paragraphs: ['Every N repetitions, First only, Fill only and Chance (0–1) combine. Every 2 means repetitions 2, 4, 6…; repetition counting restarts in each section. Choices are evaluated in displayed order and the last matching choice wins. Chance 0 never passes and 1 always passes. Saved seeds and stable event identities make choices repeatable across playback, full renders and excerpts.'] },
    ], related: ['tutorial-phrases', 'articulation', 'automation', 'activation'],
  },
  {
    id: 'articulation', group: 'Developing a track', title: 'Articulation, ties & step locks',
    summary: 'Set per-step velocity, gates, timing, conditions and sound overrides.', location: 'Editor dock → Articulation', target: dock('steps'),
    sections: [
      { title: 'Scope and indexing', paragraphs: ['Enable Develop this track. Articulation scope selects All phrases (track-level controls) or one captured phrase. Step and drum Lane indices begin at 0 here; the note grid displays steps from 1. Leave lane/note empty to affect the whole event. A MIDI note selector applies only to that pitch within a melodic chord. Track controls apply before pattern-specific controls.'] },
      { title: 'Control reference', table: { headings: ['Control', 'Behavior'], rows: [
        ['Velocity / variation', 'Normalized 0–1 override and deterministic ± variation; final velocity is bounded to 0–1.'], ['Gate × / Duration', 'Gate scales scheduled duration. Duration (beats), when supplied, replaces it.'],
        ['Tie', 'Join touching/overlapping gates of the same pitch, remove the next attack and retain the first voice’s settings. Drums use choke/retrigger instead.'],
        ['Slide / Legato', 'Mono melodic tracks only. Slide is seconds; legato retains envelopes across overlap.'], ['Timing offset / variation', 'Signed beat offset and repeatable ± beat variation after phase/time warp. Attacks outside their section are dropped.'],
        ['Conditions', 'Every N, chance, first and fill decide whether the attack exists, not merely whether its accent applies.'], ['Locks', 'Override eligible voice parameters for this event. The next attack starts fresh; locks do not stick. Shared buses cannot be locked per voice.'],
      ] } },
      { title: 'Sound precedence', paragraphs: ['Track/lane base and phrase overrides → sound snapshot → timeline curves (last connected curve wins) → step locks → LFO/envelope offsets and limits. Use Automation for shared track gain/echo changes. Per-hit send locks change the send without changing the dry level.'] },
    ], related: ['tutorial-phrases', 'automation', 'snapshots', 'voices'],
  },
  {
    id: 'automation', group: 'Developing a track', title: 'Automation & graph editing',
    summary: 'Draw beat-based curves with exact numeric editing and keyboard control.', location: 'Editor dock → Automation · Routing → Return motion', target: dock('motion'), keywords: 'motion curve points snap graph timeline',
    sections: [
      { title: 'Create a curve', paragraphs: ['Enable Develop this track and Add motion curve. Choose Control, Curve (linear, smooth or step) and Clock. Song uses beats from song start; note uses beats since each attack. Shared bus controls and return curves use song time. Optional drum Lane restricts compatible voice controls. Discrete controls require step interpolation.', 'Continuous filter/level/send controls can change while notes sound. Voice envelopes and discrete settings are captured at attacks. Multiple curves for one control are evaluated in order; the last connected curve wins.'] },
      { title: 'Edit without opening extra panels', table: { headings: ['Action', 'How'], rows: [
        ['Add / select', 'Click empty graph space to add a point. Clicking an existing beat selects that point. Add point appends a point four beats after the last.'],
        ['Move', 'Drag a handle. A completed drag commits one edit; Escape or pointer cancellation restores the pre-drag curve.'],
        ['Precise values', 'Select a point for Beat/Value fields. All points expands the numeric table. Numeric inputs are exact and ignore snapping.'],
        ['Snap', 'Default ¼ beat. Choose Off, 1, ½, ¼, ⅛ or ¹⁄₁₆ beat for graph/keyboard timing.'],
        ['Keyboard', 'Focus a handle. Left/right change beat by snap (0.01 when Off); up/down change value. Shift makes numeric moves ten times larger. Delete/Backspace removes the point.'],
        ['Navigate', 'From / To select the visible beat range. Fit points includes the stored points; view changes do not alter the curve.'],
        ['Discrete values', 'Stepped bands and a value select prevent intermediate enum values.'],
      ] } },
      { title: 'Validation and playback', paragraphs: ['Points require finite values, supported target ranges and unique beat positions. Invalid edits display a message and do not replace valid data. Changing Control retargets the curve to the new control’s valid values. Committing a project edit stops developed playback; press Play to prepare the updated sound.'] },
    ], related: ['tutorial-filter', 'snapshots', 'modulation', 'routing'],
  },
  {
    id: 'snapshots', group: 'Developing a track', title: 'Sound snapshots',
    summary: 'Capture selected sound settings and recall or morph them on the timeline.', location: 'Automation → Settings to capture', target: dock('motion'),
    sections: [
      { title: 'Capture and place', steps: ['Select Settings to capture, then Capture sound snapshot. Name the saved sound so you can identify it.', 'Choose Place on timeline. Set Start beat and Morph beats. Start beats use the song clock; morph length 0 recalls immediately.', 'Add further snapshots and cues for transitions. A compatible drum-only voice snapshot can optionally target a lane. Delete a snapshot to remove its cues as well.'] },
      { title: 'Morph and override rules', paragraphs: ['Compatible numeric settings morph linearly; discrete settings change at the morph end. An overlapping morph starts from the value actually reached by the previous morph at that cue, avoiding a jump back to an old endpoint.', 'Timeline curves override snapshot values, then step locks override those curves and LFO/envelope modulation adds its offsets. If recalling a snapshot seems ineffective, check later layers affecting the same control.'] },
    ], related: ['automation', 'articulation', 'phrases'],
  },
  {
    id: 'routing', group: 'Studio & delivery', title: 'Routing & dub returns',
    summary: 'Send tracks or drum lanes into shared ordered effect chains.', location: 'Editor dock → Routing', target: dock('returns'),
    sections: [
      { title: 'Build a return', steps: ['Enable Develop this track in Phrases, then open Routing and Add dub return. Give it a name and set Return level (dB).', 'Raise This track send from its silent default of −96 dB. For drums, Individual lane sends can override the track send.', 'Add delay, filter, saturation or gain processors. Use the up arrows to set processing order; delete a processor to remove it.', 'Expand Return motion and Add curve to automate a return control. Use the same graph, snap and numeric editing as track Automation.'] },
      { title: 'Routing and processor behavior', paragraphs: ['Sends tap individual voices/lane output before shared track inserts, with track level and fade applied. Returns process the chain in listed order and then Return level, feeding the pre-master mix. Returns cannot feed other returns.', 'Delay outputs repeats only. Its beats control sets delay time, feedback is 0–0.95, cutoff filters the feedback and drive saturates inside the feedback loop. Modes are stereo, mono and ping-pong. Automating delay time changes pitch. Filter supports lowpass/highpass; saturation adds drive and gain adjusts level.', 'Individual lane sends are constant song curves at beat 0 and can be developed in Automation. Deleting a return removes its associated sends, curves and locks. Global Reverb and per-track Echo are separate paths.'] },
    ], related: ['automation', 'effects', 'reverb', 'render'],
  },
  {
    id: 'samples', group: 'Studio & delivery', title: 'Samples & velocity layers',
    summary: 'Use portable sample assets as melodic voices or drum replacements.', location: 'Editor dock → Samples', target: dock('samples'),
    sections: [
      { title: 'Import and assign', paragraphs: ['Supported input is mono/stereo RIFF WAV at 8–192 kHz: PCM 8/16/24/32-bit or IEEE float 32/64-bit. Compressed WAV, MP3 and other containers are unsupported. Imported assets are deduplicated by audio/rate/channel hash. They live in the project, not in temporary file paths.', 'Add sample voice assigns an asset to the melodic source or a selected drum lane. Enable Develop this track in Phrases to use those sources. Importing an asset for Granular sampler does not require adding a sample voice.'] },
      { title: 'Sample voice controls', table: { headings: ['Control', 'Meaning'], rows: [
        ['Start / End seconds', 'Choose the playable region; blank end uses the asset end.'], ['Root MIDI note / Tune', 'Original pitch and semitone correction. Playback resamples with note pitch.'],
        ['Gain / Attack / Release', 'Sample source level and envelope. The melodic track amp envelope also constrains the sound.'], ['one-shot / loop', 'One-shot stops at region end or gate release; loop wraps the region until release.'],
        ['Alternatives', 'Round-robin cycles eligible layers; random uses the saved seed.'], ['Min / Max velocity', 'Inclusive normalized 0–1 bounds for each alternative. A resolved hit with no eligible layer is an error.'],
      ] } },
      { title: 'Continuity and portability', paragraphs: ['Mono legato keeps sample position/envelope when the selected asset and region stay the same. Choosing another alternative restarts the source. Drum sample hits keep choke and retrigger rules. Preset/library exports and Portable project embed the PCM assets. Bounce to sample in Render adds a reusable rendered asset with provenance; assign it like any other sample.'] },
    ], related: ['tutorial-samples', 'granular', 'render', 'presets'],
  },
  {
    id: 'render', group: 'Studio & delivery', title: 'WAV, stems, excerpts & bounce',
    summary: 'Export a mix, separate sources, a selected range or a reusable sample.', location: 'Export menu · Editor dock → Render', target: dock('render'),
    sections: [
      { title: 'Choose an output', table: { headings: ['Action', 'Output'], rows: [
        ['Export → Download WAV', 'Full stereo mix with automatic release/effect tail, 48 kHz 24-bit PCM with TPDF dither.'], ['Render → Export WAV', 'Studio renderer mix or selected range, also 48 kHz 24-bit PCM.'],
        ['Export stems', '48 kHz 32-bit float WAV files and stems.json. Float preserves unmastered values above full scale.'], ['Include drum sources / sources before inserts', 'Optional editing stems, separate from the files used for recombination.'],
        ['Bounce to sample', 'Add the chosen mix, track or return to project assets, retaining source project/range metadata.'], ['Portable project / Share URL', 'Editable project with embedded samples, or a copied project URL. Prefer the file for large audio.'],
      ] } },
      { title: 'Selected ranges and preparation', paragraphs: ['Ranges are zero-based with an exclusive end and units of bars, beats or seconds. Render-range bars use the first track’s numerator in quarter-note beats; phrase-section bars use their own track’s numerator. The rendering API can explicitly override beatsPerBar. Excerpts resolve the full schedule and process from song origin to the requested end before cropping, preserving earlier notes, filter state, random choices, delay and reverb. A late short excerpt can still take time to prepare.', 'Progress reports preparation/render/encoding and measurements such as duration, peak and RMS. Cancel aborts work; another render can start after cancellation. The browser caches completed work within a bounded 256 MiB cache, but settings or assets may invalidate it. Rendering does not lower synthesis quality to speed up an excerpt.'] },
      { title: 'Recombine stems correctly', paragraphs: ['Sum only stems marked recombine: true in stems.json: post-insert tracks, Global Reverb and auxiliary returns. Then apply master gain, GateRunner soft clip and Master Pulse once, using the original range start as the song-time offset. Do not also add pre-insert or individual lane sources: they are marked recombine: false.', 'Track/lane source stems omit shared inserts and cannot reconstruct nonlinear processing by independently applying it to every lane. Import every stem at the same position in your DAW. The browser may ask to allow multiple downloads.'] },
    ], related: ['tutorial-export', 'samples', 'master', 'midi', 'cli'],
  },
  {
    id: 'midi', group: 'Studio & delivery', title: 'MIDI output & files',
    summary: 'Send notes to external instruments or export a MIDI arrangement.', location: 'Audio / MIDI · Playback → MIDI Channel · Export',
    sections: [
      { title: 'External playback', steps: ['Connect your device and open Audio / MIDI. Enable MIDI Output and grant the browser’s MIDI permission if requested.', 'Choose MIDI Device. Set each track’s MIDI Channel in Playback to match the receiving instrument; rhythmic tracks default to channel 10.', 'Press Play. In MIDI mode GateRunner sends notes to the device and hides internal audio controls. Turn MIDI Output off to use the built-in engines again.'] },
      { title: 'What transfers', paragraphs: ['Export → Download MIDI writes the project’s note arrangement with timing, durations, velocity and track channels. Developed articulation is resolved into events; supported mono slide behavior uses MIDI controls. Synth engines, filters, modulation audio, effects, samples, master gain, A4 audio tuning and Master Pulse are not rendered into MIDI. Use WAV to preserve the sound.', 'External MIDI and file export are separate: you do not need a selected hardware device to download MIDI. If no devices appear, check browser support, permissions and the connection, then refresh the device list by reopening MIDI mode.'] },
    ], related: ['playback', 'drums', 'render', 'troubleshooting'],
  },
  {
    id: 'audio', group: 'Studio & delivery', title: 'Live audio & buffering',
    summary: 'Choose a device-local latency request and inspect scheduling diagnostics.', location: 'Audio / MIDI → Live audio buffering', keywords: 'latency crackling performance diagnostics',
    sections: [
      { title: 'Buffering modes', table: { headings: ['Mode', 'Request'], rows: [['Interactive', 'Lowest latency; potentially less protection against scheduling pressure.'], ['Playback', 'More output buffering, as chosen by the browser.'], ['Extended (default)', 'Requests 170 ms; the browser determines the actual latency.']] }, paragraphs: ['Stop playback before applying buffering. Applying clears remaining audio tails and keeps the preset and unsaved draft. This is a device-local preference, not a preset setting. Sound quality and WAV export stay the same; increased buffering can make controls feel slower.'] },
      { title: 'Read diagnostics', paragraphs: ['The dialog shows active request, sample rate, base/output latency, lookahead, late note callbacks and worst lateness. Counters reset on Play. They measure note scheduling, not CPU load or output glitches, so zero late callbacks does not rule out crackling. Export diagnostics downloads the report for troubleshooting.', 'Dense polyphony, unison, spectral motion, choir singers, granular voices and effects increase processing cost. Try a more buffered mode, reduce the active voice/harmonic count or use Bounce to sample. Developed projects use live playback when supported; sample sources, returns and other unsupported live controls require audio preparation. Live worklet-based generators require HTTPS or localhost.'] },
    ], related: ['troubleshooting', 'voices', 'render'],
  },
  {
    id: 'cli', group: 'Studio & delivery', title: 'CLI & MCP automation',
    summary: 'Validate, resolve, render and package projects outside the browser.', location: 'Repository → cli/ · README.md · MCP.md', keywords: 'command line terminal API workers cache scripts assistant',
    sections: [
      { title: 'CLI quick reference', paragraphs: ['From a local checkout with dependencies installed, yarn cli --help lists generation options and subcommands. Use each subcommand’s --help for current flags. Export a preset from the GUI to avoid manually rebuilding a complex sound.'], code: 'yarn cli --preset sketch.json --format wav --output sketch.wav\nyarn cli validate --project sketch.json\nyarn cli resolve --project sketch.json --output events.json\nyarn cli render --project sketch.json --output mix.wav\nyarn cli stems --project sketch.json --output stems\nyarn cli pack --project sketch.json --output portable.json', table: { headings: ['Command / option', 'Purpose'], rows: [
        ['features', 'Query supported features and parameter definitions.'], ['validate / resolve', 'Validate/normalize projects or inspect scheduled events.'], ['render / stems', 'Render full projects or --start / --end ranges with --unit bars, beats or seconds. --cache-dir enables a validated disk cache.'],
        ['bounce / sample / pack', 'Render a source into a reusable sample, import WAV into an asset pool, or create a portable project.'], ['--tracks / --preset', 'Track JSON uses sequence; preset JSON uses sequenceInput. --preset uses the chosen library preset or a single export.'],
        ['--master-gain / --reverb / --waveshaper / --limiter-gain', 'Generation options for master trim, reverb JSON, waveshaper JSON and the separate tanh input gain.'],
      ] } },
      { title: 'MCP and API', paragraphs: ['yarn mcp --workspace PATH starts the local stdio MCP server for project inspection, editing, validation, event resolution and rendering. Generated files are written inside the configured workspace. Use MCP.md for client configuration, exact tool schemas and artifact/resource access; DEVELOPMENT_STUDIO.md covers the importable project API.', 'The native renderer and browser share scheduling and core sound definitions, but do not promise bit-identical output for every live modulation edge. Mix files are 24-bit PCM; stems are float32. Preserve saved seeds and assets for reproducible arrangements.'], links: [
        { label: 'CLI & developer guide', href: 'https://github.com/ncg777/gaterunner/blob/main/README.md#cli-and-automation' },
        { label: 'MCP setup & tool reference', href: 'https://github.com/ncg777/gaterunner/blob/main/MCP.md' },
        { label: 'Studio API & rendering contracts', href: 'https://github.com/ncg777/gaterunner/blob/main/DEVELOPMENT_STUDIO.md' },
      ] },
    ], related: ['render', 'presets', 'automation'],
  },
  {
    id: 'shortcuts', group: 'Reference & troubleshooting', title: 'Keyboard & quick navigation',
    summary: 'Reach help, edit curves and operate transport with fewer clicks.', location: 'Whole app', keywords: 'shortcuts accessibility keyboard hotkeys F1 escape search',
    sections: [
      { title: 'Keyboard reference', table: { headings: ['Key / gesture', 'Action'], rows: [
        ['Space', 'Play/stop outside editable controls, buttons and open dialogs. It remains normal typing/control input inside those controls.'], ['F1', 'Open help for the current editor; while help is open, focus its search.'],
        ['Escape in help', 'Close the help dialog.'], ['Tab / Shift+Tab', 'Move focus through help contents, topic links and controls. Enter/Space activates buttons.'],
        ['Curve arrow keys', 'Move a focused automation point in beat/value. Shift multiplies numeric movement by ten.'], ['Curve Delete / Backspace', 'Remove the focused point.'], ['Escape during graph drag', 'Cancel the drag and restore the previous curve.'],
        ['Double-click pattern', 'Open that track/pattern in Sequence.'], ['Track drag / ⋮', 'Reorder tracks with a mouse or move up/down using the touch-friendly menu.'],
      ] } },
      { title: 'Compact navigation', paragraphs: ['Use the inspector device shortcuts to jump to a track panel. Collapse the inspector or editor for more timeline space. Help’s table of contents and search open topics directly; within a topic, section links jump to the relevant heading. Back restores the prior topic and reading position. Related links connect tutorials to the full reference.'] },
    ], related: ['welcome', 'workspace', 'automation'],
  },
  {
    id: 'troubleshooting', group: 'Reference & troubleshooting', title: 'Troubleshooting',
    summary: 'Resolve silence, unexpected timing, missing controls, failed saves and export issues.', location: 'Start with the symptom below', keywords: 'no sound silent error broken crackle missing save import export mobile offline install',
    sections: [
      { title: 'Sound and timing', table: { headings: ['Symptom', 'Check'], rows: [
        ['No sound', 'Press Play once to unlock audio. Check system volume, MIDI Output mode/device, mute/solo, B masks, nonzero notes, gate length, velocity, gain and amp envelope. Granular/sample sources need an assigned asset.'],
        ['Rest still sounds', '0 means no attack. Previous gates, releases, echo and reverb can continue. Shorten Note Length or articulation gate and effect tails.'],
        ['Wrong rhythm / loop length', 'Denominator is steps per beat. Check delay, padding, repeats, phase, time warp and the longest track. Explicit phrase sections supersede repeats.'],
        ['Automation does nothing', 'Enable Develop this track. Enable the affected filter/effect. Check clock, beat range, lane, later curves, locks and modulation. Discrete/envelope settings may apply only at the next attack.'],
        ['Morph sounds static', 'Make wavetable endpoints different. Enable wavetable/LFO, add a nonzero route and avoid a clamped endpoint.'],
        ['Crackling / slow preparation', 'Try more buffering while stopped, reduce voice/unison/harmonic load, or bounce a complex part. A late excerpt still processes preceding state.'],
        ['Sound controls missing', 'MIDI mode hides internal audio. Rhythmic tracks show Drum Sounds rather than Generator/Voices & Glide. The dock may be collapsed.'],
      ] } },
      { title: 'Files, storage and environment', table: { headings: ['Symptom', 'Next step'], rows: [
        ['Save failed', 'Keep the draft open and Export Preset/Portable project. Check browser storage/quota; do not clear site data until you have a verified backup.'],
        ['Sample import failed', 'Use supported mono/stereo uncompressed RIFF WAV. Convert unsupported formats first. Missing assets and unmatched velocity layers are validation errors.'],
        ['Only one stem downloaded', 'Allow multiple downloads for this site and export again; keep stems.json with the audio.'],
        ['Export validation errors', 'Read the reported control/asset path and fix it before rendering. Use CLI validate for a normalized project and diagnostics.'],
        ['URL too large', 'Share a portable project JSON instead, especially with embedded samples.'],
        ['Old interface / offline access', 'The app is installable as a PWA through a supporting browser. First load requires the app assets; cached offline use depends on browser storage. Reconnect and reload to receive updates. Export local projects before removing site data.'],
      ] } },
    ], related: ['audio', 'presets', 'render', 'sequence', 'automation'],
  },
];

export const editorHelpTopics: Record<string, string> = {
  sequence: 'sequence', 'drum-sounds': 'drum-sounds', playback: 'playback', 'time-warp': 'time-warp',
  generator: 'engines', modulation: 'modulation', unison: 'voices', drive: 'drive', chorus: 'effects',
  flanger: 'effects', phaser: 'effects', filter: 'filter', effects: 'effects', reverb: 'reverb',
};
export const dockHelpTopics: Record<string, string> = {
  phrases: 'phrases', steps: 'articulation', motion: 'automation', returns: 'routing', samples: 'samples', render: 'render',
};
