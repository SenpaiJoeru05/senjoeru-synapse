#!/usr/bin/env node
/**
 * Fetches Piper (neural TTS) and whisper.cpp (STT) into vendor/.
 *
 *   npm run voice:setup        explicit, complains if anything fails
 *   npm install                same thing via postinstall, but never fails
 *
 * vendor/ is gitignored — ~230MB of binaries and models do not belong in the
 * repo — so this exists to make the install reproducible rather than a
 * remembered sequence of manual downloads. Everything is skipped when already
 * present, so re-running is cheap and safe.
 *
 * Voice degrades honestly without it: Assistant Mode reports that Piper is
 * missing and still answers in text.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'vendor', 'piper');
const EXE = path.join(ROOT, 'piper', 'piper.exe');
const VOICES = path.join(ROOT, 'voices');

// whisper.cpp for speech-to-text. A native binary run as a subprocess, NOT the
// transformers.js build that crashed the renderer. On the same clips it scored
// 7 of 7 against Windows System.Speech's 2 of 7.
const WROOT = path.join(__dirname, '..', 'vendor', 'whisper');
const WEXE = path.join(WROOT, 'Release', 'whisper-cli.exe');
const WMODEL = path.join(WROOT, 'models', 'ggml-base.en.bin');
const WHISPER_ZIP = 'https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-blas-bin-x64.zip';
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

const PIPER_ZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const CATALOGUE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en';
// The Jarvis model is not in the official catalogue — rhasspy declined it on
// copyright grounds (see the provenance note in tts.js), so it comes from the
// uploader's own repo.
const JARVIS = 'https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis';

/**
 * `medium` everywhere by default: en_US-ryan-high measured 9.4s per answer
 * against alan-medium's 1.7s, and nine seconds of silence reads as broken
 * however good the voice is. jarvis-high is the one defensible exception at
 * 4.1s, offered as its own entry rather than as the default.
 *
 * Only the default voice is fetched by a plain run; pass --all for the rest.
 */
const VOICE_SETS = {
  jarvis: { url: `${JARVIS}/medium`, stem: 'jarvis-medium', default: true },
  'jarvis-hq': { url: `${JARVIS}/high`, stem: 'jarvis-high' },
  alan: { url: `${CATALOGUE}/en_GB/alan/medium`, stem: 'en_GB-alan-medium' },
  ryan: { url: `${CATALOGUE}/en_US/ryan/medium`, stem: 'en_US-ryan-medium' },
  amy: { url: `${CATALOGUE}/en_US/amy/medium`, stem: 'en_US-amy-medium' },
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

/**
 * `--if-needed` — the mode postinstall uses.
 *
 * Same work, but it must never be the reason `npm install` fails, because
 * voice is an optional extra on top of a dashboard that runs fine without it.
 * Three cases exit quietly instead of erroring:
 *
 *   not Windows   these are win32 binaries. CI is ubuntu-latest and runs
 *                 `npm install`, so without this the postinstall hook would
 *                 fail every push — the platform guard below exits 1.
 *   CI            a 230MB download per job, to run binaries no test invokes.
 *   offline       a fresh clone on a plane should still install.
 */
const IF_NEEDED = process.argv.includes('--if-needed');
const IN_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

/** Already-complete installs say nothing, so postinstall stays quiet. */
function alreadyComplete() {
  const def = Object.values(VOICE_SETS).find((v) => v.default);
  return fs.existsSync(EXE) && fs.existsSync(path.join(VOICES, `${def.stem}.onnx`))
    && fs.existsSync(WEXE) && fs.existsSync(WMODEL);
}

(async () => {
  if (IF_NEEDED && (IN_CI || process.platform !== 'win32' || alreadyComplete())) return;

  if (process.platform !== 'win32') {
    console.error('This fetches the Windows build of Piper. Adapt the URL for another platform.');
    process.exit(1);
  }

  if (IF_NEEDED) {
    console.log('\nsetting up voice (one time, ~230MB) — the app runs without it if this fails');
  }

  fs.mkdirSync(ROOT, { recursive: true });

  if (fs.existsSync(EXE)) {
    console.log(`piper already present at ${EXE}`);
  } else {
    console.log('downloading piper…');
    const zip = path.join(os.tmpdir(), `piper-${Date.now()}.zip`);
    console.log(`  ${mb(await download(PIPER_ZIP, zip))}`);
    console.log('extracting…');
    // Expand-Archive rather than a zip library: it ships with Windows, and one
    // dependency fewer is worth a shell out here.
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -Path '${zip}' -DestinationPath '${ROOT}' -Force`,
    ], { stdio: 'inherit' });
    fs.promises.unlink(zip).catch(() => {});
  }

  // --- whisper.cpp, for speech IN ---
  fs.mkdirSync(WROOT, { recursive: true });

  if (fs.existsSync(WEXE)) {
    console.log(`whisper already present at ${WEXE}`);
  } else {
    console.log('downloading whisper.cpp…');
    const zip = path.join(os.tmpdir(), `whisper-${Date.now()}.zip`);
    console.log(`  ${mb(await download(WHISPER_ZIP, zip))}`);
    console.log('extracting…');
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -Path '${zip}' -DestinationPath '${WROOT}' -Force`,
    ], { stdio: 'inherit' });
    fs.promises.unlink(zip).catch(() => {});
  }

  if (fs.existsSync(WMODEL)) {
    console.log('whisper model already present');
  } else {
    console.log('downloading whisper model (ggml-base.en, ~141MB)…');
    console.log(`  ${mb(await download(WHISPER_MODEL_URL, WMODEL))}`);
  }

  const wantAll = process.argv.includes('--all');
  const wanted = Object.entries(VOICE_SETS).filter(([, v]) => wantAll || v.default);

  for (const [id, v] of wanted) {
    for (const ext of ['.onnx', '.onnx.json']) {
      const file = v.stem + ext;
      const dest = path.join(VOICES, file);
      if (fs.existsSync(dest)) { console.log(`${file} already present`); continue; }
      console.log(`downloading ${id} ${ext}…`);
      console.log(`  ${mb(await download(`${v.url}/${file}`, dest))}`);
    }
  }

  if (!wantAll) {
    const others = Object.keys(VOICE_SETS).filter((id) => !VOICE_SETS[id].default);
    console.log(`\n(default voice only; --all also fetches: ${others.join(', ')})`);
  }

  const def = Object.values(VOICE_SETS).find((v) => v.default);
  const ttsOk = fs.existsSync(EXE) && fs.existsSync(path.join(VOICES, `${def.stem}.onnx`));
  const sttOk = fs.existsSync(WEXE) && fs.existsSync(WMODEL);

  console.log('');
  console.log(`  speech out (piper)    ${ttsOk ? 'ready' : 'MISSING'}`);
  console.log(`  speech in  (whisper)  ${sttOk ? 'ready' : 'MISSING — will fall back to Windows System.Speech'}`);
  console.log(ttsOk ? '\nrestart the app to pick it up' : '\nsomething is missing; check the output above');
  // Under --if-needed a partial install is a degraded feature, not a failed
  // install, so it reports and still exits 0.
  process.exit(ttsOk || IF_NEEDED ? 0 : 1);
})().catch((e) => {
  console.error('failed:', e.message);
  if (IF_NEEDED) {
    console.error('voice is not installed; the app still runs. retry with: npm run voice:setup');
    process.exit(0);
  }
  process.exit(1);
});
