<h1 style="text-align: center;">PromptForge</h1>

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![Node](https://img.shields.io/badge/node-20--alpine-339933?logo=node.js&logoColor=white)
![Ollama](https://img.shields.io/badge/powered%20by-Ollama-black)
![Version|90](https://img.shields.io/badge/version-4.1.2-brightgreen)

> **A self-hosted AI prompt engineering workstation that runs entirely on your local network and use your [Ollama](https://ollama.com) instance.**  
> No cloud APIs. No API keys. No subscriptions. One `docker compose up` and you're live.   

---

## Screenshot
<img width="1659" height="1018" alt="image" src="https://github.com/user-attachments/assets/0ebeb241-6b46-44e7-a58e-9488e0a02a9e" />

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage Guide](#usage-guide)
  - [Quick Mode](#quick-mode)
  - [Structured Mode](#structured-mode)
  - [Visual Mode](#visual-mode)
  - [Token History](#token-history)
  - [Event Log](#event-log)
  - [Clear Text Button](#clear-text-button)
  - [Language Toggle](#language-toggle)
  - [Theme Toggle](#theme-toggle)
- [Prompt Frameworks Reference](#prompt-frameworks-reference)
- [Visual Platforms Reference](#visual-platforms-reference)
- [API Reference](#api-reference)
- [Design System](#design-system)
- [Project Structure](#project-structure)
- [Source Files](#source-files)
  - [package.json](#packagejson)
  - [Dockerfile](#dockerfile)
  - [docker-compose.yml](#docker-composeyml)
  - [server.js](#serverjs)
  - [public/index.html](#publicindexhtml)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**PromptForge** is a browser-based prompt engineering tool that runs entirely on your own hardware. It connects to a local [Ollama](https://ollama.com) instance and uses whichever LLM you have pulled — no data leaves your machine.

Three forge modes are available:

| Mode | What it does |
|---|---|
| **⚡ Quick** | Rewrites rough text into an optimised, immediately usable LLM prompt in seconds |
| **⊞ Structured** | Builds prompts field-by-field using 12 professional prompt frameworks, with AI Auto-Fill |
| **◈ Visual** | Generates platform-specific prompts for 6 image AI tools and 6 video AI tools |

All forge activity is written to a persistent `logs.jsonl` file inside a Docker named volume, surviving container restarts and full image rebuilds.

---

## Features

### Forge Capabilities
- **Quick Mode** — five output styles: Precise, Step-by-Step, Concise, Creative, Debug
- **Structured Mode** — 12 prompt frameworks across four categories, AI-powered Auto-Fill from raw intent
- **Visual Mode** — Image (Midjourney, DALL-E 3, Stable Diffusion, Flux, Firefly, Universal) and Video (Sora, Runway, Pika, Kling, Luma, Universal) prompt generation
- **Bilingual output** — EN / ES toggle applied globally including Auto-Fill field values
- **Live streaming** — tokens stream to the browser in real time via Server-Sent Events
- **`*-instruct` auto-select** — automatically picks the first instruct-tuned model from Ollama on load

### Input Controls
- **Clear Text button** — dedicated one-click erase for the Quick mode prompt textarea
- **Auto-Fill** — populates all structured framework fields from a raw intent sentence
- **Keyboard shortcut** — `Ctrl+Enter` / `Cmd+Enter` forges from any input field

### Observability
- **Token History drawer** — sortable table of every forge operation (model, mode, framework, tokens, chars, language, duration)
- **Event Log drawer** — real-time log of all system events with INFO / SUCCESS / WARN / ERROR levels
- **Persistent logs** — event log written to `/data/logs.jsonl` in the container, mounted on a Docker named volume
- **Session vs. history** — persisted entries render at reduced opacity to distinguish prior sessions

### UI / UX
- **Dark and Light mode** — toggleable, preference saved to `localStorage`
- **Glassmorphism design** — frosted glass surfaces, animated ambient gradient orbs, three-level depth hierarchy
- **Fully responsive** — stacked mobile layout, 44 px touch targets, safe-area insets for notched phones
- **Cross-browser clipboard** — `navigator.clipboard` with `execCommand` + iOS `Range` fallback chain

---

## Architecture

```
Browser  (http://localhost:3030)
        │
        ▼
┌──────────────────────────────────────────────┐
│  prompt-forge  (Node 20 Alpine / Express)    │
│                                              │
│  GET  /api/health     liveness check         │
│  GET  /api/models     proxy Ollama tags      │
│  POST /api/analyze    field extraction (JSON)│  ──▶  Ollama /api/chat
│  POST /api/reformat   prompt forge   (SSE)   │  ──▶  Ollama /api/chat
│  GET  /api/logs       read JSONL             │
│  POST /api/logs       append JSONL           │
│  DELETE /api/logs     truncate               │
│                                              │
│  /data/logs.jsonl  ◀── Docker named volume   │
└──────────────────────────────────────────────┘
        │
        ▼
Ollama  (host or container, port 11434)
```

**Why SSE instead of WebSockets?**  
SSE is unidirectional server→browser, perfectly matching the streaming use case. It requires no handshake, works over plain HTTP/1.1, and reconnects automatically. No extra library needed.

**Why JSONL for persistent logs?**  
Each line is an independent JSON object. `fs.appendFileSync` never needs to read or parse the existing file — it just appends. A rolling trim after every write keeps the file under 2,000 lines without unbounded growth.

---

## Quick Start

```bash
# 1. Make sure Ollama is running and has at least one model
ollama pull llama3.2

# 2. Clone the repo
git clone https://github.com/your-username/prompt-forge.git
cd prompt-forge

# 3. Start
docker compose up -d --build

# 4. Open
open http://localhost:3030
```

> **Linux users:** `host.docker.internal` is resolved via the `extra_hosts` entry already in `docker-compose.yml` — no changes needed.

---

## Installation

### Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Docker | 24 | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| Docker Compose | V2 (plugin) | Included with Docker Desktop |
| Ollama | Latest | [ollama.com/download](https://ollama.com/download) |
| A pulled Ollama model | Any | `ollama pull llama3.2` recommended |

### Recommended Models

PromptForge auto-selects the first `*-instruct` model on startup. Instruction-tuned models produce significantly better Auto-Fill JSON extraction:

```bash
ollama pull llama3.2          # 3 B — fast, good quality
ollama pull llama3.1:8b       # 8 B — best quality / speed balance
ollama pull mistral           # 7 B — strong instruction following
ollama pull qwen2.5:7b        # 7 B — excellent JSON output
ollama pull gemma3:9b         # 9 B — strong reasoning
```

### Build and Run

```bash
# Background (recommended)
docker compose up -d --build

# Foreground with live logs
docker compose up --build

# View logs after starting in background
docker compose logs -f prompt-forge

# Stop (keeps the log volume)
docker compose down

# Stop and delete the log volume
docker compose down -v
```

### Verify Installation

```bash
curl http://localhost:3030/api/health
```

Expected response:
```json
{
  "status": "ok",
  "ollama": "http://host.docker.internal:11434",
  "version": "4.1.2",
  "logFile": "/data/logs.jsonl"
}
```

---

## Configuration

All configuration is via environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama endpoint |
| `PORT` | `3030` | HTTP port the Express server listens on |
| `DATA_DIR` | `/data` | Path inside container for `logs.jsonl` |

### Ollama Connection Options

```yaml
# Docker Desktop (macOS / Windows) — default
OLLAMA_URL: "http://host.docker.internal:11434"

# Linux Docker Engine — same value, extra_hosts entry handles resolution
OLLAMA_URL: "http://host.docker.internal:11434"

# Ollama in a named Docker container on a shared network
OLLAMA_URL: "http://ollama:11434"
# also uncomment the networks: block in docker-compose.yml

# Remote machine
OLLAMA_URL: "http://192.168.1.100:11434"
```

### Change the Host Port

```yaml
ports:
  - "8080:3030"   # map host 8080 → container 3030
```

---

## Usage Guide

### Quick Mode

The fastest path from rough idea to usable prompt.

1. Type your rough request in **Your Prompt**
2. Optionally click **✕ Clear Text** to erase and start over
3. Select an **Output Style**:

| Style | Best for |
|---|---|
| **Precise** | Technical tasks, code, analysis |
| **Step-by-Step** | Processes, tutorials, walkthroughs |
| **Concise** | Summaries, one-liners, brevity-critical tasks |
| **Creative** | Brainstorming, writing, open-ended exploration |
| **Debug** | Error diagnosis, troubleshooting, root cause analysis |

4. Press **Forge Prompt** or `Ctrl+Enter`

**Example:**

> Input: `write something that helps me review pull requests better`
>
> Forged output: *You are a senior software engineer conducting a thorough code review. I will provide you with a pull request diff. Your task is to: (1) identify logic errors, edge cases, and security vulnerabilities; (2) flag style and naming inconsistencies relative to the surrounding codebase; (3) suggest concrete improvements with inline code examples; (4) rate overall PR readiness as Approve / Request Changes / Needs Discussion. Format your response with separate sections for each category, ordered by severity.*

---

### Structured Mode

Build prompts using 12 professional frameworks with optional AI Auto-Fill.

1. Enter a rough **Raw Intent** sentence
2. Select a **Framework** from the grouped dropdown
3. Click **Auto-Fill** — the model extracts intelligent field values from your intent
4. Review, edit, and add nuance to any field
5. Press **Forge Prompt**

> **Tip:** Auto-Fill works best with 7 B+ instruct-tuned models. Smaller models often produce empty fields or malformed JSON.

---

### Visual Mode

Generate platform-specific prompts for AI image and video generators.

1. Select **Image** or **Video** at the top of the panel
2. Choose the target **Platform**
3. Enter your **Raw Intent**
4. Click **Auto-Fill** to populate the visual fields, or fill them manually
5. Press **Forge Prompt**

Platform-specific syntax (Midjourney `--ar` flags, Stable Diffusion weight notation, DALL-E 3 medium prefixes, etc.) is applied automatically by the server.

---

### Token History

Click **⧖** in the header to open the sortable Token History drawer.

Each row records: operation number · timestamp · model · mode · framework/platform · estimated tokens · character count · language · round-trip duration (ms).

Click any column header to sort. Click **Clear all** to wipe the in-memory session history (does not affect the persistent event log).

---

### Event Log

Click **▦** in the header to open the Event Log drawer.

| Level | Colour | Examples |
|---|---|---|
| `INFO` | Cyan | Model selected, mode changed, theme toggled, input cleared |
| `SUCCESS` | Green | Forge complete, models loaded, Auto-Fill finished |
| `WARN` | Amber | Clipboard API blocked, Auto-Fill fallback used |
| `ERROR` | Red | Ollama unreachable, stream error, forge failed |

Entries from previous sessions load automatically on page open and render at 65 % opacity. Clicking **Clear** in the drawer deletes both the in-memory log and the `logs.jsonl` file via `DELETE /api/logs`.

---

### Clear Text Button

A **✕ Clear Text** button sits inline with the character counter below the Quick mode textarea. It clears only the prompt input and returns focus to the textarea — no other panels, fields, or output are affected.

The global **Clear** button in the command bar continues to reset everything: all mode inputs, all framework fields, and the output panel.

---

### Language Toggle

Press **EN** or **ES** in the command bar before forging. All output — including Auto-Fill extracted field values — will be written in the selected language.

**Visual exception:** Technical syntax keywords (`--ar`, `--v`, `masterpiece`, `dolly`, `pan`, `zoom`) remain in English regardless of language selection, as these are required literals for AI generators.

---

### Theme Toggle

Click **☀** / **☾** in the header to switch between dark and light mode. Preference is saved to `localStorage` and applied synchronously before first render — no flash on reload.

---

## Prompt Frameworks Reference

### Classic Frameworks

#### COSTAR — Context · Objective · Style · Tone · Audience · Response Format

Full-stack prompt design. Controls not just *what* to produce, but *how* to communicate, *to whom*, and *in what format*.

| Field | Purpose |
|---|---|
| Context | Background the model needs to understand the situation |
| Objective | The specific deliverable or goal |
| Style | Writing or communication style |
| Tone | Emotional register |
| Audience | Who will read or use the output |
| Response Format | Structure, length, or schema of the final response |

**Best for:** Stakeholder reports, business communications, instructional design, content creation with a defined audience.

---

#### RISEN — Role · Input · Scenario · Expectation · Nuance

Handles complex, contextual tasks where edge cases and constraints matter as much as the core request.

| Field | Purpose |
|---|---|
| Role | Expert persona the model should adopt |
| Input | Raw material or data being worked with |
| Scenario | Situation, constraints, and background |
| Expectation | The desired outcome and deliverable |
| Nuance | Subtleties, caveats, or non-obvious requirements |

**Best for:** API migration guides, architectural decisions, complex technical documentation.

---

#### RTF — Role · Task · Format

The leanest effective framework. Use when scope is narrow, well-defined, and every word counts.

**Best for:** Code reviews, data transformations, focused single-output tasks.

---

### Persona & Structure Frameworks

#### CRISPE — Capacity/Role · Insight · Statement · Personality · Experiment

Creates distinct AI personas and supports iterative workflows. The **Experiment** field requests two competing approaches for comparison.

**Best for:** Performance tuning trade-offs, comparative proposals, SRE incident analysis.

---

#### RACE — Role · Action · Tactic · Expectation

Four-part structure optimised for speed and repeatability in high-volume communication tasks.

**Best for:** Social media copy, marketing emails, product announcements.

---

#### CARE — Context · Action · Result · Example

Anchors the prompt to a concrete reference example, setting the quality bar implicitly through demonstration.

**Best for:** Developer documentation modelled on high-quality references (Stripe, Twilio style), onboarding guides.

---

### Reasoning Frameworks

#### Chain of Thought — Role · Problem · Reasoning Hint · Output Format

Instructs the model to reason step-by-step before answering. Leave **Reasoning Hint** blank for default CoT behaviour.

**Best for:** Query optimisation, root cause analysis, multi-step diagnostics.

---

#### Tree of Thoughts — Role · Problem · Thought Paths · Evaluation Criteria · Output Format

Expands CoT with parallel reasoning branches. Define 2–4 solution paths in **Thought Paths** and scoring rules in **Evaluation Criteria**.

**Best for:** Technology selection, architectural trade-off analysis, buy-vs-build decisions.

---

#### ReAct — Role · Problem · Available Actions · Output Format

Integrates reasoning and action loops (Thought / Action / Observation). Ideal for AI agent simulations.

**Best for:** Multi-step research tasks, competitive intelligence, tool-calling simulations.

---

### Focused Frameworks

#### APE — Action · Purpose · Expectation

Maximum directness. Do this, because of this, outputting this. No persona scaffolding.

**Best for:** Code generation, data transformations, rapid single-output tasks.

---

#### Five S Model — Set the Scene · Specify Task · Simplify Language · Structure Response · Share Feedback

Prioritises teachability and rapid iteration. **Share Feedback** instructs the model to include reflection and common mistakes.

**Best for:** Technical onboarding, developer documentation for beginners, mentoring content.

---

#### Few-Shot — Role · Task · Example Input · Example Output · Format

Demonstrates desired behaviour with a worked example, anchoring output quality and style implicitly.

**Best for:** Document transformation pipelines, tone normalisation, consistent reformatting at scale.

---

## Visual Platforms Reference

### Image Platforms

| Platform | Syntax | Notes |
|---|---|---|
| **Universal** | Natural prose | Structured: subject + setting + style + lighting + camera + mood + quality |
| **Midjourney** | Comma-separated + flags | `--ar 16:9 --style raw --v 6.1`, `--no` for negatives |
| **DALL-E 3** | Full sentences | Explicit medium (`"a digital painting of…"`), no parameter syntax |
| **Stable Diffusion** | Tag weights | `(masterpiece:1.3)` syntax, separate `Negative prompt:` section |
| **Flux** | Natural sentences | `"highly detailed, professional photography, 8K resolution"` anchors |
| **Adobe Firefly** | Natural prose | Copyright-safe descriptors only — no living artists or brands |

### Video Platforms

| Platform | Style | Focus |
|---|---|---|
| **Universal** | Structured prose | Scene + subject + action + camera + lighting + style |
| **Sora** | Detailed cinematic | Explicit camera behaviour and subject motion precision |
| **Runway Gen-3** | Concise (100–300 words) | Camera motion is critical |
| **Pika** | Punchy | `[subject] [action] [setting] [camera] [style]` |
| **Kling** | Standard film terminology | Precise human motion descriptions |
| **Luma Dream Machine** | Photorealistic | Visual fidelity, lighting and atmosphere emphasis |

---

## API Reference

All endpoints are served by the Express server on the configured `PORT` (default `3030`).

---

### `GET /api/health`

Liveness check.

**Response `200`:**
```json
{
  "status": "ok",
  "ollama": "http://host.docker.internal:11434",
  "version": "4.1.2",
  "logFile": "/data/logs.jsonl"
}
```

---

### `GET /api/models`

Proxies `GET /api/tags` from Ollama and returns the available model list.

**Response `200`:**
```json
{
  "models": [
    { "name": "llama3.2", "size": 2019393189, "modified": "2024-09-26T10:00:00Z" }
  ]
}
```

**Response `502`:**
```json
{ "error": "Cannot reach Ollama at http://host.docker.internal:11434: ECONNREFUSED" }
```

---

### `POST /api/analyze`

Extracts structured framework fields from raw intent. Non-streaming, `temperature: 0.3` for consistent JSON output.

**Request body:**
```json
{
  "rawPrompt": "write a migration guide for our v2 API users",
  "framework": "risen",
  "model": "llama3.2",
  "outputLang": "en"
}
```

**Supported `framework` values:**
`costar` · `risen` · `rtf` · `crispe` · `race` · `care` · `cot` · `tot` · `react` · `ape` · `five_s` · `fewshot` · `visual_image` · `visual_video`

**Response `200` (success):**
```json
{
  "fields": {
    "role": "Technical documentation specialist",
    "input": "API v3 introduces 12 new endpoints and deprecates 4 from v2",
    "scenario": "v2 customers need to migrate before EOL in Q1",
    "expectation": "A step-by-step migration guide with code samples",
    "nuance": "Some v2 patterns have no v3 equivalent — acknowledge this explicitly"
  }
}
```

**Response `200` (parse failure):**
```json
{ "fields": {}, "raw_fallback": "<raw model output that could not be parsed as JSON>" }
```

---

### `POST /api/reformat` (SSE)

Forges the final prompt. Returns a **Server-Sent Events** stream.

**Request body — Quick mode:**
```json
{
  "rawPrompt": "fix slow api responses",
  "model": "llama3.2",
  "style": "precise",
  "mode": "quick",
  "outputLang": "en"
}
```

**Request body — Structured mode:**
```json
{
  "rawPrompt": "write migration guide",
  "model": "llama3.2",
  "style": "precise",
  "mode": "structured",
  "framework": "risen",
  "fields": {
    "role": "Technical documentation specialist",
    "input": "API v3 with 12 new endpoints",
    "scenario": "v2 EOL in Q1",
    "expectation": "Step-by-step migration guide",
    "nuance": "Some patterns have no v3 equivalent"
  },
  "outputLang": "en"
}
```

**Request body — Visual mode:**
```json
{
  "rawPrompt": "moody server room portrait",
  "model": "llama3.2",
  "mode": "visual",
  "visualType": "image",
  "platform": "midjourney",
  "fields": {
    "subject": "weathered engineer at a glowing terminal",
    "setting": "dark server room with blinking status LEDs",
    "art_style": "cinematic photography",
    "lighting": "dramatic side-lighting, deep shadows",
    "camera": "35mm f/1.4, shallow depth of field",
    "mood": "contemplative, slightly tense",
    "color_palette": "cool blues, amber highlights",
    "quality_tags": "masterpiece, highly detailed, 8k uhd",
    "negative_prompt": "blurry, cartoon, anime, watermark"
  },
  "outputLang": "en"
}
```

**SSE stream — normal:**
```
data: {"token":"You "}
data: {"token":"are "}
data: {"token":"a "}
data: {"done":true}
```

**SSE stream — error:**
```
data: {"error":"model 'llama3.2' not found"}
```

---

### `GET /api/logs`

Returns all persisted log entries from `logs.jsonl`, newest first.

**Response `200`:**
```json
{
  "entries": [
    {
      "ts": "2024-11-15T14:32:01.123Z",
      "level": "success",
      "message": "Forge complete · 312 tokens · 1248 chars · 4231ms"
    },
    {
      "ts": "2024-11-15T14:31:58.001Z",
      "level": "info",
      "message": "Forge started · structured · risen · llama3.2"
    }
  ]
}
```

Returns `{ "entries": [] }` if the file does not exist yet.

---

### `POST /api/logs`

Appends one or more entries to `logs.jsonl`. Automatically trims to 2,000 lines after each write.

**Request body (single):**
```json
{ "ts": "2024-11-15T14:32:01.123Z", "level": "info", "message": "Theme → light" }
```

**Request body (batch array):**
```json
[
  { "ts": "2024-11-15T14:32:01.000Z", "level": "info",    "message": "Forge started" },
  { "ts": "2024-11-15T14:32:05.312Z", "level": "success", "message": "Forge complete · 211 tokens" }
]
```

**Response `200`:**
```json
{ "ok": true, "written": 1 }
```

---

### `DELETE /api/logs`

Truncates `logs.jsonl` to empty.

**Response `200`:**
```json
{ "ok": true }
```

---

## Design System

### Typography

| Token | Value | Usage |
|---|---|---|
| `--sans` | Plus Jakarta Sans 400–800 | All UI labels, buttons, headings, navigation |
| `--mono` | JetBrains Mono 400–600 | Input fields, output text, counters, log entries, code |

### Colour Palette — Dark Mode

| Token | Hex / rgba | Semantic role |
|---|---|---|
| `--bg` | `#070810` | Page background |
| `--bg2` | `#0c0e1a` | Output canvas background |
| `--surface` | `rgba(14,16,30,0.9)` | Header, panels, command bar |
| `--surface2` | `rgba(22,25,42,0.9)` | Input fields, inner cards |
| `--surface3` | `rgba(30,34,56,0.7)` | Hover states, selected items |
| `--text` | `#e4eaf8` | Primary text |
| `--text2` | `#a8b4cc` | Secondary / supporting text |
| `--muted` | `#4e5876` | Labels, placeholders, metadata |
| `--blue` | `#4f8ef7` | Quick mode · primary focus ring |
| `--cyan` | `#22d3ee` | Structured mode · framework fields |
| `--amber` | `#fb923c` | Visual / Image mode |
| `--violet` | `#a78bfa` | Visual / Video mode |
| `--success` | `#34d399` | Online status · copy confirm |
| `--danger` | `#f87171` | Errors · required field markers |

### Colour Palette — Light Mode

| Token | Hex / rgba |
|---|---|
| `--bg` | `#f0f2f8` |
| `--surface` | `rgba(255,255,255,0.95)` |
| `--blue` | `#2563eb` |
| `--cyan` | `#0891b2` |
| `--amber` | `#ea580c` |
| `--violet` | `#7c3aed` |

### Spacing & Radius

| Token | Value | Usage |
|---|---|---|
| `--r-xs` | `6px` | Small utility chips |
| `--r-sm` | `8px` | Buttons, input fields |
| `--r-md` | `12px` | Cards, panel insets |
| `--r-lg` | `16px` | Drawer rounding |
| `--r-pill` | `100px` | Pill badges, language toggle |

### Key Visual Effects

- **Ambient orbs** — Three CSS-only animated gradient blobs (700 / 600 / 400 px diameter, 80 px blur, 18 s drift cycle). Zero JS, zero performance cost.
- **Glassmorphism panels** — `backdrop-filter: blur(20px)` on every surface with `rgba()` fills; three distinct opacity levels create genuine depth.
- **Streaming glow** — The output panel border pulses in the active mode's accent colour with `inset box-shadow` during token streaming.
- **Forge button gradient** — Each mode has a unique directional gradient fill + matching `box-shadow` so the primary CTA is visually unambiguous.

---

## Project Structure

```
prompt-forge/
├── docker-compose.yml     # Service + named volume definition
├── Dockerfile             # Node 20 Alpine build
├── package.json           # Express, node-fetch, cors
├── server.js              # Express API — LLM proxy + log persistence (336 lines)
└── public/
    └── index.html         # Single-file frontend — HTML + CSS + JS (~2,200 lines)

# Runtime — inside container, on Docker named volume
/data/
└── logs.jsonl             # Persistent event log (JSONL, max 2,000 lines, rolling trim)
```

### Key Implementation Notes

- **`node-fetch` pinned to `^2.x`** — v3+ is ESM-only and breaks `require()`. Do not upgrade without converting `server.js` to ES modules.
- **SSE buffer** — `buffer = lines.pop()` retains incomplete trailing data across TCP chunks, preventing split-line JSON parse errors.
- **Auto-Fill guards** — `isStreaming` and `isAnalyzing` flags are both checked and both reset in `finally` blocks to prevent deadlock on network errors.
- **Token estimation** — `Math.ceil(text.length / 4)` is the standard GPT-family approximation (~4 chars/token). Used for the history drawer only; Ollama does not return token counts in the streaming API.

---
## Troubleshooting

| Problem | Solution |
|---|---|
| **"Cannot reach Ollama"** | Verify Ollama is running: `curl http://localhost:11434/api/tags` |
| **No models in dropdown** | Pull a model: `ollama pull llama3.2` |
| **Auto-Fill returns empty fields** | Use a 7 B+ instruct-tuned model; small models often fail JSON generation |
| **Auto-Fill shows `raw_fallback`** | Model wrapped JSON in markdown fences; try a larger model |
| **Copy button fails on mobile** | The fallback chain is automatic; if all methods fail, long-press the output text |
| **Event log empty after restart** | Inspect volume: `docker volume inspect prompt-forge_forge-data` |
| **Port 3030 already in use** | Change host port in `docker-compose.yml`: `- "3031:3030"` |
| **Container exits immediately** | Check logs: `docker compose logs prompt-forge` |
| **Slow streaming** | Use a smaller/quantised model; check Ollama GPU utilisation with `ollama ps` |

### Useful Commands

```bash
# Rebuild after any code change
docker compose up -d --build

# Live container logs
docker compose logs -f prompt-forge

# Shell inside container
docker exec -it prompt-forge sh

# Read the persistent log file
docker exec prompt-forge cat /data/logs.jsonl

# Tail the log file in real time
docker exec prompt-forge tail -f /data/logs.jsonl

# Inspect the named volume location on the host
docker volume inspect prompt-forge_forge-data

# Stop (keeps volume)
docker compose down

# Stop and delete the log volume
docker compose down -v

# Full clean rebuild
docker compose build --no-cache && docker compose up -d
```

---

## Contributing

Contributions, issues, and feature requests are welcome.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "feat: add my feature"`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

### Run Without Docker

```bash
npm install

export OLLAMA_URL=http://localhost:11434
export PORT=3030
export DATA_DIR=./data

node server.js
# open http://localhost:3030
```

No build step is required — the entire frontend is a single `public/index.html` file.

### Extending PromptForge

**Add a new prompt framework:**
1. Add field keys to `FIELD_KEYS` in `server.js`
2. Add the framework definition object to `FRAMEWORKS` in `public/index.html`
3. Add the description to `assembleFrameworkSystemPrompt()` in `server.js`
4. Add an `<option>` to the correct `<optgroup>` in `#fwSelect`

**Add a new visual platform:**
1. Add the system prompt to `IMAGE_PLATFORM_PROMPTS` or `VIDEO_PLATFORM_PROMPTS` in `server.js`
2. Add the platform entry to `IMAGE_PLATFORMS` or `VIDEO_PLATFORMS` in `public/index.html`

---

## License

```
MIT License

Copyright (c) 2024 PromptForge Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Acknowledgements

- [Ollama](https://ollama.com) — local LLM inference engine
- [Express](https://expressjs.com) — Node.js web framework
- [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) — UI typography
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — monospace typography

---

*PromptForge v4.1.2 · Self-hosted · Local-only · MIT License*
