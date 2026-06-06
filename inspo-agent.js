import { createHash } from "crypto";
import { agentGroqConfig, groqJson, GroqError } from "./groq.js";

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: { type: "string" },
    },
    mood: { type: "string" },
  },
  required: ["queries", "mood"],
  additionalProperties: false,
};

function imageId(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

async function groqSearchQueries(prompt) {
  const provider = agentGroqConfig("altbot");
  const result = await groqJson({
    name: "open_ide_inspo_queries",
    schema: QUERY_SCHEMA,
    model: provider.model,
    apiKey: provider.apiKey,
    agentKey: "altbot",
    temperature: 0.4,
    system:
      "You are SurfAgent, a visual inspiration scout. Return short image search queries (2-4 words each) for UI/product inspiration based on the user's build prompt.",
    user: `Build prompt: ${prompt}\nReturn diverse visual search queries (interfaces, palettes, layouts, product shots).`,
  });
  return {
    queries: (result.queries || []).map((q) => String(q).trim()).filter(Boolean),
    mood: String(result.mood || "visual inspiration"),
  };
}

function fallbackQueries(prompt) {
  const words = String(prompt || "app ui design")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  const base = words.join(" ") || "app ui design";
  return {
    queries: [`${base} ui`, `${base} interface`, `${base} design`],
    mood: "web inspiration",
  };
}

async function ddgVqd(query) {
  const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "OpenIDE/1.0" },
  });
  const html = await res.text();
  const match = html.match(/vqd=['"]([^'"]+)['"]/);
  return match?.[1] || null;
}

async function ddgImages(query, limit = 3) {
  const vqd = await ddgVqd(query);
  if (!vqd) return [];
  const url = new URL("https://duckduckgo.com/i.js");
  url.searchParams.set("q", query);
  url.searchParams.set("o", "json");
  url.searchParams.set("vqd", vqd);
  url.searchParams.set("f", ",,,,,");
  const res = await fetch(url, { headers: { "User-Agent": "OpenIDE/1.0" } });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data.results || []).slice(0, limit).map((item) => ({
    id: imageId(item.image),
    url: item.image,
    thumbUrl: item.thumbnail,
    title: String(item.title || query).slice(0, 120),
    source: String(item.source || "web").slice(0, 80),
    query,
  }));
}

export async function searchInspiration(prompt, count = 5) {
  let queries;
  let mood;
  try {
    ({ queries, mood } = await groqSearchQueries(prompt));
  } catch {
    ({ queries, mood } = fallbackQueries(prompt));
  }

  const perQuery = Math.max(1, Math.ceil(count / queries.length));
  const seen = new Set();
  const images = [];

  for (const query of queries) {
    const batch = await ddgImages(query, perQuery);
    for (const img of batch) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      images.push(img);
      if (images.length >= count) break;
    }
    if (images.length >= count) break;
  }

  return { mood, queries, images: images.slice(0, count) };
}

export async function fetchImageAsDataUrl(url, maxBytes = 4_500_000) {
  const res = await fetch(url, {
    headers: { "User-Agent": "OpenIDE/1.0", Accept: "image/*" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new GroqError(`Failed to fetch inspiration image (${res.status})`);
  }
  const type = res.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) {
    throw new GroqError("Inspiration URL did not return an image");
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new GroqError("Inspiration image too large");
  }
  const dataUrl = `data:${type};base64,${buffer.toString("base64")}`;
  return { dataUrl, type, size: buffer.length };
}

export async function inspoToAttachments(selected = []) {
  const attachments = [];
  for (const item of selected.slice(0, 5)) {
    try {
      const { dataUrl, type, size } = await fetchImageAsDataUrl(item.url);
      attachments.push({
        id: `inspo-${item.id}`,
        name: `inspo-${item.title || item.id}.jpg`,
        type,
        size,
        kind: "image",
        content: "",
        dataUrl,
        source: "inspo",
        inspoUrl: item.url,
      });
    } catch (error) {
      console.warn("[inspo] skip image", item.url, error.message);
    }
  }
  return attachments;
}
