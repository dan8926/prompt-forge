# Prompt Forge v4

A Dockerized AI prompt engineering workstation powered entirely by your local Ollama instance. No external APIs. No keys required.

---
![Top Languages Card](https://github-readme-stats.vercel.app)

---
---
## Screenshot
<img width="1308" height="737" alt="image" src="https://github.com/user-attachments/assets/642479b3-648c-4e55-bd9f-55029e07a161" />

---

## Features

| Feature | Description |
|---|---|
| **Quick Mode** | Reformat rough text into an optimized prompt in seconds |
| **Structured Mode** | Build prompts using 12 professional frameworks with Auto-Fill |
| **Visual Mode** | Generate prompts for 6 image and 6 video AI generators |
| **Dark / Light Mode** | Toggleable theme with CSS variable design tokens |
| **Spanish Output (EN/ES)** | Full Spanish output across all modes and Auto-Fill |
| **Token History** | Sortable table of every forge operation with token counts |
| **Event Log** | Real-time debug log of all system events |
| **Clipboard Fallback** | Works across all browsers including iOS Safari, macOS, Android |
| **Mobile Responsive** | Touch-optimized, stacked layout, min 44px touch targets |
| **\*-instruct Default** | Auto-selects the first instruct model from Ollama |

---
## Supported Frameworks (12)

### Classic
| Framework | Acronym Meaning | Best For |
|---|---|---|
| COSTAR | Context · Objective · Style · Tone · Audience · Response Format | Full-stack prompt design, content, business |
| RISEN | Role · Input · Scenario · Expectation · Nuance | Complex projects, multi-perspective analysis |
| RTF | Role · Task · Format | Narrow-scope, lean, well-defined output tasks |
### Persona & Structure
| Framework | Acronym Meaning                                                | Best For                                         |
| --------- | -------------------------------------------------------------- | ------------------------------------------------ |
| CRISPE    | Capacity/Role · Insight · Statement · Personality · Experiment | Distinct AI personas, iterative exploration      |
| RACE      | Role · Action · Tactic · Expectation                           | Daily tasks, emails, high-volume repetitive work |
| CARE      | Context · Action · Result · Example                            | Success through actionable concrete examples     |
### Reasoning
| Framework              | Acronym Meaning                                      | Best For                                      |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------- |
| Chain of Thought (CoT) | Role · Problem · Reasoning Hint · Output Format      | Step-by-step logical reasoning                |
| Tree of Thoughts (ToT) | Role · Problem · Thought Paths · Evaluation · Output | Parallel reasoning, multi-solution evaluation |
| ReAct                  | Role · Problem · Available Actions · Output Format   | AI agents with tool interaction loops         |
### Focused
| Framework | Acronym Meaning | Best For |
|---|---|---|
| APE | Action · Purpose · Expectation | Rapid, directive tasks with clear outcomes |
| Five S Model | Set Scene · Specify · Simplify · Structure · Share Feedback | Teachable, iterable enterprise/education use |
| Few-Shot | Role · Task · Example Input/Output · Format | Consistent tone and transformation patterns |

---
## Visual Platforms

**Image:** Universal · Midjourney · DALL-E 3 · SD/Auto1111 · Flux · Adobe Firefly

**Video:** Universal · Sora · Runway Gen-3 · Pika · Kling · Luma Dream Machine

---
## Quick Start

### Prerequisites
- **Docker** and **Docker Compose**
- **Ollama** running locally with at least one model pulled

```bash
# Pull a recommended instruct model
ollama pull llama3.2-instruct
# or
ollama pull mistral
```
### Setup
```bash
# 1. Create the project directory
mkdir prompt-forge && cd prompt-forge

# 2. Place these files in the directory:
#    docker-compose.yml
#    Dockerfile
#    package.json
#    server.js
#    public/index.html

# 3. Build and start
docker compose up -d --build

# 4. Open in browser
open http://localhost:3030
```

---
## Configuration
### Ollama Connection

Edit `OLLAMA_URL` in `docker-compose.yml`:

| Setup | Value |
|---|---|
| Host machine / Docker Desktop (Mac, Windows) | `http://host.docker.internal:11434` *(default)* |
| Linux Docker Engine | Same value — `extra_hosts` entry handles this |
| Ollama in a named Docker network | `http://<container-name>:11434` + uncomment `networks:` |
| Remote machine | `http://192.168.x.x:11434` |
### Port

Default: `3030`. Change with `PORT` environment variable in `docker-compose.yml`.

---
## Usage Guide
### Quick Mode
1. Type your rough request in the text area
2. Select an output style (Precise / Step-by-Step / Concise / Creative / Debug)
3. Press **Forge Prompt** or `Ctrl+Enter` / `Cmd+Enter`
### Structured Mode
1. Enter your raw intent in the top field
2. Select a framework from the dropdown
3. Click **Auto-Fill** to have the model populate fields from your intent, OR fill fields manually
4. Press **Forge Prompt**
### Visual Mode
1. Choose **Image** or **Video**
2. Select a target platform
3. Enter your raw visual intent
4. Click **Auto-Fill** or fill fields manually
5. Press **Forge Prompt**
### Language Toggle (EN / ES)
Select **EN** or **ES** in the action bar before forging. All output — including Auto-Fill field values — will be in the selected language. For visual platforms, technical syntax keywords (e.g. `--ar`, `masterpiece`) remain in English regardless of language selection.
### Token History
Click the **⧖** button in the header to open the token history drawer. Columns are sortable by clicking headers. Click **Clear** to reset.
### Event Log
Click the **▦** button in the header to open the event log. All forge operations, model changes, errors, and clipboard events are logged in real time with timestamps and severity levels (INFO / SUCCESS / WARN / ERROR).
### Dark / Light Mode
Click the **☀ / ☾** button in the header to toggle. Your preference is saved to `localStorage`.

---
## Clipboard Behavior

Copy uses a two-method fallback chain:

1. **Clipboard API** (`navigator.clipboard.writeText`) — works on HTTPS and localhost
2. **execCommand fallback** — works without HTTPS; includes iOS Safari-specific selection handling

If both methods fail, a toast guides you to select text manually.

---
## Model Selection

On load, Prompt Forge automatically selects the first model whose name matches `/-instruct/i`. If no instruct model is found, the first model in the list is selected. You can change the model at any time using the dropdown in the header.

---
## Troubleshooting

| Problem | Solution |
|---|---|
| "Cannot reach Ollama" | Verify Ollama is running: `curl http://localhost:11434/api/tags` |
| No models in dropdown | Pull a model: `ollama pull llama3.2` |
| Auto-Fill returns empty JSON | Use a 7B+ instruct-tuned model (llama3, mistral, qwen2.5) |
| Copy fails on mobile | The fallback method is attempted automatically; if all fails, long-press text |
| Container won't start | Check Docker logs: `docker compose logs prompt-forge` |

---
## Docker Commands

```bash
# Start
docker compose up -d

# Rebuild after code changes
docker compose up -d --build

# Stop
docker compose down

# View logs
docker compose logs -f prompt-forge

# Shell into container
docker exec -it prompt-forge sh
```

---

## Design Decisions

### Architecture
The application is a single Docker container running an Express.js server on Node 20 Alpine. The server acts as a secure proxy to Ollama — all LLM calls originate server-side, keeping the Ollama endpoint unexposed to the browser. The client communicates with the server via two endpoints:

- `POST /api/analyze` — non-streaming JSON extraction for Auto-Fill
- `POST /api/reformat` — Server-Sent Events streaming for all forge operations

### Why SSE over WebSockets?
SSE is unidirectional (server → client), which perfectly matches the streaming use case. It requires no special headers, works through standard HTTP/1.1, and reconnects automatically on dropped connections. WebSockets would add unnecessary bidirectional overhead.

### Language System
A single `addLangInstruction(systemPrompt, outputLang, isVisual)` helper appends a Spanish directive as the last bullet in any assembled system prompt. Appending (not prepending) ensures the language instruction doesn't override early structural rules but takes precedence as a final constraint. The `isVisual` flag adds an exception clause preserving English for AI generator syntax keywords.

### Clipboard Fallback Chain
Three layers:
1. `navigator.clipboard.writeText()` — modern, requires HTTPS or localhost
2. `document.execCommand('copy')` — deprecated but universally supported; requires DOM manipulation
3. iOS-specific `Range + setSelectionRange(0, 999999)` within layer 2

The fallback is transparent to the user — the copy button still shows ✓ regardless of method used.

### Token Estimation
Uses `Math.ceil(text.length / 4)` — the standard GPT-family approximation. This is an estimate, not an exact count. For Ollama models (primarily Llama family), the actual tokenizer may yield slightly different results, but the ~4 chars/token ratio is accurate enough for usage tracking purposes.

### Model Auto-Selection
Matches `/-instruct/i` — a case-insensitive regex that catches `llama3.2-instruct`, `mistral-instruct`, `qwen2.5-instruct`, etc. If no instruct model is found, the first model is selected. This is a UX default only — the user can select any model at any time.

### Mobile Layout Strategy
Uses CSS Grid `1fr 1fr` on desktop, switching to `flex-direction: column` with `max-height: 45vh` on the left panel below 768px. All interactive elements meet the WCAG 2.5.5 / Apple HIG minimum touch target of 44×44px. The action bar wraps on narrow viewports.

### Theme System
CSS custom properties scoped to `[data-theme="dark"]` and `[data-theme="light"]` on `<html>`. Light mode uses darker accent colors (e.g. `#4a5500` instead of `#e8ff47`) to maintain WCAG AA contrast ratios on light backgrounds. Theme preference is persisted to `localStorage`.

### Framework Dropdown vs. Tabs
12 frameworks exceed what fits in a single-row tab bar, especially on mobile. A grouped `<select>` with `<optgroup>` dividers organizes frameworks by category (Classic / Persona & Structure / Reasoning / Focused) and works natively on all devices and screen sizes.

### Event Log
Entries are stored in a JS array (max 300, newest-first) and rendered into a `drawer-bottom` panel. Each entry has a timestamp, severity level, and message. The log is runtime-only — it resets on page refresh. This is intentional: it's a debugging tool for the current session, not persistent storage.

---

## Framework Reference

### COSTAR
**Fields:** Context · Objective · Style · Tone · Audience · Response Format

**Use when:** You need full behavioral control — specifying not just what to produce but how to communicate, to whom, and in what format. Ideal for content creation, business communications, and instructional design.

**Example use case:** Drafting a weekly infrastructure cost digest email for non-technical managers.

---

### RISEN
**Fields:** Role · Input · Scenario · Expectation · Nuance

**Use when:** The task is complex and contextual. RISEN handles multi-perspective problems where the scenario, constraints, and edge cases are as important as the core ask.

**Example use case:** Writing a v2 → v3 API migration guide that acknowledges deprecated patterns.

---

### RTF
**Fields:** Role · Task · Format

**Use when:** The scope is narrow and well-defined. RTF is the leanest effective framework — use it when you know exactly what you want and don't need behavioral scaffolding.

**Example use case:** "Audit this Express.js middleware stack and return a ranked issue list."

---

### CRISPE
**Fields:** Capacity/Role · Insight · Statement · Personality · Experiment

**Use when:** You want a specific AI persona and iterative, exploratory output. The Experiment field allows you to request two competing approaches or hypotheses for comparison.

**Example use case:** Getting an SRE persona to propose and compare two solutions to a GC latency problem.

---

### RACE
**Fields:** Role · Action · Tactic · Expectation

**Use when:** Speed and repeatability matter more than nuance. RACE is optimized for high-volume tasks: emails, announcements, social posts, daily comms.

**Example use case:** Drafting a LinkedIn product launch post with specific constraints on length and structure.

---

### CARE
**Fields:** Context · Action · Result · Example

**Use when:** Demonstrating success is key. CARE anchors the prompt to a concrete reference example, which helps the model understand the quality bar and the style of "done well."

**Example use case:** Writing a developer onboarding guide modeled on Stripe-style documentation.

---

### Chain of Thought (CoT)
**Fields:** Role · Problem · Reasoning Hint · Output Format

**Use when:** The problem requires explicit step-by-step reasoning before a conclusion. The Reasoning Hint field instructs the model how to reason — or leave it blank for default CoT behavior.

**Example use case:** Diagnosing a slow Postgres query and ranking optimization strategies.

---

### Tree of Thoughts (ToT)
**Fields:** Role · Problem · Thought Paths · Evaluation Criteria · Output Format

**Use when:** There are multiple viable solutions and you want the model to explore each independently before recommending. The Thought Paths field defines the branches; Evaluation Criteria defines how to score them.

**Example use case:** Choosing between PostgreSQL, MongoDB, and Cassandra for a real-time collaboration platform.

---

### ReAct
**Fields:** Role · Problem · Available Actions · Output Format

**Use when:** Simulating or instructing an AI agent that interacts with external tools. The Available Actions field explicitly lists what tools/functions the agent can call.

**Example use case:** A research agent tasked with competitive intelligence gathering using web search and data extraction tools.

---

### APE
**Fields:** Action · Purpose · Expectation

**Use when:** Maximum directness is needed. APE is three fields: do this, because of this, outputting this. No persona, no behavioral scaffolding.

**Example use case:** "Generate a Python CSV parser. For automating AP data ingestion. Production-ready with error handling."

---

### Five S Model
**Fields:** Set the Scene · Specify Task · Simplify Language · Structure Response · Share Feedback

**Use when:** Teaching or onboarding. The Five S model is designed for rapid iteration and teachability — the Share Feedback field instructs the model to include reflection and common mistakes.

**Example use case:** Explaining REST API design to a junior developer with beginner-friendly language and a closing mistakes checklist.

---

### Few-Shot
**Fields:** Role · Task · Example Input · Example Output · Format

**Use when:** You need consistent output patterns — tone, transformation style, or content format. The worked example establishes the quality bar implicitly.

**Example use case:** Transforming verbose internal engineering notes into public developer documentation, with before/after examples.

---

## Implementation Notes

### `/api/analyze` — Auto-Fill
Uses `stream: false` and `temperature: 0.3` (low temperature improves JSON consistency). The response is stripped of markdown fences via regex before `JSON.parse`. If parsing fails, `raw_fallback` is returned — the client surfaces a helpful error message pointing to model capability issues.

### `/api/reformat` — Streaming
Uses `stream: true` with SSE. A buffer accumulates partial lines across TCP chunks (`buffer = lines.pop()`) to prevent malformed JSON parses at chunk boundaries. All four exit paths (non-OK response, stream error, stream end, outer catch) call `res.end()`.

### `addLangInstruction`
Zero-cost when `outputLang !== 'es'` — returns the system prompt unchanged. The Spanish directive is appended as a final bullet, not injected into the middle of the prompt, which preserves the integrity of framework assembly rules.

### Auto-Fill guards
Both `isStreaming` and `isAnalyzing` are checked before any LLM call and reset in `finally` blocks. This prevents double-forge, forge-during-autofill, and permanent lock on any network error.

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
