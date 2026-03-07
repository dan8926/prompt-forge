# Prompt Forge v3

A Dockerized AI prompt engineering workstation. Type a rough idea in **Quick mode** for an instant reformat, or switch to **Structured mode** to build a precision prompt using industry frameworks — powered entirely by your local Ollama instance.

---

## Architecture

```
Browser (port 3030)
    │
    ▼
prompt-forge container  (Node 20 Alpine / Express)
    ├── GET  /api/health    → liveness probe
    ├── GET  /api/models    → proxies Ollama /api/tags
    ├── POST /api/analyze   → non-streaming: extracts fields from raw intent
    └── POST /api/reformat  → SSE streaming: Quick | Structured | Visual
          ├── mode: quick             → single-shot reformat
          ├── mode: structured        → text framework assembly
          └── mode: visual
                ├── visualType: image → platform-specific image prompt
                └── visualType: video → platform-specific video prompt
    │
    ▼
Ollama (host or container, port 11434)
```

---

## Prompt Frameworks Supported

### COSTAR — Context · Objective · Style · Tone · Audience · Response Format
Full behavioral control. Ideal for business, technical documentation, instructional, or content prompts where tone and output shape both matter.

### RISEN — Role · Instructions · Steps · End Goal · Narrowing
Agentic, task-driven. Best when you need a clear expert persona plus a scoped, constrained deliverable.

### RTF — Role · Task · Format
Lean and fast. Use when scope is narrow and the output format is well-defined. Best starting point for code generation.

### Chain of Thought (CoT) — Role · Problem · Reasoning Hint · Output Format
Forces the LLM to reason step-by-step before answering. Dramatically improves accuracy on multi-step problems, debugging, and logic tasks.

### Few-Shot — Role · Task · Example Input · Example Output · Format
Shows the model what "good" looks like before asking it to generalize. Essential for consistent tone, classification, or repetitive transformation tasks.

### ReAct — Role · Problem · Available Actions · Output Format
Reasoning + Acting. The LLM alternates `Thought → Action → Observation` loops. Best for agentic, tool-using scenarios.

---

## Modes

### Quick
Raw text → optimized prompt. Five styles: Precise, Step-by-Step, Concise, Creative, Debug.

### Structured — Text Frameworks
| Framework | Best for |
|---|---|
| COSTAR | Business, content, instructional — full behavioral control |
| RISEN | Agentic, task-driven — clear persona + scoped constraints |
| RTF | Lean code generation, narrow-scope tasks |
| Chain of Thought | Complex multi-step reasoning |
| Few-Shot | Consistent output, classification, transformation |
| ReAct | Agentic Thought/Action/Observation loops |

### Visual — Image (6 platforms)
Universal · Midjourney · DALL-E 3 · SD / Auto1111 · Flux · Firefly

### Visual — Video (6 platforms)
Universal · Sora · Runway Gen-3 · Pika · Kling · Luma

---

## Language Selection

An **EN / ES** toggle in the action bar controls output language for all modes and Auto-Fill.

- **EN (default):** All output in English.
- **ES:** All output in Spanish. For Visual modes, platform-specific technical syntax terms (e.g. `--ar`, `--v`, `masterpiece`, `dolly`, `pan`) remain in English because AI image/video generators require them as-is.

The selected language is sent as `outputLang` in every `/api/reformat` and `/api/analyze` request. On the server, `addLangInstruction()` appends a Spanish language directive to the assembled system prompt when `outputLang === 'es'`.

---

## Token Counter

A live counter at the bottom of the output panel shows **approximate tokens** and **characters** as the prompt streams in. Tokens are estimated using the standard ~4 chars/token approximation. Resets to zero when the output is cleared.

---

## Quick Start

```bash
mkdir prompt-forge && cd prompt-forge
# place all files from this document inside
docker compose up -d --build
open http://localhost:3030
```

---

## Connecting to Ollama

Edit `OLLAMA_URL` in `docker-compose.yml`:

| Setup | Value |
|---|---|
| Host machine / Docker Desktop (Mac or Win) | `http://host.docker.internal:11434` *(default)* |
| Linux Docker Engine (host machine) | same + `extra_hosts` already set |
| Ollama in named Docker network | `http://<container-name>:11434` + uncomment `networks:` |
| Remote IP | `http://192.168.x.x:11434` |

---

## File Structure

```
prompt-forge/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── server.js
└── public/
    └── index.html
```

---

## Files

### `docker-compose.yml`
### `Dockerfile`
### `package.json`
> `node-fetch` is pinned to `^2.x` (CommonJS). v3+ is ESM-only — do not upgrade without converting `server.js` to ES module syntax.
### `server.js`
### `public/index.html`

## Code Review Notes

### Language system — `addLangInstruction(systemPrompt, outputLang, isVisual)`
Single helper function on the server. Returns the system prompt unchanged when `outputLang !== 'es'` (zero cost, no branching in callers). When Spanish is requested it appends a directive as the final bullet in the system prompt so it takes highest priority. The `isVisual` flag adds an exception clause preserving English for platform-specific technical syntax keywords — without this, Midjourney `--ar 16:9` or Stable Diffusion `(masterpiece:1.3)` tags would be translated and break the generator.

Wired into all five system prompt assembly points:
- `/api/analyze` (Auto-Fill field values)
- `/api/reformat` quick branch
- `/api/reformat` structured framework branch
- `/api/reformat` visual image branch
- `/api/reformat` visual video branch

### Token counter
`updateTokenCounter(text)` uses `Math.ceil(text.length / 4)` — the standard GPT-family approximation. Called in `startStreaming()` (reset to 0), `appendToken()` (live update every token), `finishStreaming()` (final count), and `clearOutput()` (reset to 0). DOM refs `tokCount` and `charCountOut` are fetched once at init. The counter is displayed in a sticky `.output-footer` bar that sits between `output-scroll` and the action bar, always visible regardless of scroll position.

### `isStreaming` + `isAnalyzing` dual guards
Both `forge()` and `autofill()` check both flags before proceeding and reset their own flag in a `finally` block. Prevents double-forge, forge-during-autofill, autofill-during-streaming, and permanent lock on any network error.

### SSE buffer split
`buffer = lines.pop()` retains any incomplete trailing line across `reader.read()` calls, preventing partial-JSON parse errors when NDJSON boundaries land mid-TCP-chunk.

### XSS safety
All streamed content goes through `outputContent.textContent = currentText` — never `innerHTML`. The blinking cursor `<span>` is created via `createElement`.

### All stream error paths call `res.end()`
Four paths: `!ollamaRes.ok` early return, `body.on('error')`, `body.on('end')`, and the outer `catch` (wrapped in its own try/catch to handle the race where `flushHeaders` hasn't fired yet).

### `node-fetch` v2 pin
Intentional. v3+ is ESM-only and breaks `require('node-fetch')`.
