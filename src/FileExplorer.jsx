import { useMemo, useState } from "react";

function buildFileTree(paths) {
  const root = { name: "", type: "folder", path: "", children: new Map() };

  for (const fullPath of [...paths].sort()) {
    const parts = fullPath.split("/");
    let node = root;

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const childPath = isFile ? fullPath : parts.slice(0, i + 1).join("/");

      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          path: childPath,
          type: isFile ? "file" : "folder",
          children: isFile ? null : new Map(),
        });
      }
      node = node.children.get(part);
    }
  }

  return root;
}

function sortedChildren(node) {
  return [...node.children.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function fileKind(name) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "js";
  if (["ts", "tsx"].includes(ext)) return "ts";
  if (ext === "json") return "json";
  if (ext === "css") return "css";
  if (["html", "htm"].includes(ext)) return "html";
  if (ext === "sql") return "sql";
  if (["md", "mdx"].includes(ext)) return "md";
  return "file";
}

function TreeRows({ node, depth, fileSystem, activeFile, collapsed, onToggleFolder, onSelectFile }) {
  const rows = [];

  for (const child of sortedChildren(node)) {
    if (child.type === "folder") {
      const expanded = !collapsed.has(child.path);
      rows.push(
        <div
          key={`folder:${child.path}`}
          className="explorer-row folder"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => onToggleFolder(child.path)}
        >
          <span className={`explorer-chevron ${expanded ? "open" : ""}`} aria-hidden />
          <span className="explorer-icon folder-icon" aria-hidden />
          <span className="explorer-label">{child.name}</span>
        </div>
      );
      if (expanded) {
        rows.push(
          <TreeRows
            key={`children:${child.path}`}
            node={child}
            depth={depth + 1}
            fileSystem={fileSystem}
            activeFile={activeFile}
            collapsed={collapsed}
            onToggleFolder={onToggleFolder}
            onSelectFile={onSelectFile}
          />
        );
      }
      continue;
    }

    const entry = fileSystem[child.path];
    const status = entry?.status;
    rows.push(
      <div
        key={`file:${child.path}`}
        className={`explorer-row file ${activeFile === child.path ? "active" : ""} ${status === "writing" ? "writing" : ""}`}
        style={{ paddingLeft: 20 + depth * 12 }}
        onClick={() => onSelectFile(child.path)}
        title={child.path}
      >
        <span className={`explorer-icon file-icon kind-${fileKind(child.name)}`} aria-hidden />
        <span className="explorer-label">{child.name}</span>
        {status === "writing" ? <span className="explorer-status" aria-label="Writing" /> : null}
      </div>
    );
  }

  return rows;
}

export default function FileExplorer({ fileSystem, activeFile, onSelectFile }) {
  const paths = Object.keys(fileSystem);
  const tree = useMemo(() => buildFileTree(paths), [paths]);
  const [collapsed, setCollapsed] = useState(() => new Set());

  const toggleFolder = (folderPath) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  return (
    <aside className="explorer crt-scroll">
      <div className="explorer-header">Explorer</div>
      <div className="explorer-section">
        <div className="explorer-section-label">Open IDE</div>
        {paths.length === 0 ? (
          <div className="explorer-empty">No files yet</div>
        ) : (
          <div className="explorer-tree">
            <TreeRows
              node={tree}
              depth={0}
              fileSystem={fileSystem}
              activeFile={activeFile}
              collapsed={collapsed}
              onToggleFolder={toggleFolder}
              onSelectFile={onSelectFile}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
