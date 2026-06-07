# Open IDE
Visit : https://openide-codex.vercel.app
## Overview

Open IDE is a CRT-themed, multi-agent coding IDE. You connect a GitHub repo, describe what you want built, and watch Altbot run hyperreasoning across three architectural plan branches before specialist agents stream code into a live workspace, push directly to GitHub or save as a zip.

## Problem Statement

AI coding tools often feel like copying code out of a chat window. Reasoning is hidden, one model does everything, token usage balloons, and there is no real tie to a repository you can edit, run, preview, or ship.

Builders need a way to see architecture get decided before code is written, watch specialized agents work in parallel, and land in an IDE that respects their repo — not another paste bin.

## Solution

Open IDE turns a prompt into a structured swarm run:

1. **Altbot** (controller) generates three genuinely different plan branches, scores them, prunes losers, and deploys only the winner — saving tokens before any agent writes a file.
2. **Ives UI**, **Jobalyser**, and **WzData** (sub agents) selectable - each run step-scoped subagents on their own Groq model, streaming files into a shared workspace in real time.
3. The user lands in a full IDE shell — file explorer, code editor, terminal, agent chat, hyperreasoning graph — and can save, export, preview, or push to GitHub.

Hyperreasoning happens first. Specialists execute second. The repo stays central throughout.

## Features

- CRT intro flow with GitHub oAuth, prompt entry, and agent card selection
- Hyperreasoning — three plan branches, scoring, pruning, and live search/execution graphs
- Step-scoped subagents per lane (Frontend, Backend, Database) with per-agent Groq models
- Editable code workspace — file explorer, save flow (⌘S), syntax lint, delete + push sync
- Integrated terminal panel with workspace and GitHub-aware git helpers
- Agent chat — talk to Altbot or lane specialists; Code mode triggers a new swarm
- GitHub OAuth — open/create repos, import files, push workspace, clear remote repo
- Session restore across refreshes
- Zip export, local preview (when `server.js` exists), Vercel-ready deployment

## Tech Stack

- **Frontend:** React 18, Vite, React Flow, dagre, custom code editor
- **Backend:** Node.js, Express, REST, Server-Sent Events (SSE)
- **Database:** Vercel Blob
- **APIs:** Groq (planning, generation, subagents, chat), GitHub REST + OAuth, Vercel Blob
- **Hosting:** Vercel

## Codex / OpenAI Usage

OpenAI Codex was used as an AI coding collaborator during development of this repository. Groq powers the live product at runtime.

| Area | How Codex / OpenAI was used |
|------|-----------------------------|
| Ideation | Product flow, agent personas, hyperreasoning UX |
| Architecture planning | SSE migration, session storage, serverless/Vercel layout |
| Code generation | Feature implementation across `server.js`, agents, and React UI |
| Debugging | Groq payload errors, repo import, session restore, GitHub push sync |
| Testing | Build verification, local dev flow checks |
| Documentation | README drafting and structure |
| API integration | GitHub OAuth, Groq per-agent config, Vercel Blob patterns |


## Demo

Demo or pitch video link: _coming soon_

## Screenshots

### Welcome
![Open IDE welcome / intro screen](screenshots/welcome_1.png)

### Agents
![Agent card selection — Altbot, Ives UI, Jobalyser, WzData](screenshots/agents.png)

### IDE
![Live IDE — file explorer, editor, terminal, and agent chat](screenshots/ide.png)

### Reasoning
![Altbot hyperreasoning — plan branches, scoring, and graph](screenshots/reasoning.png)

### Final
![Completed build — workspace ready to save, export, or push](screenshots/final.png)

## How to Run Locally

```bash
git clone https://github.com/imaad666/codex_kochi
cd codex_1
npm install
cp .env.example .env
npm run dev
```

Add your Groq API key to `.env`:

```bash
GROQ_API_KEY=your_key_here
```

Get a key at [console.groq.com/keys](https://console.groq.com/keys).


Local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

