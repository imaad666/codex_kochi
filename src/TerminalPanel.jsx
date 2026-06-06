import { useCallback, useEffect, useRef, useState } from "react";

function matchPaths(fileSystem, prefix = "") {
  const norm = prefix.replace(/^\.\//, "").replace(/\/$/, "");
  const paths = Object.keys(fileSystem);
  if (!norm) {
    return paths
      .filter((p) => !p.includes("/"))
      .concat(paths.filter((p) => p.includes("/")).map((p) => p.split("/")[0]))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
  }
  return paths
    .filter((p) => p.startsWith(norm ? `${norm}/` : "") || p === norm)
    .map((p) => {
      const rest = p.slice(norm.length + (norm ? 1 : 0));
      return rest.includes("/") ? rest.split("/")[0] : rest;
    })
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
}

async function runLocalShell(command, runId) {
  const res = await fetch("/api/terminal/exec", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, runId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Command failed");
  return data.output || "";
}

async function runGitCommand(command, { githubRepo, fileSystem }) {
  const res = await fetch("/api/terminal/git", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command,
      owner: githubRepo?.owner,
      repoName: githubRepo?.name,
      files: Object.keys(fileSystem),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Git command failed");
  return data.output || "";
}

export default function TerminalPanel({
  fileSystem,
  githubRepo,
  runId,
  onOpenFile,
  cloudMode = false,
}) {
  const [lines, setLines] = useState([
    { type: "system", text: "Open IDE terminal — type help for commands." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const append = useCallback((type, text) => {
    setLines((current) => [...current, { type, text }]);
  }, []);

  const runCommand = useCallback(
    async (raw) => {
      const line = String(raw || "").trim();
      if (!line || busy) return;
      append("input", line);
      setInput("");

      const [cmd, ...args] = line.split(/\s+/);
      const lower = cmd.toLowerCase();

      try {
        if (lower === "help") {
          append(
            "output",
            [
              "help          — this message",
              "clear         — clear terminal",
              "ls [dir]      — list workspace files",
              "cat <file>    — print file contents",
              "open <file>   — open file in editor",
              "pwd           — workspace root",
              "git status    — workspace + linked repo status",
              "git log       — recent commits on GitHub",
              "git branch    — current branch",
              "git remote -v — remote URLs",
              githubRepo ? `repo          — ${githubRepo.fullName}` : "",
              cloudMode
                ? "npm/node      — local dev only (npm run dev)"
                : "npm/node      — run on server (local dev)",
            ]
              .filter(Boolean)
              .join("\n")
          );
          return;
        }

        if (lower === "clear") {
          setLines([]);
          return;
        }

        if (lower === "pwd") {
          append("output", githubRepo?.fullName || "/workspace");
          return;
        }

        if (lower === "repo") {
          append("output", githubRepo ? `${githubRepo.fullName}\n${githubRepo.url}` : "No repo linked");
          return;
        }

        if (lower === "ls") {
          const dir = args[0] || "";
          const entries = matchPaths(fileSystem, dir);
          if (!entries.length) {
            append("output", dir ? `ls: ${dir}: no files` : "(empty workspace)");
          } else {
            append("output", entries.join("  "));
          }
          return;
        }

        if (lower === "cat") {
          const path = args[0];
          if (!path) {
            append("error", "usage: cat <file>");
            return;
          }
          const entry = fileSystem[path];
          if (!entry) {
            append("error", `cat: ${path}: no such file`);
            return;
          }
          append("output", entry.code || "");
          return;
        }

        if (lower === "open") {
          const path = args[0];
          if (!path) {
            append("error", "usage: open <file>");
            return;
          }
          if (!fileSystem[path]) {
            append("error", `open: ${path}: no such file`);
            return;
          }
          onOpenFile?.(path);
          append("system", `Opened ${path} in editor`);
          return;
        }

        if (lower === "git") {
          setBusy(true);
          const output = await runGitCommand(line, { githubRepo, fileSystem });
          append("output", output || "(no output)");
          return;
        }

        if (/^(npm|node|npx|echo|which)\b/.test(lower)) {
          if (cloudMode) {
            append(
              "error",
              "npm/node are not available on cloud deploy. Run `npm run dev` locally for a full shell."
            );
            return;
          }
          setBusy(true);
          const output = await runLocalShell(line, runId);
          append("output", output || "(no output)");
          return;
        }

        append("error", `command not found: ${cmd}. Type help.`);
      } catch (error) {
        append("error", error.message || "Command failed");
      } finally {
        setBusy(false);
      }
    },
    [append, busy, cloudMode, fileSystem, githubRepo, onOpenFile, runId]
  );

  return (
    <div className="terminal-panel" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-log crt-scroll">
        {lines.map((line, index) => (
          <div key={index} className={`terminal-line-${line.type}`}>
            {line.type === "input" ? (
              <>
                <span className="terminal-prompt">$</span> {line.text}
              </>
            ) : (
              line.text
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="terminal-input-row"
        onSubmit={(event) => {
          event.preventDefault();
          runCommand(input);
        }}
      >
        <span className="terminal-prompt">$</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          aria-label="Terminal command"
          placeholder={busy ? "Running…" : "Enter command"}
        />
      </form>
    </div>
  );
}
