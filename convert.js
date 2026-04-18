#!/usr/bin/env node
// html-to-mp4 — General HTML → MP4 converter
// ─────────────────────────────────────────────────────────────────────────────
// USAGE
//   node convert.js <input.html> [options]
//
// OPTIONS
//   --out <file.mp4>       Output file (default: <input-basename>.mp4 next to input)
//   --fps <n>              Frames per second (default: 30)
//   --duration <sec>       Duration in seconds (required unless HTML sets window.__capture.duration)
//   --width <px>           Viewport width (auto-detected from window.__capture,
//                          [data-capture]/[data-stage-canvas], or HTML <Stage width={N}>;
//                          falls back to 1920)
//   --height <px>          Viewport height (auto-detected; falls back to 1080)
//   --selector <css>       CSS selector of element to screenshot (default: auto-detect
//                          from window.__capture.selector, or [data-capture],
//                          or [data-stage-canvas]; else full viewport)
//   --mode <auto|det|rt>   Capture mode. auto (default) uses deterministic if a capture
//                          handle is detected, else realtime. det = force deterministic.
//                          rt = force realtime (Playwright video → ffmpeg transcode).
//   --crf <0-51>           H.264 quality (default: 18, visually lossless)
//   --preset <name>        ffmpeg preset (default: slow)
//   --wait <sec>           Extra warm-up wait after page load (default: 1)
//   --port <n>             Local server port (default: 7891)
//   --query <string>       Query string appended to the page URL (default: "capture=1",
//                          pass --query "" to suppress)
//   --hide <selector>      CSS selector to hide during capture (repeatable) — useful
//                          for stripping playback bars, debug panels, etc.
//   --keep-frames          Keep PNG frames after encoding
//   --no-server            Load file:// directly instead of via local HTTP server
//   --help                 Show this help
//
// DETERMINISTIC MODE — "Claude design" convention
// ─────────────────────────────────────────────────────────────────────────────
// For perfect, stutter-free captures the HTML can expose a global handle:
//
//   window.__capture = {
//     duration: 32,           // required — total seconds to render
//     fps: 30,                // optional — overrides --fps default
//     width: 1920,            // optional — viewport width
//     height: 1080,           // optional — viewport height
//     selector: '[data-capture]', // optional — element to screenshot
//     setTime(t) { ... },     // required — set current animation time (seconds)
//     setPlaying(b) { ... },  // optional — pause the internal clock
//   };
//
// The converter will pause the animation and call setTime(t) for each frame,
// guaranteeing deterministic output regardless of machine speed.
// Legacy alias: window.__animStage (same shape) is also recognized.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { chromium } = require('playwright');
const http         = require('http');
const fs           = require('fs');
const path         = require('path');
const { pathToFileURL } = require('url');
const { execSync, spawnSync } = require('child_process');

// ── Arg parsing (no external deps) ────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.flags.help = true; continue; }
    if (a === '--keep-frames') { args.flags.keepFrames = true; continue; }
    if (a === '--no-server')   { args.flags.noServer   = true; continue; }
    if (a === '--hide') {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        console.error('Missing value for --hide'); process.exit(2);
      }
      args.flags.hide = (args.flags.hide || []).concat(val);
      i++;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        console.error(`Missing value for --${key}`); process.exit(2);
      }
      args.flags[key] = val;
      i++;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printHelp() {
  const help = fs.readFileSync(__filename, 'utf8')
    .split('\n')
    .filter(l => l.startsWith('//'))
    .slice(0, 50)
    .map(l => l.replace(/^\/\/ ?/, ''))
    .join('\n');
  console.log(help);
}

// ── MIME for the static server ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm' : 'text/html; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.mjs' : 'application/javascript; charset=utf-8',
  '.jsx' : 'application/javascript; charset=utf-8',
  '.ts'  : 'application/javascript; charset=utf-8',
  '.tsx' : 'application/javascript; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif' : 'image/gif',
  '.webp': 'image/webp',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.json': 'application/json',
  '.mp3' : 'audio/mpeg', '.wav': 'audio/wav',
  '.mp4' : 'video/mp4', '.webm': 'video/webm',
};

function startServer(rootDir, port) {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.resolve(rootDir, '.' + urlPath);
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500);
        res.end(`Error: ${err.message}`);
        return;
      }
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ── Small utils ───────────────────────────────────────────────────────────────
function clearDir(dir) {
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return; }
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { clearDir(p); fs.rmdirSync(p); }
    else fs.unlinkSync(p);
  }
}

const pad  = (n, w = 5) => String(n).padStart(w, '0');
const fmtT = s => {
  const m = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${ss}`;
};

function checkFfmpeg() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (r.error || r.status === null) {
    console.error('\nffmpeg not found on PATH.');
    console.error('Install from https://ffmpeg.org/download.html and re-run.\n');
    process.exit(1);
  }
}

// ── Parse Claude-design-style HTML for <Stage> prop hints ──────────────────
// Zero-cost fallback when the page never exposes window.__capture (e.g. legacy
// exports). Regex-matches the first <Stage ...> tag and pulls numeric props.
function parseHtmlHints(htmlPath) {
  try {
    const src = fs.readFileSync(htmlPath, 'utf8');
    const m = src.match(/<\s*Stage\b([^>]*)>/);
    if (!m) return {};
    const attrs = m[1];
    const num = (name) => {
      const re = new RegExp(`\\b${name}\\s*=\\s*\\{\\s*(\\d+(?:\\.\\d+)?)\\s*\\}`);
      const mm = attrs.match(re);
      return mm ? Number(mm[1]) : null;
    };
    return {
      width:    num('width'),
      height:   num('height'),
      duration: num('duration'),
      fps:      num('fps'),
    };
  } catch { return {}; }
}

// ── Probe running page for capture hints ────────────────────────────────────
async function probePage(page) {
  const handle = await page.evaluate(async () => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const h = window.__capture || window.__animStage;
      if (h) {
        return {
          duration: typeof h.duration === 'number' ? h.duration : null,
          fps:      typeof h.fps === 'number' ? h.fps : null,
          width:    typeof h.width === 'number' ? h.width : null,
          height:   typeof h.height === 'number' ? h.height : null,
          selector: typeof h.selector === 'string' ? h.selector : null,
          hasSetTime:    typeof h.setTime === 'function',
          hasSetPlaying: typeof h.setPlaying === 'function',
          kind: window.__capture ? '__capture' : '__animStage',
        };
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  });

  const dom = await page.evaluate(() => {
    const el = document.querySelector('[data-capture]') ||
               document.querySelector('[data-stage-canvas]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      selector: el.matches('[data-capture]') ? '[data-capture]' : '[data-stage-canvas]',
      width:  Math.round(r.width),
      height: Math.round(r.height),
    };
  });

  return { handle, dom };
}

async function injectHideCss(page, selectors) {
  if (!selectors || !selectors.length) return;
  const css = selectors
    .map(s => `${s} { display: none !important; visibility: hidden !important; }`)
    .join('\n');
  await page.addStyleTag({ content: css });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help) {
    printHelp();
    process.exit(0);
  }
  if (args._.length === 0) {
    printHelp();
    process.exit(1);
  }

  const inputArg = args._[0];
  const inputPath = path.resolve(inputArg);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`); process.exit(1);
  }
  const inputStat = fs.statSync(inputPath);
  let htmlFile, rootDir;
  if (inputStat.isDirectory()) {
    rootDir = inputPath;
    const idx = path.join(rootDir, 'index.html');
    if (!fs.existsSync(idx)) {
      console.error(`Directory has no index.html: ${rootDir}`); process.exit(1);
    }
    htmlFile = 'index.html';
  } else {
    rootDir  = path.dirname(inputPath);
    htmlFile = path.basename(inputPath);
  }

  const baseName = path.basename(htmlFile, path.extname(htmlFile));
  const OUTPUT   = path.resolve(args.flags.out || path.join(rootDir, `${baseName}.mp4`));
  const PORT     = Number(args.flags.port || 7891);
  const WAIT_S   = Number(args.flags.wait || 1);
  const MODE_REQ = (args.flags.mode || 'auto').toLowerCase();
  const CRF      = String(args.flags.crf || 18);
  const PRESET   = args.flags.preset || 'slow';
  const USE_SERVER = !args.flags['no-server'] && !args.flags.noServer;

  // Defaults (may be overridden by probe / handle / HTML hints)
  let FPS      = Number(args.flags.fps || 30);
  let DURATION = args.flags.duration !== undefined ? Number(args.flags.duration) : null;
  let VP_W     = Number(args.flags.width  || 1920);
  let VP_H     = Number(args.flags.height || 1080);
  let SELECTOR = args.flags.selector || null;
  const HIDE   = args.flags.hide || [];

  const FRAMES_DIR = path.join(rootDir, `.html-to-mp4-frames-${process.pid}`);

  console.log('html-to-mp4 — Claude design → MP4');
  console.log('─'.repeat(60));
  console.log(`  Input:   ${path.join(rootDir, htmlFile)}`);
  console.log(`  Output:  ${OUTPUT}`);
  console.log(`  Mode:    ${MODE_REQ}`);
  console.log('─'.repeat(60));

  checkFfmpeg();

  // Zero-cost HTML hints (regex on <Stage> tag)
  const htmlHints = parseHtmlHints(path.join(rootDir, htmlFile));

  // Auto-append capture=1 so cooperating pages can hide UI chrome.
  // User can override with --query, or suppress with --query "".
  let QUERY;
  if (args.flags.query !== undefined) {
    QUERY = args.flags.query.startsWith('?') ? args.flags.query.slice(1) : args.flags.query;
  } else {
    QUERY = 'capture=1';
  }

  let server = null, pageUrl;
  if (USE_SERVER) {
    server = await startServer(rootDir, PORT);
    pageUrl = `http://localhost:${PORT}/${encodeURI(htmlFile)}${QUERY ? '?' + QUERY : ''}`;
    console.log(`\nServing ${rootDir} at http://localhost:${PORT}`);
  } else {
    pageUrl = pathToFileURL(path.join(rootDir, htmlFile)).href + (QUERY ? '?' + QUERY : '');
    console.log(`\nUsing file:// URL (relative fetch()/ESM may fail without --server)`);
  }

  let browser, context, page;

  async function launch(recordVideo) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-web-security',
        '--hide-scrollbars',
      ],
    });
    const ctxOpts = {
      viewport: { width: VP_W, height: VP_H },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
    };
    if (recordVideo) {
      ctxOpts.recordVideo = {
        dir: FRAMES_DIR,
        size: { width: VP_W, height: VP_H },
      };
    }
    context = await browser.newContext(ctxOpts);
    page = await context.newPage();
    page.on('console',   m => { if (m.type() === 'error') console.warn('  [browser]', m.text()); });
    page.on('pageerror', e => console.warn('  [page error]', e.message));
  }

  // ── Preflight: probe the page for capture handle + DOM hints ─────────────
  // Runs in every mode so realtime also benefits from auto-detected dims.
  await launch(false);
  console.log(`\nLoading ${pageUrl}`);
  await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 90_000 });
  console.log('  Page loaded');

  const { handle, dom } = await probePage(page);

  // Precedence: explicit --flag > handle > DOM probe > HTML hints > default
  const firstNum = (...xs) => xs.find(v => typeof v === 'number' && isFinite(v) && v > 0);
  if (!args.flags.width)   VP_W     = firstNum(handle?.width,  dom?.width,  htmlHints.width)  || VP_W;
  if (!args.flags.height)  VP_H     = firstNum(handle?.height, dom?.height, htmlHints.height) || VP_H;
  if (!args.flags.fps)     FPS      = firstNum(handle?.fps,                  htmlHints.fps)    || FPS;
  if (DURATION === null)   DURATION = firstNum(handle?.duration,             htmlHints.duration) ?? null;
  if (!SELECTOR)           SELECTOR = handle?.selector || dom?.selector || null;

  const canDeterministic = !!(handle && handle.hasSetTime) && MODE_REQ !== 'rt';

  const srcDim =
    (args.flags.width || args.flags.height) ? 'user flags' :
    (handle?.width   || handle?.height)     ? `window.${handle.kind}` :
    (dom?.width      || dom?.height)        ? `DOM ${dom.selector}` :
    (htmlHints.width || htmlHints.height)   ? 'HTML <Stage> hints' :
                                              'defaults';
  const srcDur =
    args.flags.duration !== undefined ? 'user flag' :
    handle?.duration                  ? `window.${handle.kind}.duration` :
    htmlHints.duration                ? 'HTML <Stage duration>' :
                                        'unknown';

  console.log(`  Dimensions: ${VP_W}×${VP_H} @ ${FPS}fps   (from ${srcDim})`);
  console.log(`  Duration:   ${DURATION !== null ? DURATION + 's' : 'unknown'}   (from ${srcDur})`);
  console.log(`  Selector:   ${SELECTOR || 'full viewport'}`);
  console.log(`  Mode:       ${canDeterministic ? 'deterministic (frame-stepped)' : 'realtime (video record)'}`);

  if (MODE_REQ === 'det' && !canDeterministic) {
    console.error('\n--mode=det requires window.__capture.setTime. Not found.');
    await browser.close(); if (server) server.close(); process.exit(1);
  }

  if (canDeterministic) {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await injectHideCss(page, HIDE);
    await runDeterministic();
    await encode();
    return;
  }

  // Realtime: close the probe browser, relaunch with recordVideo at right dims.
  if (DURATION === null) {
    console.error('\nRealtime mode needs a duration. Pass --duration <sec>, or expose window.__capture.duration, or set <Stage duration={N}>.');
    await browser.close(); if (server) server.close(); process.exit(1);
  }
  await browser.close(); browser = null;
  await runRealtime();
  await encode();

  // ── Deterministic frame-stepping ─────────────────────────────────────────
  async function runDeterministic() {
    const TOTAL = Math.ceil(DURATION * FPS);
    console.log(`\nDeterministic capture: ${TOTAL} frames  (${FPS}fps × ${DURATION}s)  ${VP_W}×${VP_H}`);
    clearDir(FRAMES_DIR);

    // Pause the internal clock if the handle supports it
    await page.evaluate(() => {
      const h = window.__capture || window.__animStage;
      if (h && typeof h.setPlaying === 'function') h.setPlaying(false);
    });
    await page.waitForTimeout(Math.round(WAIT_S * 1000));

    // Warm-up: seek to 0 so fonts/images finalize
    await page.evaluate(() => {
      const h = window.__capture || window.__animStage; h.setTime(0);
    });
    await page.waitForTimeout(500);

    const target = SELECTOR ? page.locator(SELECTOR).first() : null;
    const shot = async (file) => target
      ? target.screenshot({ path: file, type: 'png' })
      : page.screenshot({ path: file, type: 'png', fullPage: false });

    // Discard warm-up shot
    const wu = path.join(FRAMES_DIR, '_warmup.png');
    await shot(wu); fs.unlinkSync(wu);

    console.log('─'.repeat(60));
    const t0 = Date.now();
    for (let f = 0; f < TOTAL; f++) {
      const t = f / FPS;
      await page.evaluate(t => new Promise(resolve => {
        const h = window.__capture || window.__animStage;
        h.setTime(t);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }), t);
      await shot(path.join(FRAMES_DIR, `frame_${pad(f)}.png`));
      if (f % FPS === 0 || f === TOTAL - 1) {
        const el = (Date.now() - t0) / 1000;
        const pct = ((f + 1) / TOTAL * 100).toFixed(1);
        const fps_r = f > 0 ? (f / el).toFixed(1) : '…';
        const eta = f > 0 ? Math.round((el / (f + 1)) * (TOTAL - f - 1)) : '?';
        process.stdout.write(
          `  [${pct.padStart(5)}%]  frame ${String(f + 1).padStart(4)}/${TOTAL}` +
          `  t=${fmtT(t)}  ${fps_r} fps  ETA ${eta}s        \r`
        );
      }
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${TOTAL} frames in ${dt}s`);

    await browser.close(); browser = null;
    if (server) server.close();
  }

  // ── Realtime via Playwright recordVideo → ffmpeg transcode ───────────────
  async function runRealtime() {
    clearDir(FRAMES_DIR);
    await launch(true);
    console.log(`\nLoading ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 90_000 });
    await injectHideCss(page, HIDE);
    console.log(`  Page loaded — recording for ${DURATION}s at ${VP_W}×${VP_H}`);
    await page.waitForTimeout(Math.round(WAIT_S * 1000));

    const t0 = Date.now();
    const tick = setInterval(() => {
      const el = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(`  recording… ${el}s / ${DURATION}s   \r`);
    }, 500);
    await page.waitForTimeout(Math.round(DURATION * 1000));
    clearInterval(tick);

    // Closing the page/context flushes the video to disk
    const videoPromise = page.video() ? page.video().path() : null;
    await page.close();
    await context.close();
    await browser.close();
    browser = null;
    if (server) server.close();

    if (!videoPromise) {
      console.error('\nPlaywright did not produce a video.');
      process.exit(1);
    }
    const webm = await videoPromise;
    console.log(`\n  Raw capture: ${webm}`);
    // Leave file in place — encode() will pick it up.
    global.__rtVideoPath = webm;
  }

  // ── Encode ───────────────────────────────────────────────────────────────
  async function encode() {
    let cmd;
    if (global.__rtVideoPath) {
      // Realtime path: transcode webm → mp4, trimming the warm-up intro
      // (-ss) and capping at exactly DURATION seconds (-t) so the output
      // matches the animation, not the page-load + tail.
      const webm = global.__rtVideoPath;
      cmd =
        `ffmpeg -y -ss ${WAIT_S} -i "${webm}" ` +
        `-t ${DURATION} -r ${FPS} ` +
        `-c:v libx264 -pix_fmt yuv420p -crf ${CRF} -preset ${PRESET} ` +
        `-vf "scale=${VP_W}:${VP_H},format=yuv420p" ` +
        `-movflags +faststart ` +
        `"${OUTPUT}"`;
    } else {
      // Deterministic path: frames → mp4
      const pattern = path.join(FRAMES_DIR, 'frame_%05d.png');
      cmd =
        `ffmpeg -y -framerate ${FPS} -i "${pattern}" ` +
        `-c:v libx264 -pix_fmt yuv420p -crf ${CRF} -preset ${PRESET} ` +
        `-vf "scale=${VP_W}:${VP_H},format=yuv420p" ` +
        `-movflags +faststart ` +
        `"${OUTPUT}"`;
    }

    console.log('\nEncoding MP4…');
    console.log(`  ${cmd}\n`);
    try { execSync(cmd, { stdio: 'inherit' }); }
    catch { console.error('\nffmpeg failed.'); process.exit(1); }

    const mb = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
    console.log(`\nDone → ${OUTPUT}  (${mb} MB)`);

    if (!args.flags.keepFrames && !args.flags['keep-frames']) {
      console.log('Cleaning working dir…');
      clearDir(FRAMES_DIR);
      try { fs.rmdirSync(FRAMES_DIR); } catch {}
    } else {
      console.log(`Kept working dir: ${FRAMES_DIR}`);
    }
  }
}

main().catch(err => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});