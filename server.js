const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app        = express();
const PORT       = process.env.PORT || 3030;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';

// ── Persistent log setup ───────────────────────────────────────────────
const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, 'data');
const LOG_FILE  = path.join(DATA_DIR, 'logs.jsonl');
const MAX_LOG_ENTRIES = 2000;

// Ensure data directory exists on startup
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error('Could not create data dir:', e.message);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ollama: OLLAMA_URL, version: '4.0.0', logFile: LOG_FILE });
});

// ── GET /api/logs  — return stored log entries (newest first) ──────────
app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json({ entries: [] });
    const raw     = fs.readFileSync(LOG_FILE, 'utf8').trim();
    if (!raw) return res.json({ entries: [] });
    const entries = raw.split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .reverse();                       // newest first for UI
    res.json({ entries });
  } catch (err) {
    console.error('GET /api/logs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/logs  — append one or more entries ──────────────────────
app.post('/api/logs', (req, res) => {
  try {
    const entries = Array.isArray(req.body) ? req.body : [req.body];
    const lines   = entries
      .filter(e => e && e.level && e.message)
      .map(e => JSON.stringify({ ts: e.ts || new Date().toISOString(), level: e.level, message: e.message }))
      .join('\n');
    if (!lines) return res.json({ ok: true, written: 0 });

    fs.appendFileSync(LOG_FILE, lines + '\n', 'utf8');

    // Rolling trim: keep at most MAX_LOG_ENTRIES lines
    try {
      const content = fs.readFileSync(LOG_FILE, 'utf8').trim();
      const allLines = content.split('\n').filter(Boolean);
      if (allLines.length > MAX_LOG_ENTRIES) {
        const trimmed = allLines.slice(allLines.length - MAX_LOG_ENTRIES);
        fs.writeFileSync(LOG_FILE, trimmed.join('\n') + '\n', 'utf8');
      }
    } catch (_) {}

    res.json({ ok: true, written: entries.length });
  } catch (err) {
    console.error('POST /api/logs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/logs  — clear log file ────────────────────────────────
app.delete('/api/logs', (req, res) => {
  try {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/logs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) throw new Error(`Ollama responded with ${response.status}`);
    const data   = await response.json();
    const models = (data.models || []).map(m => ({ name: m.name, size: m.size, modified: m.modified_at }));
    res.json({ models });
  } catch (err) {
    console.error('Error fetching models:', err.message);
    res.status(502).json({ error: `Cannot reach Ollama at ${OLLAMA_URL}: ${err.message}` });
  }
});

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
  visual_video: ['scene', 'subject_motion', 'camera_movement', 'shot_type', 'lighting', 'mood_style', 'audio_cue', 'duration_pacing']
};

function addLangInstruction(systemPrompt, outputLang, isVisual = false) {
  if (outputLang !== 'es') return systemPrompt;
  const visualNote = isVisual
    ? ' Exception: keep all platform-specific technical syntax terms in English (e.g. --ar, --v, masterpiece, dolly, pan, zoom) as these are required keywords for AI generators.'
    : '';
  return systemPrompt + `\n\n- LANGUAGE REQUIREMENT: Write your entire response in Spanish (Español). Every word of the output must be in Spanish.${visualNote}`;
}

app.post('/api/analyze', async (req, res) => {
  const { rawPrompt, framework, model, outputLang } = req.body;
  if (!rawPrompt || !model) return res.status(400).json({ error: 'rawPrompt and model are required' });

  const fields   = FIELD_KEYS[framework] || FIELD_KEYS.costar;
  const isVisual = framework.startsWith('visual_');
  const hint     = isVisual ? 'You are an expert AI art director and visual prompt engineer.' : 'You are a prompt engineering expert.';

  const base = `${hint} Given a rough user request, extract and infer the best values for each field. Return ONLY a valid JSON object with these exact keys: ${fields.join(', ')}.
Rules:
- Infer missing context intelligently from the user's intent
- Keep each value concise but complete (1-3 sentences max, or comma-separated tags for visual fields)
- Use empty string "" for fields that cannot be reasonably inferred
- No explanation, preamble, or markdown fences — raw JSON only`;

  const systemPrompt = addLangInstruction(base, outputLang, isVisual);
  const userMessage  = `Extract fields from this rough request (framework: ${framework}):\n\n${rawPrompt}`;

  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], options: { temperature: 0.3, top_p: 0.9 } })
    });
    if (!ollamaRes.ok) { const e = await ollamaRes.text(); return res.status(502).json({ error: e }); }
    const data    = await ollamaRes.json();
    const raw     = (data.message?.content || '').trim();
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
    try { res.json({ fields: JSON.parse(cleaned) }); } catch { res.json({ fields: {}, raw_fallback: cleaned }); }
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

function assembleFrameworkSystemPrompt(framework, style) {
  const styleGuides = {
    precise:    'Emphasize clarity, specificity, and technical completeness.',
    creative:   'Encourage exploration, imagination, and open-ended thinking.',
    concise:    'Optimize for brevity — every word must earn its place.',
    stepbystep: 'Emphasize ordered process and numbered, explicit instructions.',
    debug:      'Emphasize diagnostic steps, error context, and environment details.'
  };
  const styleHint = styleGuides[style] || styleGuides.precise;

  const descriptions = {
    costar:  'COSTAR (Context · Objective · Style · Tone · Audience · Response Format) — treats prompt writing as a full-stack design challenge, enabling tailored responses based on context and communication style.',
    risen:   'RISEN (Role · Input · Scenario · Expectation · Nuance) — designed for complex projects, promoting multi-perspective analysis and nuanced, deeply contextual responses.',
    rtf:     'RTF (Role · Task · Format) — lean and direct; best for narrow-scope, well-defined output tasks.',
    crispe:  'CRISPE (Capacity/Role · Insight · Statement · Personality · Experiment) — ideal for creating distinct AI personas and supporting iterative, exploratory workflows.',
    race:    'RACE (Role · Action · Tactic · Expectation) — a simple four-part structure optimized for daily tasks, emails, and high-volume repetitive work.',
    care:    'CARE (Context · Action · Result · Example) — focuses on demonstrating success through concrete, actionable examples within the prompt.',
    cot:     'Chain of Thought (Role · Problem · Reasoning Hint · Output Format) — encourages step-by-step logical reasoning and breakdown of complex problems before answering.',
    tot:     'Tree of Thoughts (Role · Problem · Thought Paths · Evaluation Criteria · Output Format) — expands CoT with parallel reasoning branches to evaluate multiple solutions and identify optimal outcomes.',
    react:   'ReAct (Role · Problem · Available Actions · Output Format) — integrates reasoning and action loops, ideal for AI agents interacting with external tools or data sources.',
    ape:     'APE (Action · Purpose · Expectation) — for rapid, focused tasks requiring precise, directive instructions with a clear outcome.',
    five_s:  'Five S Model (Set the Scene · Specify Task · Simplify Language · Structure Response · Share Feedback) — prioritizes teachability and rapid iteration in educational or enterprise settings.',
    fewshot: 'Few-Shot (Role · Task · Example Input/Output · Format) — demonstrates desired behavior with worked examples to establish consistent tone and output patterns.'
  };

  return `You are a master prompt engineer. Assemble the provided structured components into a single, polished, immediately usable LLM prompt using the ${framework.toUpperCase()} framework.

Framework: ${descriptions[framework] || descriptions.costar}

Assembly rules:
- Output ONLY the assembled final prompt — no explanation, no meta-commentary
- The prompt must be self-contained; anyone can paste it directly into any LLM
- Weave components into natural prose — avoid raw KEY: value lists unless the framework demands labeled sections
- Include all non-empty fields; omit empty ones gracefully
- Style guidance: ${styleHint}`;
}

function buildUserMessageFromFields(framework, fields, rawPrompt) {
  const fieldLines = Object.entries(fields)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k.toUpperCase().replace(/_/g, ' ')}: ${v}`)
    .join('\n');
  return `Assemble a complete ${framework.toUpperCase()} prompt from these components:\n\n${fieldLines}\n\nOriginal raw request (reference only): ${rawPrompt}`;
}

const IMAGE_PLATFORM_PROMPTS = {
  midjourney: `You are a Midjourney v6 prompt expert.
- Write vivid, comma-separated natural language (subject, setting, style, lighting, camera, mood)
- Include strong quality descriptors: highly detailed, intricate, masterpiece, sharp focus
- Append parameters at end: --ar [ratio] --style raw --v 6.1; default --ar 16:9 or --ar 1:1
- Use --no flag for negative prompt content
- Output ONLY the final Midjourney prompt — nothing else`,

  dalle3: `You are a DALL-E 3 prompt expert.
- Write complete, descriptive natural language sentences
- Explicitly state the style: "a digital painting", "a photograph", "an oil painting"
- No parameter syntax
- Output ONLY the final DALL-E 3 prompt — nothing else`,

  stablediffusion: `You are a Stable Diffusion / Auto1111 prompt expert.
- Format as comma-separated descriptive tags; use emphasis: (masterpiece:1.3), (highly detailed:1.2)
- Start with quality boosters: masterpiece, best quality, ultra detailed, 8k uhd
- Write on a new line: Negative prompt: [negative_prompt field + defaults: blurry, deformed, ugly, bad anatomy, watermark]
- Output ONLY positive prompt then "Negative prompt: ..." — nothing else`,

  flux: `You are a Flux.1 (Black Forest Labs) prompt expert.
- Write clear descriptive sentences — Flux understands natural language well
- Include quality terms: highly detailed, professional photography, 8K resolution
- State the medium explicitly; include negative prompt on a new line if provided
- Output ONLY the final Flux prompt — nothing else`,

  firefly: `You are an Adobe Firefly prompt expert.
- Write in clear descriptive natural language
- Copyright-safe: no specific living artists or brands — use style descriptors instead
- Output ONLY the final Firefly prompt — nothing else`,

  universal: `You are a universal AI image prompt expert.
- Structure: [subject + action] [environment] [art style + medium] [lighting] [camera/composition] [mood] [quality]
- Use universally understood photography and art terms
- Output ONLY the final image prompt — nothing else`
};

function buildImageSystemPrompt(p) { return IMAGE_PLATFORM_PROMPTS[p] || IMAGE_PLATFORM_PROMPTS.universal; }
function buildImageUserMessage(p, fields, rawIntent) {
  const lines = Object.entries(fields).filter(([,v]) => v && String(v).trim()).map(([k,v]) => `${k.toUpperCase().replace(/_/g,' ')}: ${v}`).join('\n');
  return `Assemble a ${p.toUpperCase()} image prompt:\n\n${lines}\n\nOriginal intent: ${rawIntent}`;
}

const VIDEO_PLATFORM_PROMPTS = {
  sora:      `You are an OpenAI Sora video prompt expert. Write highly detailed cinematic scene descriptions. Always specify camera behavior and subject motion precisely. Output ONLY the final prompt paragraph — nothing else`,
  runway:    `You are a Runway Gen-3 Alpha video prompt expert. Keep concise and action-focused (100-300 words). Camera motion must be explicit. Output ONLY the final Runway prompt — nothing else`,
  pika:      `You are a Pika video prompt expert. Write clear, action-driven descriptions: [subject] [action] [setting] [camera motion] [visual style]. Output ONLY the final Pika prompt — nothing else`,
  kling:     `You are a Kling AI video prompt expert. Detailed descriptive natural language; specify subject movement precisely; use standard film terminology. Output ONLY the final Kling prompt — nothing else`,
  luma:      `You are a Luma Dream Machine video prompt expert. Emphasize visual fidelity, lead with scene-setting, describe lighting in detail. Output ONLY the final Luma prompt — nothing else`,
  universal: `You are a universal AI video prompt expert. Structure: [scene intro] [subject] [action] [camera movement] [lighting] [visual style]. Always specify camera motion. Output ONLY the final video prompt — nothing else`
};

function buildVideoSystemPrompt(p) { return VIDEO_PLATFORM_PROMPTS[p] || VIDEO_PLATFORM_PROMPTS.universal; }
function buildVideoUserMessage(p, fields, rawIntent) {
  const lines = Object.entries(fields).filter(([,v]) => v && String(v).trim()).map(([k,v]) => `${k.toUpperCase().replace(/_/g,' ')}: ${v}`).join('\n');
  return `Assemble a ${p.toUpperCase()} video prompt:\n\n${lines}\n\nOriginal intent: ${rawIntent}`;
}

app.post('/api/reformat', async (req, res) => {
  const { rawPrompt, model, style, framework, fields, mode, platform, visualType, outputLang } = req.body;
  if (!rawPrompt || !model) return res.status(400).json({ error: 'rawPrompt and model are required' });

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
    const styleGuides = { precise: 'Focus on clarity, specificity, and completeness.', creative: 'Encourage exploration and imaginative thinking.', concise: 'Optimize for brevity.', stepbystep: 'Emphasize ordered process and numbered instructions.', debug: 'Emphasize diagnostic steps, error context, and environment details.' };
    systemPrompt = addLangInstruction(`You are an expert prompt engineer. Rewrite the user's rough request as a single optimized prompt ready to paste into any LLM.
Rules:
- Output ONLY the improved prompt — no preamble, no explanation, no quotes
- Preserve the user's original intent exactly
- Add context, desired output format, tone, and constraints where helpful
- Eliminate vagueness and ambiguity
- Style: ${styleGuides[style] || styleGuides.precise}`, outputLang);
    userMessage = `Rewrite this as an optimized AI prompt:\n\n${rawPrompt}`;
  }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], options: { temperature: 0.5, top_p: 0.9 } })
    });

    if (!ollamaRes.ok) {
      const e = await ollamaRes.text();
      res.write(`data: ${JSON.stringify({ error: e })}\n\n`);
      return res.end();
    }

    let buffer = '';
    ollamaRes.body.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.content) res.write(`data: ${JSON.stringify({ token: json.message.content })}\n\n`);
          if (json.done) res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        } catch (_) {}
      }
    });
    ollamaRes.body.on('end', () => res.end());
    ollamaRes.body.on('error', err => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });

  } catch (err) {
    console.error('Reformat error:', err.message);
    try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); } catch (_) {}
  }
});

app.listen(PORT, () => {
  console.log(`Prompt Forge v4.1 running on http://0.0.0.0:${PORT}`);
  console.log(`Ollama endpoint: ${OLLAMA_URL}`);
});
