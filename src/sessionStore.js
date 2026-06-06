const SESSION_KEY = "open-ide-session-id";

export function getOrCreateSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function resetSessionId() {
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

export async function fetchSession(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function persistSession(sessionId, patch) {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  return res.json();
}

export function proxyImageUrl(url) {
  if (!url) return "";
  if (String(url).startsWith("data:") || String(url).startsWith("blob:")) return url;
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

export function hydrateFileSystemFromSession(fileSystem = {}, removedPaths = []) {
  const removed = new Set(removedPaths);
  const next = {};
  for (const [filename, entry] of Object.entries(fileSystem || {})) {
    if (removed.has(filename)) continue;
    if (!entry?.code && !entry?.codeLength) continue;
    next[filename] = {
      code: String(entry.code || ""),
      agent: entry.agent || "GitHub",
      filename: entry.filename || filename,
      status: entry.status || "complete",
      summary: entry.summary || "",
    };
  }
  return next;
}

export async function loadRunFiles(runId, manifest) {
  const fileSystem = {};
  for (const file of manifest.files || []) {
    try {
      const res = await fetch(
        `/api/runs/${runId}/file?path=${encodeURIComponent(file.filename)}`
      );
      if (!res.ok) continue;
      const code = await res.text();
      fileSystem[file.filename] = {
        code,
        agent: file.agent,
        filename: file.filename,
        status: "complete",
        summary: file.summary,
      };
    } catch {
      // skip missing files
    }
  }
  return fileSystem;
}
