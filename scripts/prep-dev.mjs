import { execSync } from "child_process";

const PORTS = [3001, 5173, 5174];

for (const port of PORTS) {
  try {
    const pids = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`[prep-dev] stopped pid ${pid} on :${port}`);
      } catch {
        // already gone
      }
    }
  } catch {
    // port free
  }
}
