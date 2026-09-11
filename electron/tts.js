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
  // The parked process has the OLD model loaded, which is the whole point of
  // it — so it is worthless now. Re-park on the new voice so the first answer
  // after a switch is as quick as the rest.
  dropStandby();
  warm();
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
 * A Piper process spawned in advance, model already loaded, waiting on stdin.
 *
 * Piper loads its 60MB ONNX model at startup, BEFORE it reads a word of input,
 * and that load was being paid on every single answer. Measured, feeding the
 * same sentence to a process that was already up:
 *
 *   spawn and feed immediately   1260ms   (what this used to do)
 *   spawn, idle 1s, then feed     405ms
 *   spawn, idle 3s, then feed     500ms
 *
 * So roughly 800ms of the delay before Joeru started speaking was model load,
 * not synthesis. Keeping one process parked on stdin removes it.
 *
 * Deliberately a standby rather than one long-lived process serving every
 * request: with `--output_file` a process handles one utterance and exits,
 * which keeps the existing protocol exactly as it was — a complete WAV, whose
 * header carries the sample rate. A resident multi-request process would have
 * to stream raw PCM, and then the renderer needs the rate out of band and has
 * to schedule chunks itself. The renderer's audio path has already crashed
 * Chromium three times; this buys most of the win without going back in there.
 */
let standby = null;

function spawnPiper(outFile) {
  const v = VOICES[currentVoiceId];
  return spawn(EXE, [
    '--model', voicePath(currentVoiceId),
    '--output_file', outFile,
    '--length_scale', String(v.lengthScale),
    '--noise_scale', String(v.noiseScale),
    '--noise_w', String(v.noiseW),
  ], {
    cwd: path.join(ROOT, 'piper'),   // espeak-ng-data is resolved relative to cwd
    windowsHide: true,
  });
}

const tempWav = () =>
  path.join(os.tmpdir(), `synapse-tts-${crypto.randomBytes(6).toString('hex')}.wav`);

/**
 * Park a process so the next answer does not pay for the model load.
 *
 * Safe to call repeatedly. Called when the Assistant window opens rather than
 * at app start, so someone who never uses voice never carries the process.
 */
function warm() {
  if (standby || !available()) return false;

  const out = tempWav();
  let proc;
  try {
    proc = spawnPiper(out);
  } catch {
    return false;   // warming is an optimisation; never let it throw
  }

  const entry = {
    proc, out, voiceId: currentVoiceId, stderr: '', dead: false,
  };
  proc.stderr.on('data', (d) => { entry.stderr += d.toString(); });
  proc.stdin.on('error', () => {});
  // A standby that dies before use must not be handed out as if it were live.
  proc.on('error', () => { entry.dead = true; if (standby === entry) standby = null; });
  proc.on('close', () => {
    entry.dead = true;
    if (standby === entry) {
      standby = null;
      // It exited without ever being given text, so its file is unused.
      fs.promises.unlink(out).catch(() => {});
    }
  });

  standby = entry;
  return true;
}

/** Discard the parked process — on quit, or when it is for the wrong voice. */
function dropStandby() {
  const s = standby;
  standby = null;
  if (!s) return;
  try { if (!s.proc.killed) s.proc.kill(); } catch { /* already gone */ }
  fs.promises.unlink(s.out).catch(() => {});
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

  // Take the parked process when it is usable, otherwise start one now. A
  // standby for a different voice is useless — the model is already loaded.
  let handoff = null;
  if (standby && !standby.dead && standby.voiceId === currentVoiceId) {
    handoff = standby;
    standby = null;
  } else if (standby) {
    dropStandby();
  }

  const out = handoff ? handoff.out : tempWav();

  return new Promise((resolve, reject) => {
    const proc = handoff ? handoff.proc : spawnPiper(out);
    current = proc;

    // A handed-off process has been running since before this call, so seed
    // from what it already logged — otherwise a startup complaint (a bad model
    // path, missing espeak data) is lost and the error says nothing useful.
    let stderr = handoff ? handoff.stderr : '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      current = null;
      fs.promises.unlink(out).catch(() => {});
      reject(new Error(`piper failed to start: ${err.message}`));
    });

    proc.on('close', (code, signal) => {
      current = null;

      /*
       * Re-park only now that synthesis is finished, not when it started.
       *
       * Warming costs a full model load, and doing it alongside the synthesis
       * it is meant to accelerate just made them compete: measured 778-849ms
       * per answer with the load running concurrently, against ~500ms when the
       * standby had the machine to itself. Starting here means the load
       * overlaps PLAYBACK instead — seconds of audio during which nothing else
       * needs the CPU, and far more than the ~800ms it takes.
       */
      setImmediate(warm);

      // Every exit path deletes the temp file. The cancelled branch used to
      // return before the cleanup below, so barge-in — which happens on every
      // interruption — left a WAV behind in the temp directory each time.
      const done = (fn) => { fs.promises.unlink(out).catch(() => {}); fn(); };

      if (signal) { done(() => resolve(null)); return; }   // cancelled, not an error
      if (code !== 0) {
        done(() => reject(new Error(
          `piper exited ${code}: ${stderr.trim().split('\n').slice(-2).join(' ')}`)));
        return;
      }
      let wav = null;
      try {
        wav = fs.readFileSync(out);
      } catch (err) {
        done(() => reject(new Error(`piper produced no audio: ${err.message}`)));
        return;
      }
      done(() => resolve(wav));
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

/**
 * Release the parked process. For app quit — an idle piper holds a 60MB model
 * resident, and its unused temp file should not outlive the app.
 */
function shutdown() {
  cancel();
  dropStandby();
}

module.exports = {
  speak, cancel, available, describe, setVoice, installedVoices, VOICES,
  warm, shutdown,
};
