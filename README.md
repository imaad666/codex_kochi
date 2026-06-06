# Open IDE

## Overview

Open IDE is a CRT-themed, multi-agent coding IDE. Focused on using minimal tokens, thanks to Altbot the orchestrator for hyperreasoning(also saving water iykyk).

## Problem Statement

AI coding often feels like copying code out of a chatbot. Open IDE makes the build process visible, interactive, and repo-first.

## Solution

Open IDE turns a prompt into a live development run: Altbot evaluates plan branches, specialist agents generate files, and the user can edit, preview, download, terminal-inspect, or push the result to GitHub.

## Features

- CRT intro flow with repo connect, local-only mode, prompt, and agent cards.
- Altbot hyperreasoning with plan branches, scoring, pruning, and execution graph.
- Frontend, Backend, and Database agents with step-scoped subagents.
- Editable code workspace with file explorer, save flow, lint feedback, and terminal panel.
- GitHub OAuth for opening, creating, pushing, and clearing repo files.
- Zip download, local preview, session restore, and Vercel-ready deployment config.

## Tech Stack

- Frontend: React, Vite, custom code editor, ReactFlow, dagre.
- Backend: Node.js, Express, REST, Server-Sent Events.
- Storage: Local `.open-ide/` files or Vercel Blob.
- AI APIs: Groq for planning, generation, subagents, and chat.
- Integrations: GitHub OAuth and GitHub REST API.
- Hosting: Vercel or single-process Node production server.

## Codex / OpenAI Usage

OpenAI Codex contributed to this repo as an AI coding collaborator for codebase orientation, debugging support, implementation planning, and README drafting.

Open IDE itself uses Groq as the runtime model provider. Codex/OpenAI was used during development, not as the app's production LLM backend.

## Contributors

- Imaad - product direction, design, and implementation.
- OpenAI Codex - AI coding contributor.

## Demo

Demo or pitch video link: coming soon.

## Screenshots

Screenshots: coming soon.

## How to Run Locally

```bash
git clone <repo-url>
cd <project-folder>
npm install
cp .env.example .env
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env` for local dev. Create credentials from:

- Groq API key: `https://console.groq.com/keys`
- GitHub OAuth app: `https://github.com/settings/developers`
- Auth secret: `openssl rand -hex 32`
- Vercel Blob token: connect Blob in Vercel; it sets `BLOB_READ_WRITE_TOKEN`

```bash
# Required
GROQ_API_KEY=

# Optional shared Groq config
GROQ_PLANNER_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_WORKER_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_MAX_OUTPUT_TOKENS=1600
GROQ_REQUEST_CHAR_BUDGET=7000
GROQ_TPM_SAFE_TOTAL=5500
GROQ_MIN_GAP_MS=700

# Optional per-agent Groq keys/models
GROQ_ALTBOT_API_KEY=
GROQ_ALTBOT_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_FRONTEND_API_KEY=
GROQ_FRONTEND_MODEL=llama-3.3-70b-versatile
GROQ_BACKEND_API_KEY=
GROQ_BACKEND_MODEL=qwen/qwen3-32b
GROQ_DATABASE_API_KEY=
GROQ_DATABASE_MODEL=llama-3.1-8b-instant

# Optional GitHub OAuth / repo actions
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
AUTH_SECRET=

# URLs
APP_URL=http://localhost:5173
API_URL=http://localhost:3001
PORT=3001

# Production storage, normally set by Vercel Blob
BLOB_READ_WRITE_TOKEN=
```

Local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## Deploy

```bash
npm run build
npm start
```
