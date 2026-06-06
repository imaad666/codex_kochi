/** Resolve owner/name from saved repo records (fullName, url, etc.). */
export function parseRepoIdentity(input, fallbackLogin = "") {
  const source = typeof input === "string" ? { fullName: input } : input || {};
  let owner = String(source.owner || source.repoOwner || "").trim();
  let name = String(source.name || source.repoName || "").trim();
  const fullName = String(source.fullName || "").trim();

  if ((!owner || !name) && fullName.includes("/")) {
    const [o, n] = fullName.split("/").filter(Boolean);
    owner = owner || o || "";
    name = name || n || "";
  }
  if ((!owner || !name) && source.url) {
    const match = String(source.url).match(/github\.com\/([^/]+)\/([^/.]+)/i);
    if (match) {
      owner = owner || match[1];
      name = name || match[2];
    }
  }
  if (!owner) owner = String(fallbackLogin || "").trim();

  return {
    ...source,
    owner,
    name,
    fullName: fullName || (owner && name ? `${owner}/${name}` : ""),
    source: source.source || "existing",
  };
}

/** User-facing prompt — strip internal swarm file-list wrapper. */
export function sessionPromptPreview(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) return "";
  const match = text.match(/^Existing project files:[\s\S]*?\n\nChange request:\s*([\s\S]*)$/i);
  return (match ? match[1] : text).trim();
}
