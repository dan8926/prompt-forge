# Prompt Forge

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
    ├── POST /api/analyze   → non-streaming: extracts framework fields from raw text
    └── POST /api/reformat  → SSE streaming: quick reformat OR structured assembly
    │
    ▼
Ollama (host or container, port 11434)
    └── any pulled model (llama3, mistral, phi3, qwen, etc.)
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

## Workflow

**Quick mode** (default):
1. Type your rough request in the textarea
2. Select an output style (Precise / Step-by-Step / Concise / Creative / Debug)
3. Click **Forge Prompt** or press `Ctrl+Enter`

**Structured mode**:
1. Switch to **Structured** tab
2. Enter your raw intent in the top field
3. Select a framework tab (COSTAR, RISEN, RTF, CoT, Few-Shot, ReAct)
4. Click **Auto-Fill Fields** — the LLM reads your intent and populates the fields
5. Review and edit any field
6. Click **Forge Prompt** — the LLM assembles the final prompt from the fields

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
### `server.js`
### `public/index.html`

## Code Review Notes

### New endpoint: `/api/analyze`
Non-streaming. Sends raw intent + selected framework to Ollama with `stream: false`, requesting a JSON object with the framework's field keys. The response is stripped of potential markdown fences (```` ```json ```` wrappers some models add) before parsing. If JSON parsing fails, a `raw_fallback` string is returned to the client which surfaces a clear error rather than silently failing.

### Dual-guard: `isStreaming` + `isAnalyzing`
Both flags must be false before any LLM call proceeds. The `forge()` function checks `isStreaming || isAnalyzing`, and `autofill()` checks `isAnalyzing || isStreaming`. Both are reset in `finally` blocks so a network error or stream error never leaves the UI permanently locked.

### XSS safety in `appendToken`
All token output uses `outputContent.textContent = currentText` — never `innerHTML`. The cursor span is appended via `createElement`, not string injection. The shimmer loading HTML and placeholder HTML are static strings we control — only the streaming token data goes through `textContent`.

### SSE buffer split
The stream reader retains `buffer = lines.pop()` across `reader.read()` calls to handle NDJSON boundaries that land mid-TCP-chunk. This prevents partial-line parse errors silently corrupting the output.

### All stream error paths close `res.end()`
Four paths in `/api/reformat`: the `!ollamaRes.ok` check, `body.on('error')`, and the outer `catch` (which also wraps its own `res.write`+`res.end` in a try/catch to handle the race where headers haven't been sent yet). No path leaves a connection hanging.

### `node-fetch` v2 pin
Intentional. v3+ is ESM-only. `require('node-fetch')` breaks on v3. Do not upgrade without converting `server.js` to `import` syntax.

### Field shimmer during auto-fill
Fields receive the `analyzing` CSS class during the `/api/analyze` call, which applies a shimmer animation. The class is always removed in both the `try` success path and the `catch` error path, so a failed request never leaves fields permanently grayed out.

### Framework field definitions are frontend-only
`FRAMEWORKS` in `index.html` drives both the UI (field rendering, labels, tips, placeholders) and the payload sent to `/api/reformat`. The backend `frameworkFields` object in `server.js` is used only by `/api/analyze` to instruct the LLM which JSON keys to return. These two objects must stay in sync if frameworks are added or renamed.

### Model note for Auto-Fill
`/api/analyze` uses `stream: false` and requests raw JSON output. Smaller models (e.g. `phi3:mini`, `gemma:2b`) sometimes ignore the JSON-only instruction and wrap output in prose or markdown. The markdown fence stripper catches the most common case. For best results, use a 7B+ instruction-following model (e.g. `llama3`, `mistral`, `qwen2.5`).
