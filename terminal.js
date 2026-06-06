import { exec } from "child_process";
import { promisify } from "util";
import { GroqError } from "./groq.js";
import { dataPath, storage } from "./storage.js";
import { listRunFilesRecursive } from "./runFiles.js";

const execAsync = promisify(exec);

const ALLOWED = new Set(["npm", "node", "npx", "git", "echo", "which"]);

async function materializeRunWorkspace(runId) {
  const workDir = dataPath("terminal-workspaces", runId);
  const files = await listRunFilesRecursive(runId);
  for (const file of files) {
    await storage.writeText(dataPath("terminal-workspaces", runId, file.path), file.content);
  }
  return workDir;
}

export async function execTerminalCommand({ command, runId, rootDir }) {
  if (process.env.VERCEL) {
    throw new GroqError(
      "Shell execution is not available on cloud deploy. Use local dev (npm run dev) for npm/node commands."
    );
  }

  const trimmed = String(command || "").trim();
  if (!trimmed) throw new GroqError("Empty command");

  const bin = trimmed.split(/\s+/)[0];
  if (!ALLOWED.has(bin)) {
    throw new GroqError(`Command not allowed: ${bin}. Allowed: ${[...ALLOWED].join(", ")}`);
  }

  let cwd = rootDir || process.cwd();
  if (runId) {
    cwd = await materializeRunWorkspace(runId);
  }

  try {
    const { stdout, stderr } = await execAsync(trimmed, {
      cwd,
      timeout: 120_000,
      maxBuffer: 512_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return [stdout, stderr].filter(Boolean).join("\n").trim();
  } catch (error) {
    const out = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    throw new GroqError(out || error.message || "Command failed");
  }
}
