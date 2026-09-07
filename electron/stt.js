/**
 * Speech-to-text via Windows' built-in recogniser, in the MAIN process.
 *
 * Verified present on this machine: MS-1033-80-DESK, "Microsoft Speech
 * Recognizer 8.0 for Windows (English - US)". Free, offline, no download, no
 * API key.
 *
 * Chosen over the two alternatives that failed:
 *   - webkitSpeechRecognition exists in Electron but errors with `network` —
 *     Chromium ships without Google's speech backend.
 *   - Whisper via transformers.js segfaulted the renderer (0xC0000005).
 *
 * Two grammars are loaded together. A Choices grammar of the phrases the
 * assistant actually understands recognises those near-perfectly, because it
 * is matching rather than transcribing. DictationGrammar catches everything
 * else so arbitrary questions still reach Joeru, less reliably. The engine
 * returns whichever scores higher.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** Phrases the local intent router handles — worth recognising exactly. */
const PHRASES = [
  "what's the status", 'what is the status', 'status',
  'what should we do next', 'what should I do next', "what's next", 'what next',
  "what's broken", 'what is broken', 'is anything broken', 'is anything stalled',
  'how much have I spent', 'what did I spend', 'how much did I spend', 'cost',
  'any update', 'any updates', 'what is the update', 'progress',
];

let current = null;

function script(timeoutSeconds) {
  const choices = PHRASES.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
  // Written to a file rather than passed with -Command: the grammar contains
  // quotes and apostrophes that do not survive shell quoting intact.
  return `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $rec.SetInputToDefaultAudioDevice()

  $choices = New-Object System.Speech.Recognition.Choices(@(${choices}))
  $gb = New-Object System.Speech.Recognition.GrammarBuilder
  $gb.Append($choices)
  $rec.LoadGrammar((New-Object System.Speech.Recognition.Grammar($gb)))
  $rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

  $result = $rec.Recognize([TimeSpan]::FromSeconds(${timeoutSeconds}))
  if ($result -eq $null) {
    Write-Output 'SYNAPSE_STT_EMPTY'
  } else {
    Write-Output ("SYNAPSE_STT_OK|" + [math]::Round($result.Confidence,3) + "|" + $result.Text)
  }
  $rec.Dispose()
} catch {
  Write-Output ("SYNAPSE_STT_ERR|" + $_.Exception.Message)
}
`.trim();
}

/**
 * Listen once and resolve with what was heard.
 * @returns {Promise<{text: string, confidence: number} | null>} null if nothing was said
 */
function listen({ timeoutSeconds = 12 } = {}) {
  cancel();

  const file = path.join(os.tmpdir(), `synapse-stt-${crypto.randomBytes(6).toString('hex')}.ps1`);
  fs.writeFileSync(file, script(timeoutSeconds), 'utf8');

  return new Promise((resolve, reject) => {
    // -ExecutionPolicy Bypass because this machine's policy blocks .ps1 by
    // default; the file is one we just wrote, not user content.
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file,
    ], { windowsHide: true });
    current = proc;

    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });

    proc.on('error', (e) => {
      current = null;
      fs.promises.unlink(file).catch(() => {});
      reject(new Error(`recogniser failed to start: ${e.message}`));
    });

    proc.on('close', (_code, signal) => {
      current = null;
      fs.promises.unlink(file).catch(() => {});
      if (signal) { resolve(null); return; }   // cancelled

      const line = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('SYNAPSE_STT_'));
      if (!line) {
        reject(new Error(`recogniser said nothing usable: ${(err || out).trim().slice(0, 200)}`));
        return;
      }
      if (line.startsWith('SYNAPSE_STT_EMPTY')) { resolve(null); return; }
      if (line.startsWith('SYNAPSE_STT_ERR')) {
        reject(new Error(line.split('|').slice(1).join('|') || 'recogniser error'));
        return;
      }
      const [, confidence, ...rest] = line.split('|');
      resolve({ text: rest.join('|').trim(), confidence: Number(confidence) || 0 });
    });
  });
}

function cancel() {
  if (current && !current.killed) {
    try { current.kill(); } catch { /* already gone */ }
  }
  current = null;
}

module.exports = { listen, cancel, PHRASES };
