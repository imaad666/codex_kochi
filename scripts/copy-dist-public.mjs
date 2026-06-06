import { cpSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

const dist = "dist";
const pub = "public";

if (!existsSync(dist)) {
  console.error("[copy-dist-public] dist/ missing — run vite build first");
  process.exit(1);
}

mkdirSync(pub, { recursive: true });

for (const entry of readdirSync(dist)) {
  const from = join(dist, entry);
  const to = join(pub, entry);
  cpSync(from, to, { recursive: true, force: true });
}

console.log("[copy-dist-public] merged dist/ → public/");
