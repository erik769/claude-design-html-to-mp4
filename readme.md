# claude-design-html-to-mp4

Convert [Claude Design](https://claude.ai/design) HTML (and any HTML page) into an MP4.

- **Deterministic mode** — if the page exposes `window.__capture`, the tool steps frame-by-frame. Frame-perfect regardless of machine speed.
- **Realtime mode** — fallback for any HTML. Records the page in real time via Playwright, transcodes to MP4. Not frame-perfect under load.

> **Video only.** Playwright's recorder doesn't capture audio; deterministic frame screenshots can't either. MP4 output is always silent. For narrated video, render audio separately and mux with ffmpeg.

## From a Claude Design export to MP4 in 3 steps

Claude Design lets you download a project as a ZIP. That ZIP has an HTML file alongside `animations.jsx`, `scenes/`, assets, and anything else the design uses. This tool takes that folder and produces a video — no extra wiring needed for most exports.

1. **Download your design** from Claude Design (→ Export → "Standalone HTML" / "ZIP").
2. **Unzip it** anywhere on disk.
3. **Run one command:**

   **Windows (PowerShell / CMD):**

   ```
   convert.bat path\to\design.html
   ```

   **macOS (Terminal):**

   ```
   bash convert.sh path/to/design.html
   ```

That's it — a 1920×1080 MP4 appears next to `design.html`. The tool auto-starts a local server so relative `.jsx` / module imports resolve, auto-detects the duration if the design exposes `window.__capture`, and falls back to realtime recording otherwise (just add `--duration <seconds>`).

```
my-design.zip  →  unzip  →  convert(.bat|.sh) design.html  →  design.mp4
```

For **frame-perfect, stutter-free** output, ask the model to add a capture handle — a one-liner documented under [Frame-perfect output](#frame-perfect-output).

## Setup

**Windows (PowerShell / CMD):**

```
setup.bat
```

**macOS (Terminal):**

```
bash setup.sh
```

Requires [Node.js](https://nodejs.org) 18+ and [ffmpeg](https://ffmpeg.org/download.html) on PATH. Installs Playwright + Chromium (~120 MB).

## Usage

**Windows (PowerShell / CMD):**

```
convert.bat <path\to\design.html> [options]
```

**macOS (Terminal):**

```
bash convert.sh <path/to/design.html> [options]
```

Output is written next to the input (`design.html` → `design.mp4`).

```
# Windows
convert.bat design.html --duration 32
convert.bat design.html --fps 60 --width 1280 --height 720
convert.bat folder\with\index.html --out clip.mp4

# macOS
bash convert.sh design.html --duration 32
bash convert.sh design.html --fps 60 --width 1280 --height 720
bash convert.sh folder/with/index.html --out clip.mp4
```

### Options

| Flag                    | Default                  | Purpose                                                      |
| ----------------------- | ------------------------ | ------------------------------------------------------------ |
| `--out <file.mp4>`      | `<input>.mp4`            | Output path                                                  |
| `--duration <sec>`      | from handle, else required | Total video length                                         |
| `--fps <n>`             | 30                       | Frame rate                                                   |
| `--width <px>`          | 1920                     | Viewport width                                               |
| `--height <px>`         | 1080                     | Viewport height                                              |
| `--selector <css>`      | auto                     | Element to screenshot (else full viewport)                   |
| `--mode auto\|det\|rt`  | `auto`                   | Force deterministic or realtime                              |
| `--crf <0-51>`          | 18                       | H.264 quality, lower = better                                |
| `--preset <name>`       | `slow`                   | ffmpeg encoder preset                                        |
| `--wait <sec>`          | 1                        | Warm-up wait after page load                                 |
| `--port <n>`            | 7891                     | Local HTTP server port                                       |
| `--query <string>`      | none                     | Query string appended to page URL (e.g. `capture=1`)         |
| `--keep-frames`         | off                      | Keep PNG frames after encoding                               |
| `--no-server`           | off                      | Load `file://` directly (breaks relative imports)            |
| `--help`                |                          | Show help                                                    |

## Frame-perfect output

Realtime recording can stutter on heavy scenes. For smooth, deterministic video, the page just needs to let the tool drive time directly — a small **capture handle** that says "render frame at time `t`." Once that exists, the tool steps frame-by-frame instead of recording a live playback.

**You don't need to wire this yourself — ask Claude to add it.** Paste this into your design prompt:

> Expose a `window.__capture = { duration, fps, width, height, setTime(t), setPlaying(b) }` handle that drives the animation's current time, so the page can be captured frame-by-frame by a headless renderer.

Then rerun `convert.bat design.html` (Windows) or `bash convert.sh design.html` (macOS). The tool auto-detects the handle and switches to deterministic mode. Use `--mode det` if you want it to fail loudly when the handle is missing.

## Troubleshooting

- **"ffmpeg not found"** — Windows: install from https://ffmpeg.org/download.html, add `bin\` to PATH, restart terminal. macOS: `brew install ffmpeg`.
- **"Duration unknown"** — pass `--duration <sec>` or expose `window.__capture.duration`.
- **Blank frames / missing fonts** — bump `--wait 2`.
- **Slow capture** — lower `--fps`, use `--preset medium`, or reduce `--width`/`--height`.
- **Overlay / modal stuck in output** — headless capture can't dismiss "Click to Start" or "Enable Audio" prompts. Ask Claude to hide them when `?capture=1` is in the URL, then run with `--query capture=1`.
- **Working files leaked** — clean any `<input-dir>\.html-to-mp4-frames-*\` directories left over after a crash.
