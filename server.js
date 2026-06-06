import express from "express";
import { createServer } from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import { dirname, join, normalize } from "path";
import { fileURLToPath } from "url";
import {
  authConfig,
  createAuthCookie,
  createGitHubTokenCookie,
  createOAuthState,
  exchangeGitHubCode,
  fetchGitHubUser,
  githubAuthorizeUrl,
  githubConfigured,
  oauthStateCookie,
  resolveAuthUser,
  storeGitHubToken,
  verifyOAuthState,
} from "./auth.js";
import {
  createGitHubRepo,
  deleteAllGitHubRepoFiles,
  execGitTerminalCommand,
  listUserRepos,
  loadGitHubRepoFiles,
  openGitHubRepo,
  pushRunToGitHub,
} from "./github.js";
import { startRunPreview } from "./runPreview.js";
import { execTerminalCommand } from "./terminal.js";
import { createRunZipBuffer } from "./zipRun.js";
import { runFilePath, runManifestPath } from "./runFiles.js";
import { storage } from "./storage.js";
import { createSseEmitter, initSse, sseEnd, sseWrite } from "./sse.js";
import {
  AGENTS,
  ALTBOT_CHAT_SYSTEM,
  FILE_SCHEMA,
  agentChatSystem,
  attachmentContent,
  selectedAgents,
} from "./agents.js";
import { GroqError, agentGroqConfig, groqConfig, groqJson, groqText, truncateText } from "./groq.js";
import { runHyperreasoning } from "./hyperreasoning.js";
import { resolveInspoAttachments, searchInspiration } from "./inspo-agent.js";
import { createSessionId, loadSession, saveSession } from "./sessions.js";
import { listAgentModels, runAgentSubagents } from "./subagents.js";

try {
  process.loadEnvFile();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const PORT = Number(process.env.PORT || 3001);
const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const IS_VERCEL = Boolean(process.env.VERCEL);

function authCookieOptions() {
  const { secureCookies } = authConfig();
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
  };
}

function fallbackPlan(intent, agents) {
  return {
    summary: `Build ${intent} with ${agents.map((agent) => agent.title).join(", ")}`,
    steps: agents.map((agent, index) => ({
      id: String(index + 1),
      title: `${agent.title} implementation`,
      description: `Create ${agent.file}`,
      agent: agent.title,
      dependsOn: [],
    })),
  };
}

function resolveAgentTitle(name, agents) {
  const raw = String(name || "").trim();
  const hit = agents.find((agent) => agent.title.toLowerCase() === raw.toLowerCase());
  return hit?.title || null;
}

function normalizePlan(plan, agents) {
  const allowed = new Set(agents.map((agent) => agent.title));
  const seenIds = new Set();
  const steps = (plan.steps || [])
    .map((step) => ({ ...step, agent: resolveAgentTitle(step.agent, agents) || step.agent }))
    .filter((step) => allowed.has(step.agent))
    .map((step, index) => {
      let id = String(step.id || index + 1);
      if (seenIds.has(id)) id = String(index + 1);
      seenIds.add(id);
      return {
        ...step,
        id,
        title: String(step.title || `${step.agent} step`),
        description: String(step.description || ""),
        dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : [],
      };
    });

  const normalizedSteps = steps.length ? steps : fallbackPlan("the requested app", agents).steps;
  const validIds = new Set(normalizedSteps.map((step) => step.id));

  return {
    summary: String(plan.summary || "Implementation plan"),
    steps: normalizedSteps.map((step) => ({
      ...step,
      dependsOn: step.dependsOn.filter((id) => validIds.has(id)),
    })),
  };
}

function sanitizeAttachments(attachments = []) {
  return attachments
    .filter((attachment) => attachment && typeof attachment === "object")
    .slice(0, 8)
    .map((attachment) => {
      const kind = ["image", "text", "file"].includes(attachment.kind) ? attachment.kind : "file";
      return {
        id: String(attachment.id || ""),
        name: String(attachment.name || "attachment").slice(0, 180),
        type: String(attachment.type || "application/octet-stream").slice(0, 120),
        size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
        kind,
        content: kind === "text" ? String(attachment.content || "").slice(0, 3000) : "",
        dataUrl:
          kind === "image" && String(attachment.dataUrl || "").startsWith("data:image/")
            ? String(attachment.dataUrl).slice(0, 140_000)
            : "",
      };
    });
}

function workerSafeAttachments(attachments = []) {
  return sanitizeAttachments(attachments)
    .filter((attachment) => attachment.kind !== "image")
    .map((attachment) => ({
      ...attachment,
      content: attachment.kind === "text" ? String(attachment.content || "").slice(0, 600) : "",
      dataUrl: "",
    }));
}

function inspoSummaryAttachments(inspoSelection = []) {
  if (!inspoSelection.length) return [];
  const titles = inspoSelection.map((item) => item.title || item.id).filter(Boolean).slice(0, 5);
  return [
    {
      id: "inspo-summary",
      name: "inspo-summary.txt",
      type: "text/plain",
      size: titles.join(", ").length,
      kind: "text",
      content: `Selected visual inspiration: ${titles.join(", ")}. Match this mood in UI styling.`,
      dataUrl: "",
    },
  ];
}

function stripCodeFence(value) {
  const match = value.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : value;
}

function agentSteps(plan, agent) {
  return plan.steps.filter((step) => step.agent === agent.title);
}

function agentDependencies(plan, agent) {
  const ownerByStep = new Map(plan.steps.map((step) => [step.id, step.agent]));
  const deps = new Set();
  for (const step of agentSteps(plan, agent)) {
    for (const stepId of step.dependsOn || []) {
      const owner = ownerByStep.get(stepId);
      if (owner && owner !== agent.title) deps.add(owner);
    }
  }
  return deps;
}

function swarmBlocked(plan, agents) {
  const pending = new Set(agents.map((agent) => agent.title));
  const completed = new Set();
  let progress = true;

  while (progress && pending.size) {
    progress = false;
    for (const title of [...pending]) {
      const agent = agents.find((item) => item.title === title);
      const deps = [...agentDependencies(plan, agent)];
      if (deps.every((dep) => completed.has(dep))) {
        pending.delete(title);
        completed.add(title);
        progress = true;
      }
    }
  }

  return pending.size > 0;
}

/** Groq sometimes returns circular cross-agent deps — strip until runnable. */
function ensureRunnablePlan(plan, agents) {
  const work = {
    ...plan,
    steps: (plan.steps || []).map((step) => ({
      ...step,
      dependsOn: Array.isArray(step.dependsOn) ? [...step.dependsOn] : [],
    })),
  };

  if (!swarmBlocked(work, agents)) return work;

  console.warn("[swarm] dependency deadlock detected — relaxing cross-agent dependsOn");

  for (let attempt = 0; attempt < 24 && swarmBlocked(work, agents); attempt += 1) {
    const ownerByStep = new Map(work.steps.map((step) => [step.id, step.agent]));
    let relaxed = false;

    for (const agent of agents) {
      if (!swarmBlocked(work, agents)) break;
      for (const step of agentSteps(work, agent)) {
        const crossDeps = (step.dependsOn || []).filter((stepId) => {
          const owner = ownerByStep.get(stepId);
          return owner && owner !== agent.title;
        });
        if (!crossDeps.length) continue;
        step.dependsOn = step.dependsOn.filter((stepId) => stepId !== crossDeps[0]);
        relaxed = true;
        break;
      }
      if (relaxed) break;
    }

    if (!relaxed) {
      work.steps = work.steps.map((step) => ({ ...step, dependsOn: [] }));
      break;
    }
  }

  return work;
}

function buildSharedContext(completedOutputs) {
  if (!completedOutputs.length) return "";
  return completedOutputs
    .map(({ agent, output }) => {
      const primary = output.files?.[0];
      return [
        `Agent: ${agent.title}`,
        `Summary: ${output.summary}`,
        primary
          ? `Preview ${primary.filename}:\n${String(primary.code || "").slice(0, 700)}`
          : "",
      ].join("\n");
    })
    .join("\n\n")
    .slice(0, 2200);
}

function coerceOutput(agent, output) {
  const rawFiles = Array.isArray(output?.files)
    ? output.files
    : output?.code
      ? [{ filename: output.filename || agent.file, code: output.code, summary: output.summary || "" }]
      : [];
  const files = rawFiles.map((file, index) => {
    const filename = String(file?.filename || (index === 0 ? agent.file : "")).trim();
    const code = stripCodeFence(String(file?.code || "").trim());
    if (!filename || !code) {
      throw new GroqError(`${agent.title} returned an invalid file`);
    }
    return {
      filename,
      code: code.endsWith("\n") ? code : `${code}\n`,
      summary: String(file?.summary || `${agent.title} generated ${filename}`),
    };
  });
  if (!files.length) {
    throw new GroqError(`${agent.title} returned no files`);
  }
  return {
    summary: String(output?.summary || `${agent.title} completed ${agent.file}`),
    files,
    primaryFile: files[0].filename,
  };
}

async function executeSwarm({ emit, intent, plan, agents, attachments, inspoImages = [] }) {
  const pending = new Map(agents.map((agent) => [agent.title, agent]));
  const completed = new Map();
  const completedOutputs = [];
  const results = [];

  for (const agent of agents) {
    const deps = [...agentDependencies(plan, agent)];
    emit("agent-status", {
      agent: agent.title,
      status: deps.length ? "waiting" : "ready",
      message: deps.length ? `Waiting for ${deps.join(", ")}` : "Ready",
      dependencies: deps,
      stepIds: agentSteps(plan, agent).map((step) => step.id),
    });
  }

  while (pending.size) {
    const ready = [...pending.values()].filter((agent) =>
      [...agentDependencies(plan, agent)].every((dep) => completed.has(dep))
    );

    if (!ready.length) {
      throw new GroqError("Agent dependency graph is blocked");
    }

    const levelResults = [];
    for (const agent of ready) {
      pending.delete(agent.title);
      const stepIds = agentSteps(plan, agent).map((step) => step.id);
      emit("agent-status", {
        agent: agent.title,
        status: "running",
        message: "Generating implementation",
        stepIds,
      });
      const output = coerceOutput(
        agent,
        await runAgentSubagents({
          emit,
          intent,
          plan,
          agent,
          attachments,
          inspoImages,
          sharedContext: buildSharedContext(completedOutputs),
        })
      );
      for (const file of output.files) {
        await emitFile(emit, agent, file);
      }
      emit("agent-status", {
        agent: agent.title,
        status: "complete",
        message: output.summary,
        filename: output.primaryFile,
        files: output.files.map((file) => file.filename),
        stepIds,
      });
      levelResults.push({ agent, output });
    }

    for (const result of levelResults) {
      completed.set(result.agent.title, result.output);
      completedOutputs.push(result);
      for (const file of result.output.files) {
        results.push({
          agent: result.agent.title,
          filename: file.filename,
          summary: file.summary,
          code: file.code,
        });
      }
    }
  }

  return results;
}

function safeRunFilePath(runId, filename) {
  const normalized = normalize(filename).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new GroqError(`Unsafe generated filename: ${filename}`);
  }
  return runFilePath(runId, normalized);
}

async function persistRun({ runId, intent, selectedAgents: agents, plan, results }) {
  const manifest = {
    runId,
    createdAt: new Date().toISOString(),
    prompt: intent,
    selectedAgents: agents.map((agent) => agent.title),
    plan,
    files: results.map(({ agent, filename, summary }) => ({ agent, filename, summary })),
  };

  for (const result of results) {
    await storage.writeText(safeRunFilePath(runId, result.filename), result.code);
  }
  await storage.writeText(runManifestPath(runId), JSON.stringify(manifest, null, 2));
  return manifest;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitFile(emit, agent, output) {
  emit("agent-started", {
    agent: agent.title,
    filename: output.filename,
  });

  const chunkSize = 24;
  for (let index = 0; index < output.code.length; index += chunkSize) {
    emit("file-chunk", {
      agent: agent.title,
      filename: output.filename,
      chunk: output.code.slice(index, index + chunkSize),
    });
    await sleep(22);
  }

  emit("file-completed", {
    agent: agent.title,
    filename: output.filename,
    code: output.code,
    summary: output.summary,
  });
}

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "32mb" }));
app.get("/api/health", (_req, res) => {
  const config = groqConfig();
  const altbot = agentGroqConfig("altbot");
  res.json({
    ok: Boolean(config.apiKey),
    provider: "groq",
    plannerModel: altbot.model,
    workerModel: config.workerModel,
    agentModels: [
      { agent: "Altbot", displayName: "Altbot", model: altbot.model },
      ...listAgentModels(),
    ],
    subagents: true,
    serverVersion: 4,
    githubAuth: githubConfigured(),
    tokenBudget: {
      maxOutputTokens: config.maxOutputTokens,
      requestCharBudget: config.requestCharBudget,
      tpmSafeTotal: config.tpmSafeTotal,
      minGapMs: config.minGapMs,
      mode: "conservative",
    },
    storage: {
      remote: storage.isRemote,
      ephemeral: storage.isEphemeral,
    },
  });
});

app.post("/api/terminal/exec", async (req, res) => {
  try {
    const command = String(req.body?.command || "").trim();
    const runId = String(req.body?.runId || "").trim() || undefined;
    const output = await execTerminalCommand({ command, runId });
    res.json({ output });
  } catch (error) {
    res.status(error instanceof GroqError ? 400 : 500).json({
      error: error instanceof GroqError ? error.message : error.message || "Terminal command failed",
    });
  }
});

app.post("/api/terminal/git", async (req, res) => {
  try {
    const user = await resolveAuthUser(req);
    const command = String(req.body?.command || "").trim();
    const owner = String(req.body?.owner || req.body?.repoOwner || user?.login || "").trim();
    const name = String(req.body?.repoName || req.body?.name || "").trim();
    const filePaths = Array.isArray(req.body?.files) ? req.body.files.map(String) : [];
    const output = await execGitTerminalCommand({
      token: user?.token,
      owner,
      name,
      command,
      filePaths,
    });
    res.json({ output });
  } catch (error) {
    res.status(error instanceof GroqError ? 400 : 500).json({
      error: error instanceof GroqError ? error.message : error.message || "Git command failed",
    });
  }
});

app.get("/api/auth/github", (_req, res) => {
  if (!githubConfigured()) {
    return res.status(503).json({ error: "GitHub OAuth is not configured" });
  }
  const state = createOAuthState();
  res.cookie("oauth_state", oauthStateCookie(state), {
    ...authCookieOptions(),
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(githubAuthorizeUrl(state));
});

app.get("/api/auth/github/callback", async (req, res) => {
  const { appUrl } = authConfig();
  try {
    if (!githubConfigured()) {
      return res.redirect(`${appUrl}/?auth_error=not_configured`);
    }
    const state = String(req.query.state || "");
    if (!verifyOAuthState(state, req.cookies?.oauth_state)) {
      return res.redirect(`${appUrl}/?auth_error=invalid_state`);
    }
    res.clearCookie("oauth_state", { path: "/" });
    const code = String(req.query.code || "");
    if (!code) return res.redirect(`${appUrl}/?auth_error=no_code`);

    const token = await exchangeGitHubCode(code);
    const profile = await fetchGitHubUser(token);
    try {
      await storeGitHubToken(profile.id, token);
    } catch (error) {
      console.warn("[auth] token disk/blob store failed — using cookie fallback", error?.message);
    }

    const cookie = createAuthCookie({
      githubId: profile.id,
      login: profile.login,
      avatar: profile.avatar_url,
      name: profile.name || profile.login,
    });

    res.cookie("open_ide_user", cookie, {
      ...authCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.cookie("open_ide_gh_token", createGitHubTokenCookie(token), {
      ...authCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect(`${appUrl}/?auth=ok&launch=1`);
  } catch (error) {
    console.error("[auth]", error);
    res.redirect(`${appUrl}/?auth_error=${encodeURIComponent(error.message || "oauth_failed")}`);
  }
});

app.get("/api/auth/me", async (req, res) => {
  const user = await resolveAuthUser(req);
  if (!user) return res.json({ authenticated: false, githubConfigured: githubConfigured() });
  res.json({
    authenticated: true,
    githubConfigured: githubConfigured(),
    login: user.login,
    name: user.name,
    avatar: user.avatar,
  });
});

app.post("/api/auth/logout", (_req, res) => {
  const opts = { path: "/" };
  res.clearCookie("open_ide_user", opts);
  res.clearCookie("open_ide_gh_token", opts);
  res.clearCookie("oauth_state", opts);
  res.json({ ok: true });
});

app.get("/api/runs/:runId/download.zip", async (req, res) => {
  try {
    const zipBuffer = await createRunZipBuffer(req.params.runId);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="open-ide-${req.params.runId.slice(0, 8)}.zip"`
    );
    res.send(zipBuffer);
  } catch (error) {
    res.status(500).json({
      error: error instanceof GroqError ? error.message : error.message || "Zip failed",
    });
  }
});

app.post("/api/runs/:runId/preview", async (req, res) => {
  try {
    const preview = await startRunPreview(req.params.runId);
    res.json(preview);
  } catch (error) {
    console.error("[preview]", error);
    res.status(500).json({
      error: error instanceof GroqError ? error.message : error.message || "Preview failed",
    });
  }
});

app.get("/api/github/repos", async (req, res) => {
  try {
    const user = await resolveAuthUser(req);
    if (!user?.token) {
      return res.status(401).json({ error: "Sign in with GitHub first" });
    }
    const repos = await listUserRepos(user.token, {
      perPage: Number(req.query.perPage || 40),
      page: Number(req.query.page || 1),
    });
    res.json({ repos });
  } catch (error) {
    console.error("[github] list-repos", error);
    res.status(500).json({
      error: error instanceof GroqError ? error.message : error.message || "Could not list repos",
    });
  }
});

app.post("/api/github/open-repo", async (req, res) => {
  try {
    const user = await resolveAuthUser(req);
    if (!user?.token) {
      return res.status(401).json({ error: "Sign in with GitHub first" });
    }
    const repoRef = String(req.body?.repoRef || req.body?.fullName || "").trim();
    if (!repoRef) {
      return res.status(400).json({ error: "Repo name or owner/repo is required" });
    }
    const repo = await openGitHubRepo({
      token: user.token,
      login: user.login,
      repoRef,
    });
    res.json(repo);
  } catch (error) {
    console.error("[github] open-repo", error);
    res.status(error?.status === 404 ? 404 : 500).json({
      error: error instanceof GroqError ? error.message : error.message || "Could not open repo",
    });
  }
});

app.post("/api/github/clear-repo", async (req, res) => {
  try {
    const user = await resolveAuthUser(req);
    if (!user?.token) {
      return res.status(401).json({ error: "Sign in with GitHub first" });
    }
    const owner = String(req.body?.owner || req.body?.repoOwner || user.login).trim();
    const name = String(req.body?.repoName || req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Repo name is required" });
    }
    const result = await deleteAllGitHubRepoFiles({
      token: user.token,
      owner,
      name,
    });
    res.json(result);
  } catch (error) {
    console.error("[github] clear-repo", error);
    res.status(error?.status === 404 ? 404 : 500).json({
      error: error instanceof GroqError ? error.message : error.message || "Could not clear repo",
    });
  }
});

app.post("/api/github/repo-files", async (req, res) => {
  try {
    const user = await resolveAuthUser(req);
    if (!user?.token) {
      return res.status(401).json({ error: "Sign in with GitHub first" });
    }
    const owner = String(req.body?.owner || req.body?.repoOwner || user.login).trim();
    const name = String(req.body?.repoName || req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Repo name is required" });
    }
    const result = await loadGitHubRepoFiles({
      token: user.token,
      owner,
      name,
    });
    res.json(result);
  } catch (error) {
    console.error("[github] repo-files", error);
    res.status(error?.status === 404 ? 404 : 500).json({
      error: error instanceof GroqError ? error.message : error.message || "Could not load repo files",
    });
  }
});

app.post("/api/github/create-repo", async (req, res) => {
  try {
    const user = await resolveAuthUser(req);
    if (!user?.token) {
      return res.status(401).json({ error: "Sign in with GitHub first" });
    }
    const repoName = String(req.body?.repoName || "").trim();
    if (!repoName) {
      return res.status(400).json({ error: "Repo name is required" });
    }
    const repo = await createGitHubRepo({
      token: user.token,
      login: user.login,
      repoName,
      description: req.body?.description || "Built with Open IDE",
      isPrivate: Boolean(req.body?.isPrivate),
    });
    res.json(repo);
  } catch (error) {
    console.error("[github] create-repo", error);
    res.status(error?.status === 401 ? 401 : 500).json({
      error: error instanceof GroqError ? error.message : error.message || "Could not create repo",
    });
  }
});

app.post("/api/runs/:runId/push-github", async (req, res) => {
  try {
    const user = await resolveAuthUser(req);
    if (!user?.token) {
      return res.status(401).json({ error: "Sign in with GitHub first" });
    }
    const runId = req.params.runId;
    const manifest = JSON.parse(await storage.readText(runManifestPath(runId)));
    const repoName = String(req.body?.repoName || "").trim();
    if (!repoName) {
      return res.status(400).json({ error: "Create a repo first before pushing code" });
    }
    const result = await pushRunToGitHub({
      token: user.token,
      login: user.login,
      runId,
      prompt: manifest.prompt,
      repoName,
      repoOwner: String(req.body?.repoOwner || user.login).trim(),
    });
    res.json(result);
  } catch (error) {
    console.error("[github]", error);
    res.status(error?.status === 401 ? 401 : 500).json({
      error: error instanceof GroqError ? error.message : error.message || "GitHub push failed",
    });
  }
});

app.get("/api/sessions/:sessionId", async (req, res) => {
  try {
    const session = await loadSession(req.params.sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/sessions/:sessionId", async (req, res) => {
  try {
    const session = await saveSession(req.params.sessionId, req.body || {});
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sessions", async (_req, res) => {
  try {
    const sessionId = createSessionId();
    const session = await saveSession(sessionId, {});
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/runs/:runId/manifest", async (req, res) => {
  try {
    const manifest = await storage.readText(runManifestPath(req.params.runId));
    res.type("application/json").send(manifest);
  } catch {
    res.status(404).json({ error: "Run not found" });
  }
});

app.get("/api/runs/:runId/file", async (req, res) => {
  try {
    const rel = String(req.query.path || "");
    if (!rel) return res.status(400).json({ error: "Missing path query" });
    const code = await storage.readText(safeRunFilePath(req.params.runId, rel));
    res.type("text/plain").send(code);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

app.get("/api/proxy-image", async (req, res) => {
  const rawUrl = String(req.query.url || "");
  if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
    return res.status(400).json({ error: "Invalid image URL" });
  }
  try {
    const upstream = await fetch(rawUrl, {
      headers: { "User-Agent": "OpenIDE/1.0", Accept: "image/*" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Image fetch failed" });
    }
    const type = upstream.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) {
      return res.status(400).json({ error: "Not an image" });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message || "Proxy failed" });
  }
});

async function handleChatSend({ message, target = "altbot", context = {} }) {
  const text = String(message || "").trim();
  if (!text) return null;
  const config = groqConfig();
  const agentName = String(target || "altbot");
  const isAgent = Boolean(AGENTS[agentName]);
  const replyRole = isAgent ? "agent" : "controller";
  const replyAgent = isAgent ? agentName : "Altbot";

  if (!config.apiKey) {
    return {
      role: replyRole,
      agent: replyAgent,
      text: "Groq is not configured. Add GROQ_API_KEY to enable chat.",
    };
  }

  const branchLines = (context.searchBranches || [])
    .map(
      (branch) =>
        `- ${branch.title || branch.id} [${branch.status || "IDLE"}] score=${branch.score ?? "?"} rank=#${branch.rank ?? "?"} strategy=${branch.shortSummary || branch.strategy || ""}`
    )
    .join("\n");
  const fileLines = (context.fileContents || [])
    .map((file) => `// ${file.filename}\n${String(file.code || "").slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 3000);
  const inspoItems = (context.inspoSelection || []).filter((item) => item?.url);
  const inspoTitles = inspoItems.map((item) => item.title || item.id).filter(Boolean).slice(0, 6);
  const inspoLine = inspoTitles.length
    ? `Inspo board (${inspoTitles.length} pinned): ${inspoTitles.join(", ")}. Treat these as the visual direction for UI styling.`
    : "";

  try {
    const provider = agentGroqConfig(isAgent ? agentName : "altbot");
    const chatText = [
      `Respond to this user message directly. Background context is reference only — do not ignore the question.`,
      `User message: ${text}`,
      context.prompt ? `Original build prompt: ${context.prompt}` : "",
      context.planSummary ? `Background plan (only if relevant): ${context.planSummary}` : "",
      context.searchWinner ? `Hyperreasoning winner id: ${context.searchWinner}` : "",
      branchLines ? `Hyperreasoning branches:\n${branchLines}` : "",
      context.files?.length ? `Project files: ${context.files.join(", ")}` : "",
      fileLines ? `Relevant code:\n${fileLines}` : "",
      context.searchLog?.length ? `Search log:\n${context.searchLog.slice(-8).join("\n")}` : "",
      context.selectedAgents?.length ? `Active swarm: ${context.selectedAgents.join(", ")}` : "",
      inspoLine,
    ]
      .filter(Boolean)
      .join("\n\n");

    let userPayload = chatText;
    if (agentName === "Frontend" && inspoItems.length) {
      const inspoImages = await resolveInspoAttachments(inspoItems, { max: 1, maxBytes: 90_000 });
      if (inspoImages.length) {
        userPayload = attachmentContent(chatText, inspoImages, { includeImages: true });
      }
    }

    const reply = await groqText({
      system: isAgent ? agentChatSystem(agentName) : ALTBOT_CHAT_SYSTEM,
      user: userPayload,
      maxTokens: 220,
      temperature: 0.4,
      model: provider.model,
      apiKey: provider.apiKey,
      agentKey: isAgent ? agentName : "altbot",
    });
    return { role: replyRole, agent: replyAgent, text: reply };
  } catch (error) {
    return {
      role: replyRole,
      agent: replyAgent,
      text: error instanceof GroqError ? error.message : "Chat failed unexpectedly.",
    };
  }
}

async function runSwarmGeneration(emit, body = {}) {
  const config = groqConfig();
  const {
    prompt,
    agents: requestedAgents,
    attachments = [],
    inspoSelection = [],
    sessionId,
  } = body;

  const agents = selectedAgents(requestedAgents);
  if (!agents.length) {
    emit("agent-error", { agent: "system", message: "Select at least one agent." });
    return;
  }
  if (!config.apiKey) {
    emit("agent-error", {
      agent: "system",
      message: "GROQ_API_KEY is required. Add it to your environment variables.",
    });
    return;
  }

  const runId = randomUUID();
  const intent = truncateText(String(prompt || "Build an application").trim(), 2800);
  const cleanAttachments = sanitizeAttachments(attachments);
  const inspoItems = (inspoSelection || []).filter((item) => item?.url);
  const inspoSummary = inspoSummaryAttachments(inspoItems);
  const inspoImages = await resolveInspoAttachments(inspoItems, { max: 1, maxBytes: 90_000 });
  const plannerAttachments = [...workerSafeAttachments(cleanAttachments), ...inspoSummary];
  const swarmAttachments = workerSafeAttachments([...cleanAttachments, ...inspoSummary]);

  emit("run-started", { runId });
  emit("controller-started", { provider: "groq" });

  const { plan, winnerId, ranked } = await runHyperreasoning(emit, {
    runId,
    intent,
    agents,
    attachments: plannerAttachments,
    normalizePlan,
  });

  const runnablePlan = ensureRunnablePlan(plan, agents);
  emit("graph-ready", { ...runnablePlan, runId, steps: runnablePlan.steps, summary: runnablePlan.summary });

  const results = await executeSwarm({
    emit,
    intent,
    plan: runnablePlan,
    agents,
    attachments: swarmAttachments,
    inspoImages,
  });

  const manifest = await persistRun({
    runId,
    intent,
    selectedAgents: agents,
    plan,
    results,
  });

  emit("swarm-complete", {
    runId,
    files: manifest.files,
    runPath: runManifestPath(runId).replace("/manifest.json", ""),
    planSummary: plan.summary,
    winnerId,
    ranked,
  });

  if (sessionId) {
    await saveSession(sessionId, {
      runId,
      runPath: runManifestPath(runId).replace("/manifest.json", ""),
      prompt: intent,
      selectedAgents: agents.map((agent) => agent.title),
      stage: "ide",
    });
  }
}

app.post("/api/inspo/search", async (req, res) => {
  const intent = String(req.body?.prompt || "").trim();
  if (!intent) {
    return res.status(400).json({ error: "Enter a prompt before searching for inspiration." });
  }
  try {
    const result = await searchInspiration(intent, 5);
    res.json(result);
  } catch (error) {
    console.error("[inspo]", error);
    res.status(500).json({
      error: error instanceof GroqError ? error.message : "SurfAgent could not find inspiration images.",
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const reply = await handleChatSend(req.body || {});
    if (!reply) return res.status(400).json({ error: "Message required" });
    res.json(reply);
  } catch (error) {
    res.status(500).json({ error: error.message || "Chat failed" });
  }
});

app.post("/api/swarm/generate", async (req, res) => {
  initSse(res);
  const emit = createSseEmitter(res).emit;
  try {
    await runSwarmGeneration(emit, req.body || {});
    sseWrite(res, "done", { ok: true });
  } catch (error) {
    console.error("[swarm]", error);
    const message =
      error instanceof GroqError
        ? error.message
        : error?.message || "The agent run failed unexpectedly.";
    sseWrite(res, "agent-error", { agent: "system", message });
  } finally {
    sseEnd(res);
  }
});

if (!IS_VERCEL && process.env.NODE_ENV === "production") {
  app.use(express.static(join(ROOT_DIR, "dist")));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(ROOT_DIR, "dist", "index.html"));
  });
}

export const config = {
  maxDuration: 300,
};

export default app;

if (!IS_VERCEL) {
  const httpServer = createServer(app);
  httpServer.listen(PORT, () => {
    const { apiKey, plannerModel, workerModel } = groqConfig();
    console.log(`Open IDE server :${PORT} (provider=groq)`);
    if (!apiKey) console.warn("WARN: GROQ_API_KEY missing — add it to .env");
    else console.log(`Models: planner=${plannerModel} worker=${workerModel}`);
  });
}
