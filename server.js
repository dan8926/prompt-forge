const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3030;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ollama: OLLAMA_URL });
});

// ── List Ollama models ────────────────────────────────────────────────────────
app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) throw new Error(`Ollama responded with ${response.status}`);
    const data = await response.json();
    const models = (data.models || []).map(m => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at
    }));
    res.json({ models });
  } catch (err) {
    console.error('Error fetching models:', err.message);
    res.status(502).json({ error: `Cannot reach Ollama at ${OLLAMA_URL}: ${err.message}` });
  }
});

// ── Analyze raw input → suggest structured field values (JSON, non-streaming) ─
app.post('/api/analyze', async (req, res) => {
  const { rawPrompt, framework, model } = req.body;
  if (!rawPrompt || !model) {
    return res.status(400).json({ error: 'rawPrompt and model are required' });
  }

  const frameworkFields = {
    costar:  ['context', 'objective', 'style', 'tone', 'audience', 'response_format'],
    risen:   ['role', 'instructions', 'steps', 'end_goal', 'narrowing'],
    rtf:     ['role', 'task', 'format'],
    cot:     ['role', 'problem', 'reasoning_hint', 'output_format'],
    fewshot: ['role', 'task', 'example_input', 'example_output', 'format'],
    react:   ['role', 'problem', 'available_actions', 'output_format']
  };

  const fields = frameworkFields[framework] || frameworkFields.costar;

  const systemPrompt = `You are a prompt engineering expert. Given a rough user request, extract and infer the best values for each field of the ${framework.toUpperCase()} prompt framework. Return ONLY a valid JSON object with these exact keys: ${fields.join(', ')}.

Rules:
- Infer missing context intelligently from the user's intent
- Keep each value concise but complete (1-3 sentences max per field)
- If a field truly cannot be inferred, use an empty string ""
- Do not include any explanation, preamble, or markdown fences — output raw JSON only`;

  const userMessage = `Extract ${framework.toUpperCase()} framework fields from this rough request:\n\n${rawPrompt}`;

  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        options: { temperature: 0.3, top_p: 0.9 }
      })
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text();
      return res.status(502).json({ error: errText });
    }

    const data = await ollamaRes.json();
    const raw = (data.message?.content || '').trim();

    // Strip markdown fences if model still wraps output
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      res.json({ fields: parsed });
    } catch {
      res.json({ fields: {}, raw_fallback: cleaned });
    }

  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Build system prompt per framework ────────────────────────────────────────
function assembleFrameworkSystemPrompt(framework, style) {
  const styleGuides = {
    precise:    'The user wants a technically precise, detailed answer. Emphasize clarity, specificity, and completeness.',
    creative:   'The user wants a creative, open-ended response. Encourage exploration and imaginative thinking.',
    concise:    'The user wants a short, direct answer. Optimize for brevity — strip all fluff.',
    stepbystep: 'The user wants a structured, step-by-step walkthrough. Emphasize ordered process and numbered instructions.',
    debug:      'The user is troubleshooting a technical problem. Emphasize diagnostic steps, error context, and environment details.'
  };

  const styleHint = styleGuides[style] || styleGuides.precise;

  const descriptions = {
    costar: `COSTAR Framework (Context · Objective · Style · Tone · Audience · Response Format)
Use all six components to build a complete, business-grade prompt.`,
    risen:  `RISEN Framework (Role · Instructions · Steps · End Goal · Narrowing)
Build an agentic, task-focused prompt with a clear persona and scoped constraints.`,
    rtf:    `RTF Framework (Role · Task · Format)
Build a lean, direct prompt: who the LLM is, what to do, and how to return it.`,
    cot:    `Chain of Thought Framework (Role · Problem · Reasoning Hint · Output Format)
Build a prompt that instructs the LLM to reason step by step before answering.`,
    fewshot:`Few-Shot Framework (Role · Task · Example Input/Output · Format)
Build a prompt with worked examples that demonstrate the desired output pattern.`,
    react:  `ReAct Framework — Reasoning + Acting (Role · Problem · Available Actions · Output Format)
Build an agentic prompt where the LLM alternates between reasoning and invoking actions.`
  };

  return `You are a master prompt engineer. Your sole job is to take structured prompt components and assemble them into a single, polished, immediately usable prompt using the ${framework.toUpperCase()} framework.

Framework: ${descriptions[framework] || descriptions.costar}

Assembly rules:
- Output ONLY the assembled final prompt — no meta-commentary, no explanation
- Do not answer the user's question — produce the prompt someone pastes into an LLM
- The prompt must be self-contained and complete; anyone should be able to paste it directly
- Weave the components into natural, readable prose — avoid raw "KEY: value" lists unless the framework genuinely calls for labeled sections
- Include all non-empty fields; omit empty ones gracefully
- Style guidance: ${styleHint}`;
}

function buildUserMessageFromFields(framework, fields, rawPrompt) {
  const fieldLines = Object.entries(fields)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k.toUpperCase().replace(/_/g, ' ')}: ${v}`)
    .join('\n');

  return `Assemble a complete ${framework.toUpperCase()} prompt using these components:\n\n${fieldLines}\n\nOriginal raw request (for reference only): ${rawPrompt}`;
}

// ── Stream-reformat / assemble prompt (SSE) ───────────────────────────────────
app.post('/api/reformat', async (req, res) => {
  const { rawPrompt, model, style, framework, fields, mode } = req.body;

  if (!rawPrompt || !model) {
    return res.status(400).json({ error: 'rawPrompt and model are required' });
  }

  let systemPrompt, userMessage;

  if (mode === 'structured' && framework && fields && Object.keys(fields).length > 0) {
    // Structured mode: assemble from framework fields
    systemPrompt = assembleFrameworkSystemPrompt(framework, style);
    userMessage  = buildUserMessageFromFields(framework, fields, rawPrompt);
  } else {
    // Quick mode: classic single-shot reformat
    const styleGuides = {
      precise:    'The user wants a technically precise, detailed answer. Focus on clarity, specificity, and completeness.',
      creative:   'The user wants a creative, open-ended response. Encourage exploration and imaginative thinking.',
      concise:    'The user wants a short, direct answer. Strip all fluff and optimize for brevity.',
      stepbystep: 'The user wants a structured, step-by-step walkthrough. Emphasize process and ordered instructions.',
      debug:      'The user is troubleshooting a technical problem. Emphasize diagnostic steps, error context, and environment details.'
    };

    const styleHint = styleGuides[style] || styleGuides.precise;

    systemPrompt = `You are an expert prompt engineer. Your sole job is to take a user's rough, incomplete, or ambiguous request and rewrite it as a single, optimized prompt they can paste directly into any AI chat interface to get a better response.

Rules:
- Output ONLY the improved prompt — no preamble, no explanation, no quotes around it, no markdown formatting around the whole output
- Do not answer the question — only rewrite it as a better prompt
- Preserve the user's original intent exactly
- Add context clues, desired output format, tone, and constraints where helpful
- Eliminate vagueness and ambiguity
- If the input mentions code, specify language/framework/version if inferable
- If the input mentions a task, clarify expected output format
- Style guidance: ${styleHint}`;

    userMessage = `Rewrite this rough request as an optimized AI prompt:\n\n${rawPrompt}`;
  }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        options: { temperature: 0.4, top_p: 0.9 }
      })
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text();
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
      return res.end();
    }

    ollamaRes.body.on('data', chunk => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            res.write(`data: ${JSON.stringify({ token: json.message.content })}\n\n`);
          }
          if (json.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch (_) {}
      }
    });

    ollamaRes.body.on('end', () => res.end());
    ollamaRes.body.on('error', err => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('Reformat error:', err.message);
    try {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } catch (_) {}
  }
});

app.listen(PORT, () => {
  console.log(`Prompt Forge running on http://0.0.0.0:${PORT}`);
  console.log(`Ollama endpoint: ${OLLAMA_URL}`);
});