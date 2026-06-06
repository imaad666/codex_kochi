import { GroqError } from "./groq.js";
import { storage } from "./storage.js";
import { listRunFilesRecursive, runFilePath, runManifestPath } from "./runFiles.js";

const SKIP_PATH =
  /(?:^|\/)(?:node_modules|dist|build|\.git|\.next|coverage|\.open-ide|vendor|__pycache__)(?:\/|$)/;
const SKIP_FILE = /(?:^|\/)\.env(?:\.|$)/;
const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp4|zip|pdf|exe|dll|so|dylib|lock)$/i;
const MAX_REPO_FILES = 120;
const MAX_FILE_BYTES = 150_000;
const FETCH_CONCURRENCY = 12;

function filePriority(path) {
  const name = String(path || "");
  if (name === "package.json" || name === "README.md") return 0;
  if (/^(server|index|main)\.(js|ts|mjs|cjs)$/i.test(name.split("/").pop() || "")) return 1;
  if (/^src\//i.test(name) || /^app\//i.test(name)) return 2;
  if (/\.(jsx?|tsx?|vue|svelte|py|go|rs|sql|css|html|json|md|yaml|yml|toml|env\.example)$/i.test(name)) return 3;
  return 4;
}

async function resolveBranchTreeSha(token, owner, name, branch) {
  try {
    const branchMeta = await githubFetch(
      `/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`,
      { token }
    );
    return branchMeta?.commit?.commit?.tree?.sha || null;
  } catch {
    return null;
  }
}

async function fetchRepoFile(token, owner, name, branch, path) {
  const meta = await githubFetch(
    `/repos/${owner}/${name}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(branch)}`,
    { token }
  );
  if (Array.isArray(meta) || meta.type !== "file" || !meta.content) return null;
  const raw = Buffer.from(String(meta.content).replace(/\n/g, ""), "base64");
  if (raw.length > MAX_FILE_BYTES) return null;
  const content = raw.toString("utf8");
  if (content.includes("\0")) return null;
  return { path, content, size: raw.length };
}

async function mapPool(items, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        const value = await worker(items[current], current);
        if (value) results.push(value);
      } catch {
        // skip unreadable paths
      }
    }
  });
  await Promise.all(runners);
  return results;
}

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
    defaultBranch: repo.default_branch || "main",
  };
}

function encodeRepoPath(path) {
  return String(path)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

/** Fetch readable text files from a GitHub repo into IDE fileSystem shape. */
export async function loadGitHubRepoFiles({
  token,
  owner,
  name,
  maxFiles = MAX_REPO_FILES,
} = {}) {
  const repo = await githubFetch(`/repos/${owner}/${name}`, { token });
  const branch = repo.default_branch || "main";
  const treeSha = (await resolveBranchTreeSha(token, owner, name, branch)) || branch;
  const tree = await githubFetch(
    `/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`,
    { token }
  );

  const candidates = (tree.tree || [])
    .filter((item) => item.type === "blob" && item.path)
    .filter((item) => !SKIP_PATH.test(item.path) && !SKIP_FILE.test(item.path))
    .filter((item) => !SKIP_EXT.test(item.path))
    .filter((item) => (item.size ?? 0) <= MAX_FILE_BYTES)
    .sort((a, b) => {
      const rank = filePriority(a.path) - filePriority(b.path);
      if (rank !== 0) return rank;
      return String(a.path).localeCompare(String(b.path));
    })
    .slice(0, maxFiles);

  const files = await mapPool(candidates, FETCH_CONCURRENCY, (item) =>
    fetchRepoFile(token, owner, name, branch, item.path)
  );

  return {
    owner,
    name,
    branch,
    fullName: repo.full_name || `${owner}/${name}`,
    files,
    truncated: Boolean(tree.truncated),
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

/** Delete all tracked files from a GitHub repo branch (one commit per file). */
export async function deleteAllGitHubRepoFiles({
  token,
  owner,
  name,
  maxFiles = 500,
} = {}) {
  const repo = await githubFetch(`/repos/${owner}/${name}`, { token });
  const branch = repo.default_branch || "main";
  const tree = await githubFetch(
    `/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { token }
  );

  const blobs = (tree.tree || [])
    .filter((item) => item.type === "blob" && item.path)
    .slice(0, maxFiles);

  let deleted = 0;
  for (const item of blobs) {
    try {
      let sha = item.sha;
      try {
        const meta = await githubFetch(
          `/repos/${owner}/${name}/contents/${encodeRepoPath(item.path)}?ref=${encodeURIComponent(branch)}`,
          { token }
        );
        if (!Array.isArray(meta) && meta.sha) sha = meta.sha;
      } catch {
        // fall back to tree sha
      }

      await githubFetch(`/repos/${owner}/${name}/contents/${encodeRepoPath(item.path)}`, {
        token,
        method: "DELETE",
        body: {
          message: `Open IDE: remove ${item.path}`,
          sha,
          branch,
        },
      });
      deleted += 1;
    } catch {
      // skip paths we cannot delete (permissions, stale sha, etc.)
    }
  }

  return {
    owner,
    name,
    branch,
    fullName: repo.full_name || `${owner}/${name}`,
    url: repo.html_url || `https://github.com/${owner}/${name}`,
    deleted,
    total: blobs.length,
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

/** Git commands via GitHub API — works on Vercel without a local .git directory. */
export async function execGitTerminalCommand({
  token,
  owner,
  name,
  command,
  filePaths = [],
} = {}) {
  const trimmed = String(command || "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts[0] !== "git") throw new GroqError("Not a git command");

  const sub = parts[1];
  if (sub === "--version") {
    return "git version 2.43.0 (Open IDE · GitHub API)";
  }

  if (!owner || !name) {
    throw new GroqError("Link a GitHub repo first (repo step), then retry git commands.");
  }
  if (!token) {
    throw new GroqError("Sign in with GitHub to use git commands.");
  }

  const repo = await githubFetch(`/repos/${owner}/${name}`, { token });
  const branch = repo.default_branch || "main";
  const remote = `https://github.com/${owner}/${name}.git`;

  if (!sub || sub === "status") {
    const lines = [
      `On branch ${branch}`,
      `Your branch is up to date with 'origin/${branch}'.`,
      "",
    ];
    if (filePaths.length) {
      lines.push("Changes in workspace (not yet pushed):");
      for (const filePath of filePaths) {
        lines.push(`        modified:   ${filePath}`);
      }
      lines.push("");
      lines.push(`Use Push in the toolbar or tell Altbot "push" to sync ${filePaths.length} file(s).`);
    } else {
      lines.push("nothing to commit, working tree clean");
    }
    return lines.join("\n");
  }

  if (sub === "remote") {
    if (parts.includes("-v")) {
      return `origin\t${remote} (fetch)\norigin\t${remote} (push)`;
    }
    return "origin";
  }

  if (sub === "branch") {
    if (parts.includes("-a")) {
      return `* ${branch}\n  remotes/origin/${branch}`;
    }
    return `* ${branch}`;
  }

  if (sub === "log") {
    let count = 5;
    const nIndex = parts.indexOf("-n");
    if (nIndex >= 0 && parts[nIndex + 1]) count = Math.min(20, Number(parts[nIndex + 1]) || 5);
    if (parts.includes("-1")) count = 1;
    const commits = await githubFetch(
      `/repos/${owner}/${name}/commits?sha=${encodeURIComponent(branch)}&per_page=${count}`,
      { token }
    );
    if (!Array.isArray(commits) || !commits.length) return "(no commits)";
    return commits
      .map((commit) => {
        const sha = commit.sha?.slice(0, 7) || "???????";
        const msg = commit.commit?.message?.split("\n")[0] || "";
        const author = commit.commit?.author?.name || commit.author?.login || "";
        return `${sha} ${msg}${author ? ` (${author})` : ""}`;
      })
      .join("\n");
  }

  if (sub === "push") {
    return [
      "git push is handled by Open IDE — use the Push button in the title bar",
      "or tell Altbot: push",
    ].join("\n");
  }

  if (sub === "pull") {
    return "git pull is not available in the cloud IDE. Reload the repo from the repo step to refresh files from GitHub.";
  }

  if (sub === "clone") {
    return `Repository already linked: ${owner}/${name}\n${remote}`;
  }

  if (sub === "diff" || sub === "show") {
    return "git diff/show are not available in the cloud terminal. Open files in the editor to inspect changes.";
  }

  throw new GroqError(
    `git ${sub} is not supported here. Try: status, log, branch, remote -v, push`
  );
}
