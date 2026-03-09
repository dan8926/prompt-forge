'use strict';

const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

// ════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════
const PORT             = process.env.PORT       || 3030;
const OLLAMA_URL       = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
const DATA_DIR         = process.env.DATA_DIR   || path.join(__dirname, 'data');
const LOG_FILE         = path.join(DATA_DIR, 'logs.jsonl');   // UI event log (client → server)
const SERVER_LOG_FILE  = path.join(DATA_DIR, 'server.log');   // structured server log
const MAX_UI_LOG       = 2000;   // rolling cap on logs.jsonl
const MAX_SERVER_LOG   = 5000;   // rolling cap on server.log
const OLLAMA_TIMEOUT   = 30_000; // ms — non-streaming requests only (streaming uses no timeout)
const JSON_BODY_LIMIT  = '512kb';

// ════════════════════════════════════════════════════════════════════════
// STRUCTURED LOGGER
//
// All log calls write a JSON-line to:
//   1. stdout     — captured by Docker log driver / systemd / PM2
//   2. server.log — persistent rolling file in DATA_DIR
//
// Schema: { ts, level, reqId?, msg, ...ctx }
// Levels: debug | info | warn | error
//
// We intentionally do NOT use a third-party logger (winston/pino) so the
// container image stays minimal and the file has zero extra dependencies.
// ════════════════════════════════════════════════════════════════════════

let _serverLogReady = false; // flipped to true once DATA_DIR write-probe passes

/**
 * Core log writer. Safe to call before DATA_DIR is confirmed — gracefully
 * degrades to stdout-only when the file is not yet available.
 *
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} msg
 * @param {object} [ctx]  Extra fields merged into the log line
 */
function log(level, msg, ctx = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx });

  // Always emit to stdout so container orchestrators capture everything
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  // Also write to the rolling server.log file when available
  if (!_serverLogReady) return;
  try {
    fs.appendFileSync(SERVER_LOG_FILE, line + '\n', 'utf8');
    // Rolling trim — keep newest MAX_SERVER_LOG lines
    const content = fs.readFileSync(SERVER_LOG_FILE, 'utf8').trim();
    const lines   = content.split('\n').filter(Boolean);
    if (lines.length > MAX_SERVER_LOG) {
      fs.writeFileSync(SERVER_LOG_FILE, lines.slice(-MAX_SERVER_LOG).join('\n') + '\n', 'utf8');
    }
  } catch (fileErr) {
    // Never recurse — emit to stdout only
    console.error(JSON.stringify({
      ts: new Date().toISOString(), level: 'error',
      msg: 'server.log write failed', error: fileErr.message,
    }));
  }
}

// ════════════════════════════════════════════════════════════════════════
// DATA DIRECTORY INITIALISATION
//
// Create DATA_DIR if missing and run a write probe to confirm it is
// actually writable (volume mount may exist but be read-only).
// If setup fails we log clearly and continue — the app still works,
// disk persistence is just disabled for this session.
// ════════════════════════════════════════════════════════════════════════
(function initDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write-probe — distinguishes "dir exists" from "dir is writable"
    const probe = path.join(DATA_DIR, '.write-probe');
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    _serverLogReady = true;
    log('info', 'Data directory ready', { dataDir: DATA_DIR, logFile: LOG_FILE, serverLog: SERVER_LOG_FILE });
  } catch (e) {
    // Use console.error directly — log() file path not ready yet
    console.error(JSON.stringify({
      ts: new Date().toISOString(), level: 'error',
      msg: 'DATA_DIR setup failed — disk logging disabled for this session',
      error: e.message, dataDir: DATA_DIR,
      hint: 'Check volume mount permissions. The API will continue without disk logging.',
    }));
  }
})();

// ════════════════════════════════════════════════════════════════════════
// PROCESS-LEVEL ERROR GUARDS
//
// Without these, an uncaught exception or unhandled rejection in Node
// will either silently swallow the error (older Node) or terminate the
// process with a non-zero exit code (Node ≥ 15). We catch both, log
// them in full, and keep the HTTP server alive.
// ════════════════════════════════════════════════════════════════════════
process.on('uncaughtException', (err, origin) => {
  log('error', 'Uncaught exception — server may be in inconsistent state', {
    error: err.message, stack: err.stack, origin,
  });
  // Do NOT exit — the Express server can still handle new requests unless
  // this was something truly unrecoverable (ENOMEM, EBADF etc.)
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack   = reason instanceof Error ? reason.stack   : undefined;
  log('error', 'Unhandled promise rejection', { error: message, stack });
});

// ════════════════════════════════════════════════════════════════════════
// ERROR CLASSIFIER
//
// Translates raw Node / fetch errors into structured objects with:
//   code        — machine-readable identifier
//   userMessage — shown in the UI (helpful, non-technical)
//   devMessage  — written to server log (technical details)
//
// This ensures every error path shows something meaningful rather than
// "[object Object]" or the raw Node error code.
// ════════════════════════════════════════════════════════════════════════
function classifyError(err, context) {
  const e = err instanceof Error ? err : new Error(String(err));

  if (e.code === 'ECONNREFUSED') return {
    code: 'OLLAMA_UNREACHABLE',
    userMessage: `Cannot connect to Ollama at ${OLLAMA_URL}. Make sure Ollama is running.`,
    devMessage:  `ECONNREFUSED to ${OLLAMA_URL} during ${context}`,
  };
  if (e.code === 'ENOTFOUND') return {
    code: 'DNS_FAILURE',
    userMessage: `Cannot resolve Ollama host. Check OLLAMA_URL (current: "${OLLAMA_URL}").`,
    devMessage:  `ENOTFOUND: DNS resolution failed for ${OLLAMA_URL} during ${context}`,
  };
  if (e.code === 'ETIMEDOUT' || e.name === 'AbortError') return {
    code: 'TIMEOUT',
    userMessage: `Request timed out after ${OLLAMA_TIMEOUT / 1000}s. Ollama may be overloaded or the model is very large.`,
    devMessage:  `Timeout (${e.code || e.name}) during ${context}`,
  };
  if (e.code === 'ECONNRESET') return {
    code: 'CONNECTION_RESET',
    userMessage: 'Ollama closed the connection unexpectedly. This can happen when a model is reloaded.',
    devMessage:  `ECONNRESET from Ollama during ${context}`,
  };
  if (e instanceof SyntaxError || e.message.includes('JSON')) return {
    code: 'JSON_PARSE_ERROR',
    userMessage: 'The model returned unexpected output. Try a 7B+ instruction-tuned model.',
    devMessage:  `JSON parse error during ${context}: ${e.message}`,
  };
  return {
    code: 'UNKNOWN',
    userMessage: `${context} failed: ${e.message}`,
    devMessage:  `Unknown error during ${context}: ${e.message}`,
  };
}

// ════════════════════════════════════════════════════════════════════════
// FETCH WITH TIMEOUT
//
// All Ollama calls go through this wrapper.
// timeoutMs = 0  → no timeout (streaming responses may run for minutes)
// timeoutMs > 0  → AbortController fires after timeoutMs milliseconds
// ════════════════════════════════════════════════════════════════════════
async function fetchWithTimeout(url, options = {}, timeoutMs = OLLAMA_TIMEOUT) {
  if (timeoutMs === 0) return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ════════════════════════════════════════════════════════════════════════
let _reqSeq = 0;

const app = express();

// Attach a short request ID to every incoming request
app.use((req, _res, next) => {
  req.id = `r${String(++_reqSeq).padStart(5, '0')}`;
  next();
});

// Log every request on arrival and completion (status + duration)
app.use((req, res, next) => {
  const start = Date.now();
  const isApi = req.path.startsWith('/api/');
  log(isApi ? 'info' : 'debug', `→ ${req.method} ${req.path}`, {
    reqId: req.id,
    ip:    req.ip || req.socket?.remoteAddress,
    size:  req.headers['content-length'] || 0,
  });
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const lvl = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : (isApi ? 'info' : 'debug');
    log(lvl, `← ${req.method} ${req.path} ${res.statusCode}`, { reqId: req.id, ms });
  });
  next();
});

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════════════════════
// GET /api/health
// Full liveness check: probes Ollama AND verifies DATA_DIR writability.
// Returns 200 when everything is healthy, 207 when degraded.
// ════════════════════════════════════════════════════════════════════════
app.get('/api/health', async (req, res) => {
  const health = {
    status:    'ok',
    version:   '4.1.2',
    ollamaUrl: OLLAMA_URL,
    logFile:   LOG_FILE,
    serverLog: SERVER_LOG_FILE,
    dataDirOk: _serverLogReady,
    ollamaOk:  false,
    ts:        new Date().toISOString(),
  };

  try {
    const r = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 4_000);
    health.ollamaOk = r.ok;
    if (!r.ok) health.ollamaStatus = r.status;
  } catch (e) {
    const c = classifyError(e, 'health probe');
    health.ollamaError = c.code;
    log('warn', 'Health check: Ollama probe failed', { reqId: req.id, error: c.devMessage });
  }

  if (!health.ollamaOk || !health.dataDirOk) health.status = 'degraded';
  res.status(health.status === 'ok' ? 200 : 207).json(health);
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/logs — return UI event log (newest first)
// ════════════════════════════════════════════════════════════════════════
app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json({ entries: [] });
    const raw = fs.readFileSync(LOG_FILE, 'utf8').trim();
    if (!raw) return res.json({ entries: [] });

    let skipped = 0;
    const entries = raw.split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); }
        catch { skipped++; return null; } // corrupt line — skip, don't crash
      })
      .filter(Boolean)
      .reverse(); // newest first for UI

    if (skipped > 0) {
      log('warn', `GET /api/logs: skipped ${skipped} corrupt line(s)`, { reqId: req.id, file: LOG_FILE });
    }
    res.json({ entries, skipped });
  } catch (err) {
    const c = classifyError(err, 'GET /api/logs');
    log('error', c.devMessage, { reqId: req.id, stack: err.stack });
    res.status(500).json({ error: c.userMessage });
  }
});

// ════════════════════════════════════════════════════════════════════════
// POST /api/logs — append UI event entries + rolling trim
// ════════════════════════════════════════════════════════════════════════
app.post('/api/logs', (req, res) => {
  try {
    const raw     = Array.isArray(req.body) ? req.body : [req.body];
    const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'success']);
    const valid   = raw.filter(e => {
      if (!e || typeof e !== 'object' || !e.level || !e.message) return false;
      if (!VALID_LEVELS.has(e.level)) {
        log('warn', `POST /api/logs: dropped entry with unknown level "${e.level}"`, { reqId: req.id });
        return false;
      }
      return true;
    });

    if (valid.length === 0) return res.json({ ok: true, written: 0 });

    const lines = valid
      .map(e => JSON.stringify({
        ts:      e.ts || new Date().toISOString(),
        level:   e.level,
        message: String(e.message).slice(0, 2000), // guard against enormous messages
      }))
      .join('\n');

    fs.appendFileSync(LOG_FILE, lines + '\n', 'utf8');

    // Rolling trim — keep newest MAX_UI_LOG lines
    try {
      const content  = fs.readFileSync(LOG_FILE, 'utf8').trim();
      const allLines = content.split('\n').filter(Boolean);
      if (allLines.length > MAX_UI_LOG) {
        fs.writeFileSync(LOG_FILE, allLines.slice(-MAX_UI_LOG).join('\n') + '\n', 'utf8');
        log('debug', `POST /api/logs: trimmed UI log to ${MAX_UI_LOG} entries`, { reqId: req.id });
      }
    } catch (trimErr) {
      // Non-fatal — the append succeeded; only the trim failed
      log('warn', 'POST /api/logs: rolling trim failed', { reqId: req.id, error: trimErr.message });
    }

    res.json({ ok: true, written: valid.length });
  } catch (err) {
    const c = classifyError(err, 'POST /api/logs');
    log('error', c.devMessage, { reqId: req.id, stack: err.stack });
    res.status(500).json({ error: c.userMessage });
  }
});

// ════════════════════════════════════════════════════════════════════════
// DELETE /api/logs — truncate UI event log
// ════════════════════════════════════════════════════════════════════════
app.delete('/api/logs', (req, res) => {
  try {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
    log('info', 'UI event log cleared', { reqId: req.id });
    res.json({ ok: true });
  } catch (err) {
    const c = classifyError(err, 'DELETE /api/logs');
    log('error', c.devMessage, { reqId: req.id, stack: err.stack });
    res.status(500).json({ error: c.userMessage });
  }
});

// ════════════════════════════════════════════════════════════════════════
// GET /api/models — proxy Ollama model list
// ════════════════════════════════════════════════════════════════════════
app.get('/api/models', async (req, res) => {
  try {
    const response = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const msg  = `Ollama ${response.status} ${response.statusText}` + (body ? `: ${body.slice(0, 200)}` : '');
      log('error', 'GET /api/models: Ollama returned non-200', {
        reqId: req.id, status: response.status, body: body.slice(0, 200),
      });
      return res.status(502).json({ error: msg, code: 'OLLAMA_API_ERROR' });
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      throw new SyntaxError(`Ollama returned non-JSON: ${parseErr.message}`);
    }

    const models = (data.models || []).map(m => ({ name: m.name, size: m.size, modified: m.modified_at }));
    log('info', `Models loaded: ${models.length} available`, { reqId: req.id, models: models.map(m => m.name) });
    res.json({ models });

  } catch (err) {
    const c = classifyError(err, 'GET /api/models');
    log('error', c.devMessage, { reqId: req.id, stack: err.stack });
    res.status(502).json({ error: c.userMessage, code: c.code });
  }
});

// ════════════════════════════════════════════════════════════════════════
// FRAMEWORK FIELD KEYS
// ════════════════════════════════════════════════════════════════════════
const FIELD_KEYS = {
  costar:  ['context', 'objective', 'style', 'tone', 'audience', 'response_format'],
  risen:   ['role', 'input', 'scenario', 'expectation', 'nuance'],
  rtf:     ['role', 'task', 'format'],
  crispe:  ['capacity_role', 'insight', 'statement', 'personality', 'experiment'],
  race:    ['role', 'action', 'tactic', 'expectation'],
  care:    ['context', 'action', 'result', 'example'],
  cot:     ['role', 'problem', 'reasoning_hint', 'output_format'],
  tot:     ['role', 'problem', 'thought_paths', 'evaluation_criteria', 'output_format'],
  react:   ['role', 'problem', 'available_actions', 'output_format'],
  ape:     ['action', 'purpose', 'expectation'],
  five_s:  ['set_scene', 'specify_task', 'simplify_language', 'structure_response', 'share_feedback'],
  fewshot: ['role', 'task', 'example_input', 'example_output', 'format'],
  visual_image: ['subject', 'setting', 'art_style', 'lighting', 'camera', 'mood', 'color_palette', 'quality_tags', 'negative_prompt'],
  visual_video: ['scene', 'subject_motion', 'camera_movement', 'shot_type', 'lighting', 'mood_style', 'audio_cue', 'duration_pacing'],
};

function addLangInstruction(systemPrompt, outputLang, isVisual = false) {
  if (outputLang !== 'es') return systemPrompt;
  const note = isVisual
    ? ' Exception: keep platform-specific syntax terms in English (--ar, --v, masterpiece, dolly, etc.).'
    : '';
  return systemPrompt + `\n\n- LANGUAGE REQUIREMENT: Write your entire response in Spanish (Español).${note}`;
}

// ════════════════════════════════════════════════════════════════════════
// POST /api/analyze — extract structured fields (non-streaming)
// ════════════════════════════════════════════════════════════════════════
app.post('/api/analyze', async (req, res) => {
  const { rawPrompt, framework, model, outputLang } = req.body;

  // Explicit input validation with specific messages
  if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim())
    return res.status(400).json({ error: 'rawPrompt is required and must be a non-empty string.' });
  if (!model || typeof model !== 'string')
    return res.status(400).json({ error: 'model is required.' });

  const knownFrameworks = Object.keys(FIELD_KEYS);
  if (framework && !knownFrameworks.includes(framework)) {
    log('warn', `POST /api/analyze: unknown framework "${framework}"`, { reqId: req.id });
    return res.status(400).json({
      error: `Unknown framework "${framework}". Valid values: ${knownFrameworks.join(', ')}`,
    });
  }

  const fields   = FIELD_KEYS[framework] || FIELD_KEYS.costar;
  const isVisual = Boolean(framework && framework.startsWith('visual_'));
  const hint     = isVisual
    ? 'You are an expert AI art director and visual prompt engineer.'
    : 'You are a prompt engineering expert.';

  const base = `${hint} Given a rough user request, extract and infer the best values for each field. Return ONLY a valid JSON object with these exact keys: ${fields.join(', ')}.
Rules:
- Infer missing context intelligently from the user's intent
- Keep each value concise but complete (1-3 sentences max, or comma-separated tags for visual fields)
- Use empty string "" for fields that cannot be reasonably inferred
- No explanation, preamble, or markdown fences — raw JSON only`;

  const systemPrompt = addLangInstruction(base, outputLang, isVisual);
  const userMessage  = `Extract fields from this rough request (framework: ${framework || 'costar'}):\n\n${rawPrompt}`;

  log('info', `Auto-fill started: framework=${framework} model=${model}`, { reqId: req.id });

  try {
    const ollamaRes = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        options:  { temperature: 0.3, top_p: 0.9 },
      }),
    });

    if (!ollamaRes.ok) {
      const errorBody = await ollamaRes.text().catch(() => '');
      log('error', 'POST /api/analyze: Ollama non-200', {
        reqId: req.id, status: ollamaRes.status, body: errorBody.slice(0, 300),
      });
      return res.status(502).json({
        error: `Ollama ${ollamaRes.status}: ${errorBody.slice(0, 200) || ollamaRes.statusText}`,
      });
    }

    const data    = await ollamaRes.json();
    const raw     = (data.message?.content || '').trim();
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();

    if (!cleaned) {
      log('warn', 'POST /api/analyze: model returned empty content', { reqId: req.id, model, framework });
      return res.json({ fields: {}, warning: 'Model returned an empty response.' });
    }

    try {
      const parsed = JSON.parse(cleaned);
      log('info', `Auto-fill success: ${Object.keys(parsed).length} fields extracted`, { reqId: req.id });
      res.json({ fields: parsed });
    } catch (parseErr) {
      // Model produced non-JSON — return raw text so client can show it; log details server-side
      log('warn', 'POST /api/analyze: JSON parse failed — returning raw_fallback', {
        reqId:   req.id, model, framework,
        error:   parseErr.message,
        preview: cleaned.slice(0, 200),
      });
      res.json({
        fields:       {},
        raw_fallback: cleaned,
        warning:      'Model output was not valid JSON. Try a 7B+ instruction-tuned model.',
      });
    }

  } catch (err) {
    const c = classifyError(err, 'POST /api/analyze');
    log('error', c.devMessage, { reqId: req.id, model, framework, stack: err.stack });
    res.status(502).json({ error: c.userMessage, code: c.code });
  }
});

// ════════════════════════════════════════════════════════════════════════
// PROMPT BUILDER HELPERS  (unchanged logic from original)
// ════════════════════════════════════════════════════════════════════════
function assembleFrameworkSystemPrompt(framework, style) {
  const styleGuides = {
    precise:    'Emphasize clarity, specificity, and technical completeness.',
    creative:   'Encourage exploration, imagination, and open-ended thinking.',
    concise:    'Optimize for brevity — every word must earn its place.',
    stepbystep: 'Emphasize ordered process and numbered, explicit instructions.',
    debug:      'Emphasize diagnostic steps, error context, and environment details.',
  };
  const descriptions = {
    costar:  'COSTAR (Context · Objective · Style · Tone · Audience · Response Format)',
    risen:   'RISEN (Role · Input · Scenario · Expectation · Nuance)',
    rtf:     'RTF (Role · Task · Format)',
    crispe:  'CRISPE (Capacity/Role · Insight · Statement · Personality · Experiment)',
    race:    'RACE (Role · Action · Tactic · Expectation)',
    care:    'CARE (Context · Action · Result · Example)',
    cot:     'Chain of Thought (Role · Problem · Reasoning Hint · Output Format)',
    tot:     'Tree of Thoughts (Role · Problem · Thought Paths · Evaluation Criteria · Output Format)',
    react:   'ReAct (Role · Problem · Available Actions · Output Format)',
    ape:     'APE (Action · Purpose · Expectation)',
    five_s:  'Five S (Set Scene · Specify Task · Simplify Language · Structure Response · Share Feedback)',
    fewshot: 'Few-Shot (Role · Task · Example Input/Output · Format)',
  };
  return `You are a master prompt engineer. Assemble the provided structured components into a single, polished, immediately usable LLM prompt using the ${framework.toUpperCase()} framework.

Framework: ${descriptions[framework] || descriptions.costar}

Assembly rules:
- Output ONLY the assembled final prompt — no explanation, no meta-commentary
- The prompt must be self-contained; anyone can paste it directly into any LLM
- Weave components into natural prose — avoid raw KEY: value lists unless the framework demands labeled sections
- Include all non-empty fields; omit empty ones gracefully
- Style guidance: ${styleGuides[style] || styleGuides.precise}`;
}

function buildUserMessageFromFields(framework, fields, rawPrompt) {
  const fieldLines = Object.entries(fields)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k.toUpperCase().replace(/_/g, ' ')}: ${v}`)
    .join('\n');
  return `Assemble a complete ${framework.toUpperCase()} prompt from these components:\n\n${fieldLines}\n\nOriginal raw request (reference only): ${rawPrompt}`;
}

const IMAGE_PLATFORM_PROMPTS = {
  midjourney:      `You are a Midjourney v6 prompt expert.\n- Write vivid, comma-separated natural language (subject, setting, style, lighting, camera, mood)\n- Include strong quality descriptors: highly detailed, intricate, masterpiece, sharp focus\n- Append parameters at end: --ar [ratio] --style raw --v 6.1; default --ar 16:9 or --ar 1:1\n- Use --no flag for negative prompt content\n- Output ONLY the final Midjourney prompt — nothing else`,
  dalle3:          `You are a DALL-E 3 prompt expert.\n- Write complete, descriptive natural language sentences\n- Explicitly state the style: "a digital painting", "a photograph", "an oil painting"\n- No parameter syntax\n- Output ONLY the final DALL-E 3 prompt — nothing else`,
  stablediffusion: `You are a Stable Diffusion / Auto1111 prompt expert.\n- Format as comma-separated descriptive tags; use emphasis: (masterpiece:1.3), (highly detailed:1.2)\n- Start with quality boosters: masterpiece, best quality, ultra detailed, 8k uhd\n- Write on a new line: Negative prompt: [negative_prompt field + defaults: blurry, deformed, ugly, bad anatomy, watermark]\n- Output ONLY positive prompt then "Negative prompt: ..." — nothing else`,
  flux:            `You are a Flux.1 (Black Forest Labs) prompt expert.\n- Write clear descriptive sentences — Flux understands natural language well\n- Include quality terms: highly detailed, professional photography, 8K resolution\n- State the medium explicitly; include negative prompt on a new line if provided\n- Output ONLY the final Flux prompt — nothing else`,
  firefly:         `You are an Adobe Firefly prompt expert.\n- Write in clear descriptive natural language\n- Copyright-safe: no specific living artists or brands — use style descriptors instead\n- Output ONLY the final Firefly prompt — nothing else`,
  universal:       `You are a universal AI image prompt expert.\n- Structure: [subject + action] [environment] [art style + medium] [lighting] [camera/composition] [mood] [quality]\n- Use universally understood photography and art terms\n- Output ONLY the final image prompt — nothing else`,
};
const VIDEO_PLATFORM_PROMPTS = {
  sora:      `You are an OpenAI Sora video prompt expert. Write highly detailed cinematic scene descriptions. Always specify camera behavior and subject motion precisely. Output ONLY the final prompt paragraph — nothing else`,
  runway:    `You are a Runway Gen-3 Alpha video prompt expert. Keep concise and action-focused (100-300 words). Camera motion must be explicit. Output ONLY the final Runway prompt — nothing else`,
  pika:      `You are a Pika video prompt expert. Write clear, action-driven descriptions: [subject] [action] [setting] [camera motion] [visual style]. Output ONLY the final Pika prompt — nothing else`,
  kling:     `You are a Kling AI video prompt expert. Detailed descriptive natural language; specify subject movement precisely; use standard film terminology. Output ONLY the final Kling prompt — nothing else`,
  luma:      `You are a Luma Dream Machine video prompt expert. Emphasize visual fidelity, lead with scene-setting, describe lighting in detail. Output ONLY the final Luma prompt — nothing else`,
  universal: `You are a universal AI video prompt expert. Structure: [scene intro] [subject] [action] [camera movement] [lighting] [visual style]. Always specify camera motion. Output ONLY the final video prompt — nothing else`,
};

function buildImageSystemPrompt(p) { return IMAGE_PLATFORM_PROMPTS[p] || IMAGE_PLATFORM_PROMPTS.universal; }
function buildVideoSystemPrompt(p) { return VIDEO_PLATFORM_PROMPTS[p] || VIDEO_PLATFORM_PROMPTS.universal; }
function buildImageUserMessage(p, fields, rawIntent) {
  const lines = Object.entries(fields).filter(([,v]) => v && String(v).trim()).map(([k,v]) => `${k.toUpperCase().replace(/_/g,' ')}: ${v}`).join('\n');
  return `Assemble a ${p.toUpperCase()} image prompt:\n\n${lines}\n\nOriginal intent: ${rawIntent}`;
}
function buildVideoUserMessage(p, fields, rawIntent) {
  const lines = Object.entries(fields).filter(([,v]) => v && String(v).trim()).map(([k,v]) => `${k.toUpperCase().replace(/_/g,' ')}: ${v}`).join('\n');
  return `Assemble a ${p.toUpperCase()} video prompt:\n\n${lines}\n\nOriginal intent: ${rawIntent}`;
}

// ════════════════════════════════════════════════════════════════════════
// POST /api/reformat — forge prompt via SSE streaming
// ════════════════════════════════════════════════════════════════════════
app.post('/api/reformat', async (req, res) => {
  const { rawPrompt, model, style, framework, fields, mode, platform, visualType, outputLang } = req.body;

  if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim())
    return res.status(400).json({ error: 'rawPrompt is required and must be a non-empty string.' });
  if (!model || typeof model !== 'string')
    return res.status(400).json({ error: 'model is required.' });

  let systemPrompt, userMessage;
  if (mode === 'visual' && visualType === 'image') {
    const p = platform || 'universal';
    systemPrompt = addLangInstruction(buildImageSystemPrompt(p), outputLang, true);
    userMessage  = buildImageUserMessage(p, fields || {}, rawPrompt);
  } else if (mode === 'visual' && visualType === 'video') {
    const p = platform || 'universal';
    systemPrompt = addLangInstruction(buildVideoSystemPrompt(p), outputLang, true);
    userMessage  = buildVideoUserMessage(p, fields || {}, rawPrompt);
  } else if (mode === 'structured' && framework && fields && Object.keys(fields).length > 0) {
    systemPrompt = addLangInstruction(assembleFrameworkSystemPrompt(framework, style), outputLang);
    userMessage  = buildUserMessageFromFields(framework, fields, rawPrompt);
  } else {
    const styleGuides = {
      precise: 'Focus on clarity, specificity, and completeness.',
      creative: 'Encourage exploration and imaginative thinking.',
      concise: 'Optimize for brevity.',
      stepbystep: 'Emphasize ordered process and numbered instructions.',
      debug: 'Emphasize diagnostic steps, error context, and environment details.',
    };
    systemPrompt = addLangInstruction(`You are an expert prompt engineer. Rewrite the user's rough request as a single optimized prompt ready to paste into any LLM.
Rules:
- Output ONLY the improved prompt — no preamble, no explanation, no quotes
- Preserve the user's original intent exactly
- Add context, desired output format, tone, and constraints where helpful
- Eliminate vagueness and ambiguity
- Style: ${styleGuides[style] || styleGuides.precise}`, outputLang);
    userMessage = `Rewrite this as an optimized AI prompt:\n\n${rawPrompt}`;
  }

  log('info', `Forge started: mode=${mode || 'quick'} framework=${framework || '–'} model=${model}`, {
    reqId: req.id, mode, framework, model, lang: outputLang,
  });

  // Set SSE headers before the first await so the browser starts receiving
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Helper — write one SSE frame; tolerates a closed client connection
  function sseWrite(payload) {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); }
    catch (_) { /* client disconnected — safe to ignore */ }
  }

  try {
    // Use timeoutMs = 0 for streaming — generation may take several minutes
    const ollamaRes = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: true,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        options:  { temperature: 0.5, top_p: 0.9 },
      }),
    }, 0);

    if (!ollamaRes.ok) {
      const errorBody = await ollamaRes.text().catch(() => '');
      log('error', 'POST /api/reformat: Ollama non-200', {
        reqId: req.id, status: ollamaRes.status, body: errorBody.slice(0, 300),
      });
      sseWrite({ error: `Ollama ${ollamaRes.status}: ${errorBody.slice(0, 200) || ollamaRes.statusText}` });
      return res.end();
    }

    let buffer   = '';
    let tokChars = 0;
    let malformed = 0;

    ollamaRes.body.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete trailing fragment

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.content) { sseWrite({ token: json.message.content }); tokChars += json.message.content.length; }
          if (json.done)              { sseWrite({ done: true }); }
        } catch (parseErr) {
          malformed++;
          // Log the first malformed line per request; suppress subsequent ones to avoid log floods
          if (malformed === 1) {
            log('warn', 'POST /api/reformat: malformed JSON line from Ollama stream', {
              reqId: req.id, error: parseErr.message, line: line.slice(0, 120),
            });
          }
        }
      }
    });

    ollamaRes.body.on('end', () => {
      if (malformed > 1) log('warn', `POST /api/reformat: ${malformed} total malformed stream lines`, { reqId: req.id });
      log('info', `Forge complete: ~${Math.ceil(tokChars / 4)} tokens`, { reqId: req.id, model });
      res.end();
    });

    // Stream-level error (e.g. Ollama killed mid-response)
    ollamaRes.body.on('error', streamErr => {
      const c = classifyError(streamErr, 'reformat stream');
      log('error', c.devMessage, { reqId: req.id, stack: streamErr.stack });
      sseWrite({ error: c.userMessage });
      res.end();
    });

  } catch (err) {
    const c = classifyError(err, 'POST /api/reformat');
    log('error', c.devMessage, { reqId: req.id, model, stack: err.stack });
    sseWrite({ error: c.userMessage });
    try { res.end(); } catch (_) {}
  }
});

// ════════════════════════════════════════════════════════════════════════
// GLOBAL EXPRESS ERROR HANDLER
// Catches errors thrown by route handlers that escaped their try/catch.
// Without this, Express sends an empty 500 with no body or log entry.
// The 4-argument signature is required — Express identifies error
// middleware by arity, not by any naming convention.
// ════════════════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const c = classifyError(err, `${req?.method} ${req?.path}`);
  log('error', `Unhandled Express error: ${c.devMessage}`, {
    reqId: req?.id, path: req?.path, method: req?.method, stack: err.stack,
  });
  if (!res.headersSent) res.status(500).json({ error: c.userMessage, code: c.code });
});

// 404 catch-all — must follow all other routes
app.use((req, res) => {
  log('warn', `404 Not Found: ${req.method} ${req.path}`, { reqId: req.id });
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ════════════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  log('info', 'Prompt Forge v4 started', {
    port: PORT, url: `http://0.0.0.0:${PORT}`,
    ollamaUrl: OLLAMA_URL, dataDir: DATA_DIR,
    logFile: LOG_FILE, serverLog: SERVER_LOG_FILE,
    maxUiLog: MAX_UI_LOG, timeoutMs: OLLAMA_TIMEOUT, bodyLimit: JSON_BODY_LIMIT,
  });
});
