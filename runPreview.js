import { spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { GroqError } from "./groq.js";
import { listRunFilesRecursive } from "./runFiles.js";

const PREVIEW_DIR = ".open-ide/previews";
const activePreviews = new Map();

const DEFAULT_PACKAGE = {
  name: "open-ide-preview",
  private: true,
  type: "commonjs",
  dependencies: {
    express: "^4.21.2",
    cors: "^2.8.5",
    "body-parser": "^1.20.3",
  },
};

function runCommand(cmd, args, { cwd, timeoutMs = 120_000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new GroqError(`Preview timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new GroqError(stderr || stdout || `Command failed (${code})`));
    });
  });
}


function patchServerPort(code) {
  if (/process\.env\.PORT/.test(code)) return code;
  return code.replace(/const\s+PORT\s*=\s*\d+/g, "const PORT = process.env.PORT || 5000");
}

export async function startRunPreview(runId) {
  if (process.env.VERCEL) {
    throw new GroqError(
      "Live preview is not available on cloud deploy. Download the zip and run locally with npm install && node server.js"
    );
  }

  const files = await listRunFilesRecursive(runId);
  const serverFile = files.find((file) => file.path === "server.js");
  if (!serverFile) {
    throw new GroqError("No server.js in this run — preview needs a backend file");
  }
  let serverCode = serverFile.content;

  for (const [, preview] of activePreviews) {
    try {
      preview.child?.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  activePreviews.clear();

  const previewId = randomUUID();
  const workDir = join(PREVIEW_DIR, previewId);
  await mkdir(workDir, { recursive: true });
  for (const file of files) {
    const dest = join(workDir, file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.content, "utf8");
  }
  await writeFile(join(workDir, "package.json"), JSON.stringify(DEFAULT_PACKAGE, null, 2), "utf8");
  await writeFile(join(workDir, "server.js"), patchServerPort(serverCode), "utf8");

  await runCommand("npm", ["install", "--omit=dev"], { cwd: workDir, timeoutMs: 90_000 });

  const port = 4500 + Math.floor(Math.random() * 500);
  const child = spawn("node", ["server.js"], {
    cwd: workDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let bootLog = "";
  const booted = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new GroqError(`Server did not start in time.\n${bootLog.slice(-800)}`));
    }, 12_000);

    const onData = (chunk) => {
      bootLog += chunk.toString();
      if (/listening|started|running|port/i.test(bootLog)) {
        clearTimeout(timer);
        resolve(true);
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new GroqError(bootLog || `Preview server exited (${code})`));
      }
    });

    setTimeout(() => {
      clearTimeout(timer);
      resolve(true);
    }, 2500);
  });

  if (!booted) throw new GroqError("Preview failed to boot");

  const preview = {
    previewId,
    port,
    url: `http://localhost:${port}`,
    child,
    workDir,
  };
  activePreviews.set(previewId, preview);

  child.on("close", () => {
    activePreviews.delete(previewId);
  });

  return {
    previewId,
    port,
    url: preview.url,
    log: bootLog.slice(-1200),
  };
}

export function stopPreview(previewId) {
  const preview = activePreviews.get(previewId);
  if (!preview) return false;
  preview.child?.kill("SIGTERM");
  activePreviews.delete(previewId);
  return true;
}
