import { dataPath, storage } from "./storage.js";

export async function listRunFilesRecursive(runIdOrDir) {
  const prefix =
    typeof runIdOrDir === "string" && !runIdOrDir.includes("/")
      ? dataPath("runs", runIdOrDir, "files")
      : runIdOrDir.endsWith("/files")
        ? runIdOrDir
        : `${runIdOrDir}/files`;

  const listed = await storage.listFiles(prefix.endsWith("/") ? prefix : `${prefix}/`);
  const files = [];
  for (const file of listed) {
    if (!file.path || file.path.endsWith("/")) continue;
    const content = await storage.readText(file.pathname || `${prefix}/${file.path}`);
    files.push({ path: file.path, content });
  }
  return files;
}

export function runFilesPrefix(runId) {
  return dataPath("runs", runId, "files");
}

export function runManifestPath(runId) {
  return dataPath("runs", runId, "manifest.json");
}

export function runFilePath(runId, filename) {
  return dataPath("runs", runId, "files", filename);
}
