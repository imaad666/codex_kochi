import { storage } from "./storage.js";
import { listRunFilesRecursive, runFilePath, runManifestPath } from "./runFiles.js";

async function githubFetch(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "OpenIDE",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || `GitHub API ${res.status}`;
    throw new GroqError(message, res.status);
  }
  return data;
}

export function slugifyRepoName(text) {
  return String(text || "open-ide-project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "open-ide-project";
}

export async function listUserRepos(token, { perPage = 40, page = 1 } = {}) {
  const repos = await githubFetch(
    `/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    { token }
  );
  return (Array.isArray(repos) ? repos : []).map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    owner: repo.owner?.login,
    private: Boolean(repo.private),
    updatedAt: repo.updated_at,
  }));
}

export async function openGitHubRepo({ token, login, repoRef }) {
  const raw = String(repoRef || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/$/, "");
  if (!raw) throw new GroqError("Enter a repo name or owner/repo");

  let owner = login;
  let name = raw;
  if (raw.includes("/")) {
    const parts = raw.split("/").filter(Boolean);
    owner = parts[0];
    name = parts[1];
  }

  const repo = await githubFetch(`/repos/${owner}/${name}`, { token });
  if (repo.permissions && repo.permissions.push === false) {
    throw new GroqError("You do not have push access to this repository");
  }

  return {
    name: repo.name,
    fullName: repo.full_name || `${owner}/${name}`,
    url: repo.html_url || `https://github.com/${owner}/${name}`,
    owner: repo.owner?.login || owner,
    source: "existing",
  };
}

export async function createGitHubRepo({ token, login, repoName, description, isPrivate = false }) {
  const name = slugifyRepoName(repoName);
  const repo = await githubFetch("/user/repos", {
    token,
    method: "POST",
    body: {
      name,
      description: description || "Built with Open IDE",
      private: Boolean(isPrivate),
      auto_init: true,
    },
  });
  return {
    name: repo.name,
    fullName: repo.full_name || `${login}/${name}`,
    url: repo.html_url || `https://github.com/${login}/${name}`,
    owner: repo.owner?.login || login,
    source: "created",
  };
}

export async function pushRunToGitHub({ token, login, runId, prompt, repoName, repoOwner }) {
  const manifest = JSON.parse(await storage.readText(runManifestPath(runId)));
  const files = await listRunFilesRecursive(runId);
  if (!files.length) throw new GroqError("No generated files to push");

  const owner = repoOwner || login;
  const name = repoName || slugifyRepoName(prompt || manifest.prompt);
  const repo = await githubFetch(`/repos/${owner}/${name}`, { token });
  const repoSlug = repo.name || name;

  for (const file of files) {
    let sha;
    try {
      const existing = await githubFetch(`/repos/${owner}/${repoSlug}/contents/${file.path}`, {
        token,
      });
      sha = existing.sha;
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    await githubFetch(`/repos/${owner}/${repoSlug}/contents/${file.path}`, {
      token,
      method: "PUT",
      body: {
        message: `Open IDE: update ${file.path}`,
        content: Buffer.from(file.content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      },
    });
  }

  return {
    url: repo.html_url || `https://github.com/${owner}/${repoSlug}`,
    repo: `${owner}/${repoSlug}`,
    files: files.map((f) => f.path),
  };
}
