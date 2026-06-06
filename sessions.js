import { randomUUID } from "crypto";
import { dataPath, storage } from "./storage.js";

const saveQueues = new Map();

const DEFAULT_SESSION = {
  stage: "intro",
  prompt: "",
  githubRepo: null,
  selectedAgents: ["Frontend", "Backend"],
  attachments: [],
  inspoCandidates: [],
  inspoSelectedIds: [],
  inspoMood: "",
  chatMessages: [],
  searchLog: [],
  searchWinner: null,
  searchVerdict: null,
  searchComparisons: [],
  searchSavings: null,
  searchGraphData: { branches: [], edges: [], bestPath: [] },
  planSummary: "",
  planSteps: [],
  localOnly: false,
  runId: null,
  runPath: null,
  fileSystem: {},
  removedPaths: [],
  activeFile: null,
  searchPhase: "idle",
  resumeDismissed: false,
};

function slimInspoCandidates(candidates = []) {
  return candidates.slice(0, 12).map((item) => {
    const url = String(item.url || "");
    const thumbUrl = String(item.thumbUrl || item.url || "");
    return {
      id: item.id,
      title: String(item.title || "").slice(0, 120),
      url: url.startsWith("data:image/") ? url.slice(0, 140_000) : url,
      thumbUrl: thumbUrl.startsWith("data:image/") ? thumbUrl.slice(0, 140_000) : thumbUrl,
      source: item.source,
      query: item.query,
    };
  });
}

function slimAttachments(attachments = []) {
  return attachments.slice(0, 6).map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    size: item.size,
    kind: item.kind,
    content: item.kind === "text" ? String(item.content || "").slice(0, 2000) : "",
  }));
}

function isNoiseChatMessage(message = {}) {
  const text = String(message.text || "");
  return /session save failed/i.test(text);
}

function slimChatMessages(messages = []) {
  return messages.filter((message) => !isNoiseChatMessage(message)).slice(-40);
}

function slimFileSystem(fileSystem = {}, removedPaths = []) {
  const removed = new Set(removedPaths);
  const slim = {};
  for (const [filename, entry] of Object.entries(fileSystem)) {
    if (removed.has(filename)) continue;
    slim[filename] = {
      agent: entry?.agent,
      filename: entry?.filename || filename,
      status: entry?.status,
      summary: String(entry?.summary || "").slice(0, 240),
      code: String(entry?.code || "").slice(0, 64_000),
    };
  }
  return slim;
}

export function sanitizeSessionPatch(patch = {}) {
  const next = { ...patch };
  if (next.inspoCandidates) next.inspoCandidates = slimInspoCandidates(next.inspoCandidates);
  if (next.attachments) next.attachments = slimAttachments(next.attachments);
  if (next.fileSystem) {
    next.fileSystem = slimFileSystem(next.fileSystem, next.removedPaths || patch.removedPaths || []);
  }
  if (next.removedPaths) next.removedPaths = [...new Set(next.removedPaths)].slice(0, 64);
  if (next.chatMessages) next.chatMessages = slimChatMessages(next.chatMessages);
  if (next.searchLog) next.searchLog = next.searchLog.slice(-30);
  if (next.searchGraphData?.branches) {
    next.searchGraphData = {
      branches: next.searchGraphData.branches.slice(0, 12),
      edges: (next.searchGraphData.edges || []).slice(0, 24),
      bestPath: (next.searchGraphData.bestPath || []).slice(0, 12),
    };
  }
  if (next.planSteps) next.planSteps = next.planSteps.slice(0, 8);
  return next;
}

function sessionPath(sessionId) {
  return dataPath("sessions", `${sessionId}.json`);
}

export async function ensureSessionsDir() {
  // no-op — storage handles mkdir on write
}

export async function loadSession(sessionId) {
  const path = sessionPath(sessionId);
  try {
    const raw = await storage.readText(path);
    const data = JSON.parse(raw);
    if (data.chatMessages) data.chatMessages = slimChatMessages(data.chatMessages);
    return { sessionId, ...DEFAULT_SESSION, ...data };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { sessionId, ...DEFAULT_SESSION, createdAt: new Date().toISOString() };
    }
    if (error instanceof SyntaxError) {
      console.warn(`[sessions] corrupt file for ${sessionId}, resetting`);
      const fresh = { sessionId, ...DEFAULT_SESSION, createdAt: new Date().toISOString() };
      await storage.writeText(path, JSON.stringify(fresh, null, 2));
      return fresh;
    }
    throw error;
  }
}

async function saveSessionInner(sessionId, patch = {}) {
  const existing = await loadSession(sessionId);
  const next = {
    ...existing,
    ...sanitizeSessionPatch(patch),
    sessionId,
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
  const path = sessionPath(sessionId);
  await storage.writeText(path, JSON.stringify(next, null, 2));
  return next;
}

export async function saveSession(sessionId, patch = {}) {
  const previous = saveQueues.get(sessionId) || Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(() => saveSessionInner(sessionId, patch));
  saveQueues.set(sessionId, operation);
  try {
    return await operation;
  } finally {
    if (saveQueues.get(sessionId) === operation) saveQueues.delete(sessionId);
  }
}

export function createSessionId() {
  return randomUUID();
}

export async function listSessions(limit = 20) {
  const prefix = dataPath("sessions");
  const files = await storage.listFiles(prefix.endsWith("/") ? prefix : `${prefix}/`);
  const sessions = [];
  for (const file of files.filter((f) => f.path.endsWith(".json")).slice(0, limit)) {
    try {
      const raw = await storage.readText(file.pathname || `${prefix}/${file.path}`);
      const data = JSON.parse(raw);
      sessions.push({
        sessionId: data.sessionId || file.path.replace(/\.json$/, ""),
        updatedAt: data.updatedAt,
        prompt: data.prompt,
        stage: data.stage,
        runId: data.runId,
      });
    } catch {
      // skip corrupt session files
    }
  }
  return sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
