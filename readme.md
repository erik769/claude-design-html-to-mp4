# claude-design-html-to-mp4

Turn any HTML page — or a [Claude Design](https://claude.ai/design) export — into a silent MP4. Frame-perfect when the page cooperates, realtime-recorded otherwise.

Built by [Thinkagain.nl](https://thinkagain.nl) · Released under the [MIT License](#license).

---

## What it does

You hand the tool an HTML file, it hands back an MP4 sitting next to the input. Under the hood, two capture strategies are available and the right one is picked automatically:

- **Deterministic capture** — when the page exposes a `window.__capture` handle, the tool pauses the page's internal clock and renders one frame at a time at precise timestamps. Output is pixel-identical regardless of machine load.
- **Realtime capture** — for any other page, Playwright records the live viewport and ffmpeg transcodes the result. Zero cooperation required from the page; susceptible to frame drops when the CPU is under load.

The resulting video is always silent (H.264 / MP4). If you need narration or music, render the audio separately and mux it in with ffmpeg.

## Requirements

- Node.js 18 or newer
- ffmpeg on your `PATH` — `brew install ffmpeg` on macOS, or download from [ffmpeg.org](https://ffmpeg.org/download.html) on Windows
- One-time: a headless Chromium from Playwright (~120 MB, installed by the setup script below)

## Installation

Clone the repo, then run the setup script that matches your OS. You can aslo just ask your Claude Code to make it work:

```bash
git clone <your-remote>/claude-design-html-to-mp4.git
cd claude-design-html-to-mp4
```

```bash
# macOS / Linux
bash setup.sh
```

```bat
:: Windows (PowerShell or CMD)
setup.bat
```

Setup installs the npm dependencies and downloads Playwright's Chromium build. You only run it once.

## Converting a design

A Claude Design export is a ZIP containing an HTML file next to its `animations.jsx`, `scenes/`, and assets. Unzip anywhere, then:

```bash
# macOS / Linux
bash convert.sh path/to/design.html
```

```bat
:: Windows
convert.bat path\to\design.html
```

That is the entire happy path — no flags required for a well-formed Claude Design export. Width, height, frame rate and duration are all read from the page automatically. The MP4 is written next to the input (`design.html` → `design.mp4`).

### Common variations

```bash
# Choose a different output path
bash convert.sh design.html --out clip.mp4

# Pin the duration explicitly (e.g. for a page that provides no hints)
bash convert.sh page.html --duration 15

# Force a portrait render (9:16) instead of whatever the page specifies
bash convert.sh design.html --width 1080 --height 1920

# Force realtime mode even if a capture handle is present
bash convert.sh design.html --mode rt --duration 20

# Strip a debug panel, overlay, or toolbar out of the recording
bash convert.sh design.html --hide "#debug" --hide ".toolbar"
```

## How auto-detection works

Four values — width, height, duration, and capture selector — are resolved by walking this cascade and taking the first hit:

1. **Explicit CLI flag** (`--width`, `--height`, `--duration`, `--selector`)
2. **`window.__capture`** exposed by the page — the richest source, used by cooperating designs (see [Making your page capture-ready](#making-your-page-capture-ready))
3. **DOM marker** — an element tagged `[data-capture]` or `[data-stage-canvas]` contributes its bounding box as the canvas size and its selector as the screenshot target
4. **HTML source hint** — a `<Stage width={N} height={N} duration={N}>` React tag in the source file is regex-matched as a fallback
5. **Defaults** — 1920×1080, no duration (realtime mode errors out if nothing else fills that in)

The preflight prints exactly which source each value came from, so it is easy to notice when auto-detection picks something unexpected:

```
Dimensions: 1080×1080 @ 60fps   (from window.__capture)
Duration:   60s                 (from window.__capture.duration)
Selector:   [data-stage-canvas]
Mode:       deterministic (frame-stepped)
```

The cascade is intentionally permissive: 16:9, 1:1, 9:16, or any custom ratio are all handled the same way — the tool renders whatever the page declares.

## Making your page capture-ready

If your page owns its own time (a playhead, an animation clock, a timeline), exposing a capture handle unlocks deterministic mode and perfectly smooth output. Add this once, somewhere that runs after your animation initialises:

```js
window.__capture = {
  duration: 30,                    // seconds of video to render
  fps: 60,                         // preferred frame rate
  width: 1080,                     // capture width (px)
  height: 1080,                    // capture height (px)
  selector: '[data-stage-canvas]', // which element to screenshot
  setTime(t) {                     // ← required: draw the frame at time `t`
    app.clock = t;
    app.render();
  },
  setPlaying(playing) {            // ← optional: halt the internal clock
    app.playing = playing;
  },
};
```

Also tag the capture target so the screenshot is clipped to just the artwork:

```html
<div data-stage-canvas="">
  <!-- your animation root -->
</div>
```

Finally, respect `?capture=1` so the tool can ask you to hide on-screen chrome (play/pause UI, debug panels, a watermark):

```js
const isCapture = new URLSearchParams(location.search).has('capture');
if (!isCapture) renderPlaybackControls();
```

The tool appends `?capture=1` to the page URL by default. Cooperating pages react; other pages ignore it. If you need the query string for something else, override with `--query "…"` or suppress it with `--query ""`.

## Command reference

| Flag | Default | Purpose |
|------|---------|---------|
| `--out <file.mp4>` | `<input>.mp4` | Output path |
| `--duration <seconds>` | auto-detected | Total video length |
| `--fps <n>` | 30 | Frame rate |
| `--width <px>` | auto-detected | Capture width |
| `--height <px>` | auto-detected | Capture height |
| `--selector <css>` | auto-detected | Element to screenshot (deterministic mode) |
| `--mode auto\|det\|rt` | `auto` | Force deterministic or realtime capture |
| `--crf <0-51>` | 18 | H.264 quality — lower is sharper, larger file |
| `--preset <name>` | `slow` | ffmpeg encoder preset |
| `--wait <seconds>` | 1 | Warm-up pause after page load (lets fonts/images settle) |
| `--port <n>` | 7891 | Local static-server port |
| `--query <string>` | `capture=1` | Query string appended to the page URL; pass `--query ""` to suppress |
| `--hide <css>` | — | CSS selector to hide during capture (repeatable) |
| `--keep-frames` | off | Keep raw PNG frames after encoding |
| `--no-server` | off | Load the file via `file://` instead of the local HTTP server (breaks relative imports) |
| `--help` | — | Show inline help and exit |

Run `node convert.js --help` for the same reference inside your terminal.

## Troubleshooting

**`ffmpeg not found`**  
macOS: `brew install ffmpeg`. Windows: install from ffmpeg.org and restart your terminal so the updated `PATH` takes effect.

**`Duration unknown`**  
Either expose `window.__capture.duration`, add a `<Stage duration={N}>` tag to your HTML, or pass `--duration <seconds>` on the command line.

**Output stutters**  
Realtime mode records live, so any CPU hiccup shows up as dropped frames. Switch to deterministic mode by exposing a capture handle, or lighten the encoder load with `--preset medium` and a lower `--fps`.

**First second of the video shows blank frames or unstyled text**  
The warm-up pause is too short for your setup — bump it with `--wait 2` (or higher). Cloud-hosted fonts often need a beat to finish loading.

**An overlay or "Click to start" prompt is stuck in the MP4**  
Headless Chromium cannot dismiss overlays. Either have the page hide them when `?capture=1` is present, or strip them with `--hide "<selector>"`.

**Large file sizes**  
The default CRF of 18 is visually lossless. Raise it to 22–23 to shrink the file roughly 3× with imperceptible quality loss.

**Process crashed and left a working directory behind**  
Delete any `.html-to-mp4-frames-<pid>/` directory that appears inside your input folder.

## License

Released under the [MIT License](./LICENSE) — use it, fork it, ship it.

Copyright © 2026 [Thinkagain.nl](https://thinkagain.nl)
