# GateRunner MCP server

GateRunner's local Model Context Protocol server lets an assistant create and edit
projects, explain decoded notes, render audio previews, and export projects, MIDI,
WAV and stems. It calls the same project validation, scheduler and native renderer
as the CLI.

The server uses the current stable TypeScript SDK v2 packages
(`@modelcontextprotocol/server` 2.3.1 and the matching development client) and
supports the **2026-07-28** MCP protocol revision. This was verified against the
[current specification](https://modelcontextprotocol.io/specification/latest) and
[official SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/) on
2026-10-15. Older clients can use the same server through the SDK's legacy
handshake support. The integration tests pin 2026-07-28 explicitly, so they cannot
silently fall back to an older protocol.

## Build and connect

Use Node.js 22 or newer and the repository's Yarn installation:

```sh
yarn install
yarn build:cli
node dist-cli/cli/mcp.js --workspace .
```

The server waits for JSON-RPC messages on standard input. Standard output contains
only protocol messages. Closing the input pipe shuts down the connection and
cancels requests that are still running.

Configure your MCP host to launch Node with absolute paths. A typical host's JSON
configuration looks like this; adjust the repository and project directory:

```json
{
  "mcpServers": {
    "gaterunner": {
      "command": "node",
      "args": [
        "D:/repos/gaterunner/dist-cli/cli/mcp.js",
        "--workspace",
        "D:/repos/gaterunner"
      ]
    }
  }
}
```

The workspace must already exist. It determines where the server can read projects
and write results. The default is the process's current directory; configure it
explicitly because hosts can launch servers from a different directory. An
absolute path to the Node executable can also be used if the host does not inherit
your `PATH`.

For development, `yarn mcp --workspace .` runs the source directly. A host can also
launch `node --import tsx cli/mcp.ts --workspace .` with its working directory set
to the repository. Prefer the compiled entry point for host configuration so no
package-manager output is mixed into the protocol stream.

This is a local, file-based integration. It does not inspect or change the unsaved
draft in an open browser tab. Import generated project JSON through GateRunner's
project import to audition or continue editing in the browser.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_capabilities` | Engines, supported features, workspace and usage resources. Set `includeParameters: true` for parameter definitions. |
| `validate_project` | Diagnostics for a project without writing files. Set `includeProject: true` to return normalized settings. Invalid projects return `valid: false`; malformed requests or unreadable files return tool errors. |
| `inspect_project` | Resolved pitches after playback polyphony limits, note names, timing, duration and track summaries. `eventOffset` and `eventLimit` page events per track; the default limit is 16 and maximum is 128. |
| `update_project` | Start a new project or merge edits into an existing project. Optionally save an importable portable package. Use `includeProject: false` to save sample-heavy projects without returning their PCM data. |
| `render_preview` | Render a playable WAV excerpt and report sample peak, RMS and clipping-sample count. Defaults to the first eight seconds; maximum excerpt length is thirty seconds. |
| `export_project` | Export `project`, `midi`, `wav` or `stems`. WAV and stems can use an excerpt range. |
| `read_artifact` | Read a generated file in bounded base64 chunks. Accepts an artifact `uri`, byte `offset` (default 0) and byte `length` (default and maximum 262144). |

Each tool that accepts a project uses a `source` with exactly one of these shapes:

```json
{ "path": "songs/sketch.grproject.json" }
```

```json
{
  "project": {
    "bpm": 120,
    "forte": "7-35.11",
    "tracks": [
      { "id": "lead", "sequenceInput": "1 2 4 8 3 5 7 0" }
    ]
  }
}
```

File sources accept raw projects, single-preset exports, preset libraries and
portable asset packages. A library uses its selected preset, falling back to its
first preset. Inline projects can omit settings to use GateRunner defaults.
Use file sources for large projects, especially those containing sample data, to
avoid the host's incoming message limit.

## Example workflow

Ask the assistant to discover the tools and read `gaterunner://defaults/project`
when it needs a complete example. It can then call `update_project`:

```json
{
  "changes": {
    "bpm": 110,
    "forte": "7-35.11",
    "tracks": [
      {
        "id": "lead",
        "name": "Plucked lead",
        "sequenceInput": "1 2 4 8 3 5 7 0",
        "repeats": 8,
        "synthMode": "pluck",
        "gain": -18
      }
    ]
  },
  "output": "songs/sketch.grproject.json"
}
```

Omitting `source` starts from a new default project. Objects merge recursively;
arrays replace complete arrays. To edit one track without replacing its siblings,
use stable track IDs:

```json
{
  "source": { "path": "songs/sketch.grproject.json" },
  "trackUpdates": [
    { "id": "lead", "changes": { "sequenceInput": "7 14 28 0", "gain": -21 } }
  ],
  "output": "songs/variation.grproject.json"
}
```

For older projects without saved track IDs, use a zero-based `index` instead of
`id`, for example `{ "index": 0, "changes": { "gain": -21 } }`.
`inspect_project` includes both selectors in its track summaries. Generated IDs
for legacy tracks can change until the normalized project is saved.
An ID matching multiple tracks is rejected; use an index to select the track and
assign it a unique ID.

Changes are validated before saving. Malformed structures, including non-array
or empty `tracks`, are rejected. GateRunner's normalizer fills omitted defaults
and clamps supported values; diagnostics identify normalized and ignored settings.
Unknown tool arguments are rejected, so a misspelled output argument cannot
silently prevent saving.
`update_project` also accepts invalid source projects so an edit can repair a
reported error. With no `output`, it returns the normalized project without
writing a file; the caller can pass that project inline to another tool.
Inline project results are limited to 1 MiB. For larger projects, supply `output`
and `includeProject: false`; this preserves all embedded sample data in the saved
file. Requests that exceed the inline limit fail before saving.

Render a preview:

```json
{
  "source": { "path": "songs/variation.grproject.json" },
  "range": { "start": 0, "end": 2, "unit": "bars" }
}
```

Ranges start at zero and exclude `end`. Units are `bars`, `beats` or `seconds`;
bars use the first track's numerator unless `beatsPerBar` is supplied. Excerpts
warm up the renderer from song origin to preserve effects and arrangement state.
MIDI and portable project exports represent the whole project and reject ranges.

For `export_project`, specify a format and optionally an output:

```json
{
  "source": { "path": "songs/variation.grproject.json" },
  "format": "stems",
  "output": "exports/variation-stems",
  "stemStage": "post"
}
```

Stems contain a manifest and float32 WAV files. `stemStage` can be `all` (default),
`pre` or `post`; the manifest explains which files recombine into the pre-master
mix. MIDI preserves scheduled note events rather than the synth sound.

## Results, resources and files

Results include structured JSON and text for host compatibility. Generated files
also have `resource_link` content and an `artifact` descriptor containing the
absolute `path`, `uri`, `name` and `mimeType`. Stem exports return an `artifacts`
array. Hosts can read files up to 4 MiB using `resources/read`; whether they display
an audio player depends on the host.

Rendered audio buffers are not included in ordinary tool results. Reading an audio
resource returns the WAV as a base64 binary resource. Portable projects preserve
embedded samples; their project settings can therefore include PCM sample data.
Larger files (including thirty-second previews) use `read_artifact` so a resource
read cannot disconnect clients with the default 10 MB stdio buffer. Each chunk
returns `data`, `encoding: "base64"`, `offset`, `nextOffset`, `totalBytes` and `eof`.
Decode each chunk separately, concatenate the bytes, and request `nextOffset`
until `eof` is true. The absolute file path is also available for direct local use.
Size limits are listed by `get_capabilities`; JSON responses have an 8 MiB cap.
Artifact links remain readable for the lifetime of the server process. Files
remain on disk after it exits and can be used as sources in a later session.
Artifacts refer to their current file contents; avoid modifying or replacing a
file while reading its chunks.

The three static resources are:

- `gaterunner://guide`: encoding, timing and tool conventions.
- `gaterunner://capabilities`: engine features and complete parameter definitions.
- `gaterunner://defaults/project`: a complete default project.

All paths must stay inside the configured workspace, including through symbolic
links or directory junctions. Relative paths resolve from that workspace.
File exports create parent directories and refuse to replace an existing file
unless `overwrite: true` is supplied. Stems always require a new directory.
Omitting an output for previews or exports creates a unique path under
`.gaterunner-mcp/`, which is ignored by Git. Failed or cancelled stem exports remove
their newly created directory and partial files, allowing a corrected request to
retry the same output. Existing directories are never removed by a failed export.

Rendering forwards MCP progress notifications when the caller supplies a progress
token. MCP cancellation reaches the existing renderer's `AbortSignal` and stops
its worker. Measurements describe computed audio samples; they are not LUFS,
true peak or listening assessments.

## Verification

```sh
yarn build:cli
node --import tsx --test cli/mcp.test.ts
node --test dist-cli/cli/mcp.test.js
```

The tests launch the real stdio entry point with the official v2 client. They
verify current-protocol discovery, legacy compatibility, schemas, project edits,
validation, decoded notes, WAV previews, progress, cancellation, MIDI/stem exports,
portable samples, file replacement and workspace boundaries.
Regression coverage includes malformed inputs, polyphony, duplicate track IDs,
large audio transfers, sample-heavy edits, and cleanup after failed stem exports.
