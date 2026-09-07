/**
 * Neural text-to-speech via Piper, in the MAIN process.
 *
 * Why not the renderer: the OS voices Chromium's speechSynthesis can reach on
 * this machine are David and Zira — 2005-era formant synthesis, which is what
 * made the assistant sound fake. Piper is a local neural model and sounds
 * markedly better.
 *
 * Why not WASM in the renderer: that is exactly what killed the Whisper
 * attempt — onnxruntime faulted inside Chromium with an access violation
 * (0xC0000005) and took the window black with no diagnostics. A subprocess
 * fails with an exit code we can read and report.
 *
 * Measured on this machine: 0.35s of inference for 3.85s of speech, a
 * real-time factor of 0.09. Latency is not the constraint.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'vendor', 'piper');
const EXE = path.join(ROOT, 'piper', 'piper.exe');

/**
 * The roster, and the prosody that decides whether it sounds like a person or
 * a station announcement.
 *
 *   lengthScale  speed, INVERTED — below 1.0 is faster. 1.0 is Piper's default.
 *   noiseScale   prosody variation. 0.667 default. HIGHER is more expressive;
 *                lowering it is what makes a voice sound robotic.
 *   noiseW       phoneme-duration variation. 0.8 default. Higher is a less
 *                metronomic rhythm.
 *
 * An earlier tuning here went the wrong way: 1.06 speed with noiseScale 0.58,
 * aiming for "composed". Slower and flatter is exactly the recipe for robotic,
 * because noiseScale is the variation that makes speech sound alive. These
 * settings run slightly faster than default and slightly MORE expressive.
 *
 * alan is British RP, which does more for the assistant register than any
 * parameter below.
 */
const VOICES = {
  /**
   * Community Jarvis model (jgkawell/jarvis on HuggingFace, MIT-labelled,
   * en_GB, single speaker, 22050Hz).
   *
   * Provenance caveat, recorded here rather than left implicit: the official
   * rhasspy/piper-voices repo DECLINED these models on copyright grounds — the
   * maintainer would not host "voices derived from any copyrighted audio". The
   * MIT label is the uploader's and the training audio is undisclosed. Fine for
   * private local use; do not ship it in anything distributed.
   *
   * Its config declares length_scale 1.15, so it was tuned for a slower
   * delivery than the other voices. 1.02 is a compromise — quicker than the
   * trained default without the rushed diction that 0.95 gives it.
   */
  jarvis: {
    file: 'jarvis-medium.onnx',
    label: 'Jarvis — British, assistant',
    lengthScale: 1.02,
    noiseScale: 0.70,
    noiseW: 0.85,
  },
  /** Same voice, `high` tier: better timbre, 4.1s per answer against 1.5s. */
  'jarvis-hq': {
    file: 'jarvis-high.onnx',
    label: 'Jarvis HQ — slower to render',
    lengthScale: 1.02,
    noiseScale: 0.70,
    noiseW: 0.85,
  },
  alan: {
    file: 'en_GB-alan-medium.onnx',
    label: 'Alan — British male',
    lengthScale: 0.95,
    noiseScale: 0.70,
    noiseW: 0.85,
  },
  // medium, not high: the `high` model measured 9.4s per answer against
  // alan-medium's 1.7s. Nine seconds of silence reads as broken, so the better
  // model is the wrong choice here.
  ryan: {
    file: 'en_US-ryan-medium.onnx',
    label: 'Ryan — American male',
    lengthScale: 0.95,
    noiseScale: 0.70,
    noiseW: 0.85,
  },
  amy: {
    file: 'en_US-amy-medium.onnx',
    label: 'Amy — American female',
    lengthScale: 0.95,
    noiseScale: 0.70,
    noiseW: 0.85,
  },
};

/** Default. Change with setVoice(), or VOICE_ID for a different default. */
const VOICE_ID = 'jarvis';

const voicePath = (id) => path.join(ROOT, 'voices', VOICES[id].file);

/**
 * Prefer the configured default, but fall back to whatever is actually on
 * disk. `npm run voice:setup` fetches only the default voice, so a second
 * machine can legitimately have a different subset — dangling on a missing
 * file would mean no speech at all rather than a different voice.
 */
function firstInstalled() {
  if (VOICES[VOICE_ID] && fs.existsSync(voicePath(VOICE_ID))) return VOICE_ID;
  const found = Object.keys(VOICES).find((id) => fs.existsSync(voicePath(id)));
  return found ?? VOICE_ID;
}

let currentVoiceId = firstInstalled();

/** One synthesis at a time; a new request cancels the one in flight. */
let current = null;

function available() {
  return fs.existsSync(EXE) && fs.existsSync(voicePath(currentVoiceId));
}

/** Only voices actually present on disk — the UI must not offer a missing one. */
function installedVoices() {
  return Object.entries(VOICES)
    .filter(([id]) => fs.existsSync(voicePath(id)))
    .map(([id, v]) => ({ id, label: v.label, current: id === currentVoiceId }));
}

function setVoice(id) {
  if (!VOICES[id]) throw new Error(`unknown voice: ${id}`);
  if (!fs.existsSync(voicePath(id))) throw new Error(`voice not downloaded: ${VOICES[id].file}`);
  cancel();
  currentVoiceId = id;
  return currentVoiceId;
}

function describe() {
  const ok = available();
  return {
    available: ok,
    exe: EXE,
    voice: currentVoiceId,
    voiceLabel: VOICES[currentVoiceId]?.label ?? currentVoiceId,
    voices: installedVoices(),
    reason: ok ? null
      : `Piper not installed. Expected ${EXE} and ${voicePath(currentVoiceId)} — run: npm run voice:setup`,
  };
}

/**
 * Synthesize to a WAV buffer.
 *
 * Writes to a temp file rather than streaming raw PCM over stdout: the WAV
 * header carries the sample rate, so the renderer does not have to know the
 * model's rate and cannot mis-play it as chipmunk audio.
 */
function speak(text) {
  cancel();

  const clean = String(text || '').trim();
  if (!clean) return Promise.resolve(null);
  if (!available()) return Promise.reject(new Error(describe().reason));

  const out = path.join(os.tmpdir(), `synapse-tts-${crypto.randomBytes(6).toString('hex')}.wav`);
  const v = VOICES[currentVoiceId];

  return new Promise((resolve, reject) => {
    const proc = spawn(EXE, [
      '--model', voicePath(currentVoiceId),
      '--output_file', out,
      '--length_scale', String(v.lengthScale),
      '--noise_scale', String(v.noiseScale),
      '--noise_w', String(v.noiseW),
    ], {
      cwd: path.join(ROOT, 'piper'),   // espeak-ng-data is resolved relative to cwd
      windowsHide: true,
    });
    current = proc;

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      current = null;
      reject(new Error(`piper failed to start: ${err.message}`));
    });

    proc.on('close', (code, signal) => {
      current = null;
      if (signal) { resolve(null); return; }   // cancelled, not an error
      if (code !== 0) {
        reject(new Error(`piper exited ${code}: ${stderr.trim().split('\n').slice(-2).join(' ')}`));
        return;
      }
      try {
        const wav = fs.readFileSync(out);
        resolve(wav);
      } catch (err) {
        reject(new Error(`piper produced no audio: ${err.message}`));
      } finally {
        fs.promises.unlink(out).catch(() => {});
      }
    });

    proc.stdin.on('error', () => {});   // killed mid-write
    proc.stdin.end(clean);
  });
}

/** Barge-in: stop synthesizing so a new question is not queued behind the old answer. */
function cancel() {
  if (current && !current.killed) {
    try { current.kill(); } catch { /* already gone */ }
  }
  current = null;
}

module.exports = { speak, cancel, available, describe, setVoice, installedVoices, VOICES };
