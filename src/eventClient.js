async function readSseStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      if (!part.trim()) continue;
      let event = "message";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        onEvent(event, JSON.parse(data));
      } catch {
        onEvent(event, data);
      }
    }
  }
}

export async function streamSwarmGenerate(body, handlers = {}) {
  const response = await fetch("/api/swarm/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Swarm failed (${response.status})`);
  }

  await readSseStream(response, (event, data) => {
    if (event === "done") return;
    handlers[event]?.(data);
  });
}

export async function searchInspiration(prompt) {
  const response = await fetch("/api/inspo/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ prompt }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Inspiration search failed");
  return data;
}

export async function postChat(body) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Chat failed");
  return data;
}

export async function syncSession(sessionId, patch) {
  const response = await fetch(`/api/sessions/${sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Session save failed");
  }
  return response.json();
}
