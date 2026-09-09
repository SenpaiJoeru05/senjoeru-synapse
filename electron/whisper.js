/**
 * Speech-to-text via whisper.cpp, in the MAIN process.
 *
 * Replaces Windows System.Speech, which is pre-neural and failed on exactly
 * the utterances a voice assistant gets most: measured against the same clips,
 * Windows managed 2 of 7 while this managed 7 of 7.
 *
 *   spoken               Windows 8.0        whisper.cpp
 *   hello                "All that"         "Hello."
 *   hi                   "I thought it"     "Hi."
 *   hey there            "And that"         "Hey there."
 *   tell me a joke       "Kalmia joke"      "Tell me a joke."
 *   what is the status   (no result)        "What is the status?"
 *
 * Note this is whisper.cpp — a native binary run as a subprocess — and NOT
 * transformers.js, which ran Whisper as WASM inside the renderer and crashed
 * Chromium with an access violation. Same model, completely different failure
 * surface: a subprocess that dies gives us an exit code, not a black window.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { correct } = require('./vocabulary');

const ROOT = path.join(__dirname, '..', 'vendor', 'whisper');
const MODEL = path.join(ROOT, 'models', 'ggml-base.en.bin');

/** Whisper is trained at 16kHz; the recorder must produce exactly this. */
const SAMPLE_RATE = 16000;

/** A short command should never take this long; something has gone wrong. */
const TIMEOUT_MS = 60_000;

/**
 * Initial prompt: context the decoder conditions on, biasing it toward this
 * workspace's spellings so "Joeru" and "fsweb" become likely tokens.
 *
 * This exact wording is measured, not decorative. On the project-vocabulary
 * clips it took whisper-cli from 20/24 (7.7% WER) to 22/24 (1.9%). The same
 * terms as a bare word list — "Joeru. fsweb. OpenCode." — scored 20/24 and
 * 5.8%, worse than this sentence, because an initial prompt is preceding
 * SPEECH and a list is unlike anything a person says. Reword it and the
 * numbers move, so re-measure if you do.
 */
const PROMPT = 'Joeru, tell me about Senjoeru Synapse, joeru-kit, fsweb, '
  + 'fs-llm-service, cs-dashboard, chat-widget, seller-page, the FlowerStore '
  + 'chatbot, OpenCode, and Haiku.';

let cachedExe = null;

/**
 * The release zip nests the binaries under Release/, and that has moved
 * between builds — so search rather than assume a path.
 */
function findExe() {
  if (cachedExe !== null) return cachedExe;
  const candidates = [
    path.join(ROOT, 'Release', 'whisper-cli.exe'),
    path.join(ROOT, 'whisper-cli.exe'),
    path.join(ROOT, 'bin', 'whisper-cli.exe'),
  ];
  cachedExe = candidates.find((p) => fs.existsSync(p)) || null;
  return cachedExe;
}

function available() {
  return !!findExe() && fs.existsSync(MODEL);
}

function describe() {
  const exe = findExe();
  return {
    available: available(),
    engine: 'whisper.cpp (ggml-base.en)',
    exe,
    model: MODEL,
    sampleRate: SAMPLE_RATE,
    reason: available() ? null
      : `whisper.cpp not installed. Expected ${candidatesHint()} and ${MODEL} — run: npm run voice:setup`,
  };
}

const candidatesHint = () => path.join(ROOT, 'Release', 'whisper-cli.exe');

let current = null;

/**
 * Transcribe 16kHz mono 16-bit PCM WAV bytes.
 *
 * Takes a complete WAV rather than raw samples because whisper-cli reads a
 * file: the renderer captures raw PCM and wraps it, so no audio decoding
 * happens anywhere — decodeAudioData is the call that crashed the renderer
 * once already and is now avoided on both the record and playback paths.
 */
function transcribe(wav) {
  cancel();

  if (!available()) return Promise.reject(new Error(describe().reason));
  if (!wav || !wav.length) return Promise.resolve('');

  const file = path.join(os.tmpdir(), `synapse-stt-${crypto.randomBytes(6).toString('hex')}.wav`);
  fs.writeFileSync(file, wav);

  return new Promise((resolve, reject) => {
    const proc = spawn(findExe(), [
      '-m', MODEL,
      '-f', file,
      '--no-timestamps',
      '--no-prints',
      '--language', 'en',
      /*
       * Bias decoding toward this workspace's vocabulary.
       *
       * An initial prompt is context the model conditions on, so the tokens
       * for "Joeru" and "fsweb" become cheap instead of unlikely — the fix
       * applied at decode time rather than repaired afterwards.
       *
       * Only available here. whisper-stream has no --prompt flag, so the live
       * path gets correction after the fact and this one gets both.
       */
      '--prompt', PROMPT,
      // Temperature fallback retries a failed decode more creatively, which on
      // a short command produces confident invention. Matches the live path.
      '--no-fallback',
      // One thread per physical core, capped: more threads on a short clip
      // costs more in scheduling than it saves.
      '--threads', String(Math.max(2, Math.min(8, os.cpus().length))),
    ], { cwd: path.dirname(findExe()), windowsHide: true });
    current = proc;

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* gone */ }
      reject(new Error(`whisper did not finish within ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });

    proc.on('error', (e) => {
      clearTimeout(timer);
      current = null;
      fs.promises.unlink(file).catch(() => {});
      reject(new Error(`could not start whisper: ${e.message}`));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      current = null;
      fs.promises.unlink(file).catch(() => {});
      if (signal) { resolve(''); return; }   // cancelled
      if (code !== 0) {
        reject(new Error(`whisper exited ${code}: ${err.trim().split('\n').slice(-2).join(' ')}`));
        return;
      }
      resolve(clean(out));
    });
  });
}

/**
 * Whisper invents speech from near-silence, and the output has to be treated
 * as untrusted rather than passed on as a question.
 *
 * Two kinds of artifact. Bracketed markers — "[BLANK_AUDIO]", "(silence)",
 * "[Music]" — are explicit and easy. The dangerous kind is plausible filler:
 * one second of DIGITAL SILENCE transcribed as "you" in testing, and this
 * model family is well known for emitting "Thank you.", "Thanks for
 * watching!" and subtitle credits on noise. None of that is bracketed, so
 * without this it would be sent to Claude as a genuine question — 13 seconds
 * and real quota answering something never said.
 *
 * The recorder already rejects audio below a peak threshold, so this is the
 * second line: room noise can clear that gate and still be non-speech.
 */
const HALLUCINATIONS = [
  'you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching',
  'bye', 'bye bye', 'okay', 'ok', 'oh', 'um', 'uh', 'mm', 'hmm', 'yeah',
  'subtitles by the amaraorg community', 'transcription by castingwordscom',
];

function clean(text) {
  const stripped = String(text)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:silence|music|inaudible|blank[^)]*)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Only very short outputs are suspect. "Thanks" alone is almost certainly
  // noise; "thanks, what is the status" is a real utterance that happens to
  // start with it, so length guards against over-filtering.
  const bare = stripped.toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (bare.split(/\s+/).length <= 4 && HALLUCINATIONS.includes(bare)) return '';

  /*
   * Project vocabulary last, after discarding.
   *
   * Whisper knows English but not this workspace: measured on synthesized
   * commands, generic phrasing scored 14/20 while project vocabulary scored
   * 6/24, and "Joeru" — the name of the agent being addressed — was never
   * once correct. See vocabulary.js.
   *
   * It runs after the hallucination filter so a correction can never turn
   * discardable noise into something that looks like a real question.
   */
  return correct(stripped);
}

function cancel() {
  if (current && !current.killed) {
    try { current.kill(); } catch { /* gone */ }
  }
  current = null;
}

// ─── microphone capture, also in the main process ────────────────────────────

/**
 * whisper-stream owns the microphone, so the renderer never touches capture.
 *
 * This is the third capture design and the first that does not put Chromium in
 * the audio path. The two before it both crashed the renderer with an access
 * violation (0xC0000005):
 *
 *   MediaRecorder -> decodeAudioData     faulted resampling 22050 -> 48000
 *   AudioContext({sampleRate: 16000})    faulted resampling 48000 -> 16000
 *
 * The pattern was rate conversion inside Chromium's audio pipeline. SDL2 opens
 * the device at 16000Hz natively — verified: "sample rate: 16000 (required)" —
 * so nothing resamples at all, and a subprocess that dies gives an exit code
 * instead of taking the window with it.
 *
 * Everything that has been stable today lives out here: Piper, whisper-cli,
 * System.Speech, the Claude CLI. Every crash was in the renderer.
 */
const STREAM_EXE_NAMES = ['whisper-stream.exe'];

function findStreamExe() {
  for (const dir of [path.join(ROOT, 'Release'), ROOT, path.join(ROOT, 'bin')]) {
    for (const name of STREAM_EXE_NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function canListen() {
  return !!findStreamExe() && fs.existsSync(MODEL);
}

let listener = null;

/**
 * Start listening. Resolves immediately; the transcript comes from stopListen.
 *
 * Transcription goes to a file via -f rather than being scraped from stdout:
 * whisper-stream redraws a rolling window on the terminal, so parsing it means
 * de-duplicating partial repeats. The file holds the settled text.
 */
function startListen() {
  stopListenProcess();
  if (!canListen()) throw new Error('whisper-stream not installed — run: npm run voice:setup');

  const exe = findStreamExe();
  const out = path.join(os.tmpdir(), `synapse-listen-${crypto.randomBytes(6).toString('hex')}.txt`);
  fs.writeFileSync(out, '');

  const proc = spawn(exe, [
    '-m', MODEL,
    '-f', out,
    /*
     * VAD mode, not timed chunks. This is the difference between transcribing
     * what was said and inventing what wasn't.
     *
     * `--step 1500` was the earlier setting, and it transcribes every 1.5s
     * whether or not anyone spoke: a five-second turn became three passes over
     * six-second windows mostly full of silence. Whisper is generative, so
     * given silence it produces the most plausible text rather than none —
     * which is exactly the "words I never said" problem.
     *
     * `--step 0` switches to voice-activity detection: it waits for speech,
     * then transcribes that segment once. The banner confirms it —
     * "using VAD, will transcribe on speech activity".
     */
    '--step', '0',
    '--length', '10000',
    /*
     * The two VAD thresholds, passed explicitly at their own defaults.
     *
     * They change nothing today — 0.60 and 100.00 are what whisper-stream
     * already uses. They are here because they are the knobs to reach for if
     * the VAD proves too eager or too deaf in this room, and finding them
     * later means knowing they exist. Raise vad-thold if noise is being taken
     * for speech; lower it if quiet speech is being missed.
     */
    '-vth', '0.60',
    '-fth', '100.00',
    /*
     * No temperature fallback. When decoding fails its confidence checks
     * whisper normally retries at a higher temperature, which is more
     * creative and therefore more prone to inventing. For short commands a
     * refusal is far better than a confident fabrication.
     */
    '--no-fallback',
    /*
     * Raise the per-chunk token cap. whisper-stream defaults to 32, which is
     * roughly 24 words — and with --length 10000 a full ten-second window can
     * hold nearer 30. Left at the default a longer question is silently
     * truncated mid-sentence, which reads as mishearing rather than as a
     * limit being hit. This is a ceiling, not an allocation, so raising it
     * costs nothing on the short commands that are the normal case.
     */
    '-mt', '128',
    '-t', String(Math.max(2, Math.min(8, os.cpus().length))),
    '--language', 'en',
  ], { cwd: path.dirname(exe), windowsHide: true });

  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.stdout.on('data', () => {});   // drained so the pipe cannot fill and stall

  listener = { proc, out, stderr: () => stderr, startedAt: Date.now() };
  return { started: true };
}

/** Stop listening and return everything that was transcribed. */
async function stopListen() {
  const active = listener;
  if (!active) return '';

  const exited = new Promise((resolve) => {
    active.proc.once('close', resolve);
    setTimeout(resolve, 4000);   // never hang the UI on a stuck process
  });
  try { active.proc.kill(); } catch { /* already gone */ }
  await exited;

  listener = null;

  let text = '';
  try { text = fs.readFileSync(active.out, 'utf8'); } catch { /* nothing written */ }
  fs.promises.unlink(active.out).catch(() => {});

  if (!text.trim() && /error|fail/i.test(active.stderr())) {
    throw new Error(active.stderr().trim().split('\n').slice(-2).join(' '));
  }

  // whisper-stream appends each pass, and overlapping windows repeat phrases.
  return clean(dedupe(text));
}

/**
 * Collapse consecutive duplicate lines, so a phrase is not asked twice over.
 *
 * Less load-bearing under VAD than it was under timed stepping, where
 * overlapping windows re-fed the tail of the previous chunk and repetition was
 * routine. It stays because VAD still segments on pauses, and a pause mid
 * sentence can split one utterance into two passes that share words.
 */
function dedupe(raw) {
  const lines = String(raw).split('\n').map((l) => l.trim()).filter(Boolean);
  const kept = [];
  for (const line of lines) {
    const last = kept[kept.length - 1];
    if (last && (last === line || last.endsWith(line) || line.endsWith(last))) {
      // Keep the longer of the two — the later pass usually has more context.
      if (line.length > last.length) kept[kept.length - 1] = line;
      continue;
    }
    kept.push(line);
  }
  return kept.join(' ');
}

function stopListenProcess() {
  if (listener?.proc && !listener.proc.killed) {
    try { listener.proc.kill(); } catch { /* gone */ }
  }
  listener = null;
}

module.exports = {
  transcribe, cancel, available, describe, SAMPLE_RATE,
  startListen, stopListen, canListen, cancelListen: stopListenProcess,
};
