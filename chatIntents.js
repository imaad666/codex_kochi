export function agentMatchesFile(agentField, targetId) {
  const agent = String(agentField || "").toLowerCase();
  const target = String(targetId || "").toLowerCase();
  if (target === "altbot") return true;
  if (target === "backend") return agent === "backend";
  if (target === "frontend") return agent === "frontend";
  if (target === "database") return agent === "database";
  return agent === target;
}

/** Files to attach for agent chat — case-insensitive agent match + a few cross-lane hints. */
export function pickChatFileContents(
  fileSystem = {},
  targetId,
  { maxFiles = 3, maxCharsPerFile = 1800 } = {}
) {
  const entries = Object.entries(fileSystem);
  const target = String(targetId || "").toLowerCase();
  const seen = new Set();
  const picked = [];

  const push = (filename, entry) => {
    if (!filename || seen.has(filename) || picked.length >= maxFiles) return;
    seen.add(filename);
    picked.push({
      filename,
      code: String(entry?.code || "").slice(0, maxCharsPerFile),
    });
  };

  for (const [filename, entry] of entries) {
    if (agentMatchesFile(entry?.agent, targetId)) push(filename, entry);
  }

  if (target === "backend") {
    for (const [filename, entry] of entries) {
      if (/server\.js|route|controller|middleware/i.test(filename)) push(filename, entry);
    }
    for (const [filename, entry] of entries) {
      if (/App\.jsx|index\.html|page/i.test(filename)) push(filename, entry);
    }
  } else if (target === "frontend") {
    for (const [filename, entry] of entries) {
      if (/App\.jsx|\.tsx|\.css|component|index\.html/i.test(filename)) push(filename, entry);
    }
  } else if (target === "database") {
    for (const [filename, entry] of entries) {
      if (/\.sql|schema|migration|seed/i.test(filename)) push(filename, entry);
    }
  }

  return picked;
}

export function isGreeting(message) {
  const text = String(message || "").trim();
  return /^(hi|hello|hey|howdy|yo|sup|what'?s up|gm)[\s!.?]*$/i.test(text);
}

export function greetingReply(agentKey, { files = [], fileSystem = {} } = {}) {
  const mine = files.filter((name) => {
    const entry = fileSystem[name];
    return entry?.agent && agentMatchesFile(entry.agent, agentKey);
  });

  const fileHint = mine.length ? ` I'm looking at ${mine.join(", ")}.` : files.length ? "" : " No files in session yet — run a swarm first.";

  const lines = {
    altbot:
      "Altbot online — I run hyperreasoning and orchestrate the swarm. Ask about the winning plan, or say push, download, or clear." +
      (files.length ? ` Session has ${files.length} file(s).` : " Session is empty."),
    backend:
      `Jobalyser on backend duty — APIs, server.js, routes, middleware.${fileHint} Ask me to explain or change the server layer.`,
    frontend:
      `Ives UI on the frontend lane — React, layout, components.${fileHint} Ask me about UI structure or styling.`,
    database:
      `WzData on data — schemas, migrations, contracts.${fileHint} Ask me about tables, indexes, or SQL.`,
  };

  return lines[agentKey] || lines.altbot;
}

/** Detect actionable chat intents — handled without calling the LLM. */
export function matchChatIntent(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return null;

  const mentionsRemote =
    /\b(repo|github|remote)\b/.test(text) || /\bfrom\s+the\s+repo\b/.test(text);

  const wantsDelete =
    /\b(delete|clear|wipe|remove|reset|empty|nuke|purge|trash)\b/.test(text) &&
    (/\b(everything|all|files?|contents?|workspace|project|generated|session|output|build)\b/.test(text) ||
      /\bdelete\s+everything\b/.test(text) ||
      /^clear\s*!*\.?$/i.test(message.trim()));

  if (wantsDelete && mentionsRemote) {
    return { type: "clear-github-repo" };
  }

  if (wantsDelete) {
    return { type: "clear-workspace" };
  }

  if (
    /^(push|pusj|push\s+to\s+(github|repo|remote))[\s!.]*$/i.test(text) ||
    /\bpush\s+(changes|code|files)\b/i.test(text)
  ) {
    return { type: "push" };
  }

  if (/^(download|zip|download\s+zip)[\s!.]*$/i.test(text) || /\bdownload\s+(zip|project|files)\b/i.test(text)) {
    return { type: "download" };
  }

  if (/^(run|preview|run\s+preview)[\s!.]*$/i.test(text) || /\brun\s+(preview|server|locally)\b/i.test(text)) {
    return { type: "run-preview" };
  }

  return null;
}

/** Detect messages that should trigger a code swarm (when not in explicit Code mode). */
export function looksLikeCodeRequest(message) {
  const text = String(message || "").trim().toLowerCase();
  if (text.length < 8) return false;
  return (
    /\b(build|create|add|implement|fix|update|change|refactor|rewrite|generate|make|write|code)\b/.test(text) ||
    /\b(api|component|page|route|schema|endpoint|ui|feature)\b/.test(text)
  );
}

export const CLEAR_WORKSPACE_REPLY =
  "Cleared all generated files from this IDE session. Your remote GitHub repo is unchanged — nothing was pushed or deleted on GitHub.";

export const CLEAR_GITHUB_REPO_REPLY = (fullName, deleted) =>
  `Deleted ${deleted} file(s) from ${fullName} on GitHub and cleared the local workspace.`;
