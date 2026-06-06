import { mkdir, readFile, writeFile, readdir, rm, access } from "fs/promises";
import { dirname, join } from "path";
import { head, list, put } from "@vercel/blob";

const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const IS_VERCEL = Boolean(process.env.VERCEL);
/** Vercel serverless has a read-only project dir; /tmp is writable per invocation. */
const LOCAL_ROOT = IS_VERCEL ? join("/tmp", ".open-ide") : ".open-ide";

function enoent() {
  const error = new Error("ENOENT");
  error.code = "ENOENT";
  return error;
}

async function blobRead(pathname) {
  try {
    const meta = await head(pathname);
    const res = await fetch(meta.url);
    if (!res.ok) throw enoent();
    return await res.text();
  } catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw enoent();
  }
}

async function blobWrite(pathname, content) {
  await put(pathname, content, { access: "public", addRandomSuffix: false });
}

async function blobExists(pathname) {
  try {
    await head(pathname);
    return true;
  } catch {
    return false;
  }
}

async function blobList(prefix) {
  const { blobs } = await list({ prefix, limit: 1000 });
  return blobs;
}

export function dataRoot() {
  return USE_BLOB ? "" : LOCAL_ROOT;
}

export function dataPath(...parts) {
  const cleaned = parts.filter(Boolean);
  if (USE_BLOB) return cleaned.join("/");
  return join(LOCAL_ROOT, ...cleaned);
}

export const storage = {
  isRemote: USE_BLOB,
  isEphemeral: IS_VERCEL && !USE_BLOB,

  async exists(relPath) {
    if (USE_BLOB) return blobExists(relPath);
    try {
      await access(relPath);
      return true;
    } catch {
      return false;
    }
  },

  async readText(relPath) {
    if (USE_BLOB) return blobRead(relPath);
    return readFile(relPath, "utf8");
  },

  async writeText(relPath, content) {
    if (USE_BLOB) return blobWrite(relPath, content);
    await mkdir(dirname(relPath), { recursive: true });
    return writeFile(relPath, content, "utf8");
  },

  async readBuffer(relPath) {
    const text = await this.readText(relPath);
    return Buffer.from(text, "utf8");
  },

  async remove(relPath) {
    if (USE_BLOB) {
      try {
        const meta = await head(relPath);
        const { del } = await import("@vercel/blob");
        await del(meta.url);
      } catch {
        // already gone
      }
      return;
    }
    await rm(relPath, { recursive: true, force: true });
  },

  async listFiles(prefix) {
    if (USE_BLOB) {
      const blobs = await blobList(prefix);
      return blobs.map((blob) => ({
        path: blob.pathname.slice(prefix.length).replace(/^\//, ""),
        pathname: blob.pathname,
        url: blob.url,
      }));
    }

    const files = [];
    async function walk(currentDir, relBase = "") {
      let entries;
      try {
        entries = await readdir(currentDir, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        const full = join(currentDir, entry.name);
        if (entry.isDirectory()) await walk(full, rel);
        else if (entry.isFile()) files.push({ path: rel, pathname: full });
      }
    }
    await walk(prefix);
    return files;
  },
};
