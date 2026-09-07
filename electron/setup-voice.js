#!/usr/bin/env node
/**
 * Fetches Piper (neural TTS) into vendor/. Run once per machine:
 *
 *   npm run voice:setup
 *
 * vendor/ is gitignored — ~80MB of binary does not belong in the repo — so
 * this exists to make the install reproducible rather than a remembered
 * sequence of manual downloads.
 *
 * Voice output degrades honestly without it: Assistant Mode reports that Piper
 * is missing and still answers in text.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'vendor', 'piper');
const EXE = path.join(ROOT, 'piper', 'piper.exe');
const VOICES = path.join(ROOT, 'voices');

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

(async () => {
  if (process.platform !== 'win32') {
    console.error('This fetches the Windows build of Piper. Adapt the URL for another platform.');
    process.exit(1);
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
  const ok = fs.existsSync(EXE) && fs.existsSync(path.join(VOICES, `${def.stem}.onnx`));
  console.log(ok ? '\nvoice ready — restart the app' : '\nsomething is missing; check the output above');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
