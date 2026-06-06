export function isGreeting(message) {
  const text = String(message || "").trim();
  return /^(hi|hello|hey|howdy|yo|sup|what'?s up|gm)[\s!.?]*$/i.test(text);
}

export function greetingReply(agentKey, { files = [], fileSystem = {} } = {}) {
  const mine = files.filter((name) => {
    const entry = fileSystem[name];
    if (!entry?.agent) return false;
    const agent = String(entry.agent).toLowerCase();
    if (agentKey === "backend") return agent === "backend";
    if (agentKey === "frontend") return agent === "frontend";
    if (agentKey === "database") return agent === "database";
    return false;
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

  const wantsDelete =
    /\b(delete|clear|wipe|remove|reset|empty|nuke|purge|trash)\b/.test(text) &&
    (/\b(everything|all|repo|files?|workspace|project|generated|session|output|build)\b/.test(text) ||
      /\bdelete\s+everything\b/.test(text) ||
      /^clear\s*!*\.?$/i.test(message.trim()));

  if (wantsDelete) {
    return { type: "clear-workspace" };
  }

  if (/^(push|push\s+to\s+(github|repo|remote))[\s!.]*$/i.test(text) || /\bpush\s+(changes|code|files)\b/i.test(text)) {
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

export const CLEAR_WORKSPACE_REPLY =
  "Cleared all generated files from this IDE session. Your remote GitHub repo is unchanged — nothing was pushed or deleted on GitHub.";
