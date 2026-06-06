import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { streamSwarmGenerate, searchInspiration as fetchInspiration, postChat, syncSession } from "./eventClient.js";
import Editor from "@monaco-editor/react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { AGENT_CARDS, formatGroqModel } from "./agentCards.js";
import FileExplorer from "./FileExplorer.jsx";
import TerminalPanel from "./TerminalPanel.jsx";
import HyperreasoningPanel from "./HyperreasoningPanel.jsx";
import IntroSite, { introCss } from "./IntroSite.jsx";
import { flowNodeCss, flowNodeTypes } from "./FlowNodes.jsx";
import {
  CLEAR_GITHUB_REPO_REPLY,
  CLEAR_WORKSPACE_REPLY,
  greetingReply,
  isGreeting,
  matchChatIntent,
} from "../chatIntents.js";
import {
  fetchSession,
  getOrCreateSessionId,
  loadRunFiles,
  proxyImageUrl,
} from "./sessionStore.js";

function formatRepoAge(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

function compressImageFile(file, { maxDim = 768, quality = 0.72, maxBytes = 100_000 } = {}) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      if (!src.startsWith("data:image/")) {
        resolve(src);
        return;
      }
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height, 1));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(src.slice(0, 140_000));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        let q = quality;
        let dataUrl = canvas.toDataURL("image/jpeg", q);
        while (dataUrl.length > maxBytes * 1.37 && q > 0.35) {
          q -= 0.08;
          dataUrl = canvas.toDataURL("image/jpeg", q);
        }
        resolve(dataUrl.slice(0, 140_000));
      };
      img.onerror = () => resolve(src.slice(0, 140_000));
      img.src = src;
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

const PROMPT_QUESTION = "WHAT DO YOU WANT TO BUILD TODAY?";

function initialStage() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") === "ok" || params.get("launch") === "1") return "repo";
  if (params.get("resume") === "1") return "ide";
  return "intro";
}

const CRT = {
  beige: "#c9bba0",
  beigeHi: "#ddd0b4",
  beigeLo: "#8a7a5c",
  screen: "#4e9e9e",
  screenHi: "#62b8b8",
  screenEdge: "#2d6a6a",
  text: "#e7ff4a",
  textDim: "#c7da2e",
  textSoft: "#f2ff8a",
  led: "#e87830",
};

const NODE_STATUS = {
  planned: { background: CRT.screen, border: CRT.textDim, color: CRT.text },
  ready: { background: "#477f7f", border: CRT.text, color: CRT.textSoft },
  waiting: { background: "#365f69", border: "#8fb9d1", color: "#d8f2ff" },
  running: { background: "#7b7136", border: "#fff06a", color: "#fff8a8" },
  complete: { background: "#396f48", border: "#7dff95", color: "#dfffe3" },
  error: { background: "#713b3b", border: "#ff7777", color: "#ffe0e0" },
};

function nodeStyle(status = "planned") {
  const colors = NODE_STATUS[status] || NODE_STATUS.planned;
  return {
    background: colors.background,
    color: colors.color,
    border: `2px solid ${colors.border}`,
    borderRadius: 2,
    padding: 10,
    fontSize: 14,
    fontFamily: "VT323, monospace",
    minWidth: 140,
    boxShadow: status === "running" ? `0 0 14px ${colors.border}77` : "none",
  };
}

function Monitor({ children, full, bare }) {
  if (bare) {
    return <div className="viewport viewport-full ide-viewport">{children}</div>;
  }
  return (
    <div className={`viewport ${full ? "viewport-full" : ""}`}>
      <div className={`monitor ${full ? "monitor-full" : ""}`}>
        <div className="monitor-bezel">
          <span className="led" />
          <span className="monitor-label">OPEN IDE</span>
          <span className="monitor-slot" />
        </div>
        <div className="crt-screen">{children}</div>
        <div className="monitor-base" />
      </div>
    </div>
  );
}

const SEARCH_STATUS_MAP = {
  ROOT: "planned",
  IDLE: "ready",
  ACTIVE: "running",
  EXPANDING: "running",
  SUCCESS: "complete",
  PRUNED: "error",
  FAILED_COMPILE: "error",
  FAILED_TEST: "error",
};

function layoutSearchGraph(rawNodes, rawEdges, bestPath = [], rankdir = "LR") {
  if (!rawNodes.length) return { nodes: [], edges: [] };
  const best = new Set(bestPath);
  const maxScore = Math.max(
    1,
    ...rawNodes.filter((node) => node.depth > 0).map((node) => node.score || 0)
  );
  const nodes = rawNodes.map((n) => {
    const status = SEARCH_STATUS_MAP[n.status] || "planned";
    const onPath = best.has(n.id);
    return {
      id: n.id,
      type: "planBranch",
      data: {
        label: n.title,
        status,
        score: n.score,
        rank: n.rank,
        shortSummary: n.shortSummary || "",
        rationale: n.rationaleSummary || "",
        stepCount: n.stepCount,
        agentsUsed: n.agentsUsed,
        maxScore,
        isRoot: n.depth === 0,
      },
      position: { x: 0, y: 0 },
      className: n.status === "PRUNED" ? "status-pruned" : "",
      style: {
        opacity: n.status === "PRUNED" ? 0.55 : 1,
        boxShadow: onPath ? `0 0 16px ${CRT.text}88` : "none",
        background: "transparent",
        border: "none",
        padding: 0,
      },
    };
  });
  const edges = rawEdges.map((e) => ({
    id: `e${e.parentId}-${e.childId}`,
    source: e.parentId,
    target: e.childId,
    animated: best.has(e.childId),
    style: { stroke: best.has(e.childId) ? CRT.textSoft : CRT.textDim },
    markerEnd: { type: MarkerType.ArrowClosed, color: CRT.text },
  }));

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir,
    nodesep: rankdir === "LR" ? 36 : 50,
    ranksep: rankdir === "LR" ? 90 : 70,
  });
  nodes.forEach((n) =>
    g.setNode(n.id, { width: n.data.isRoot ? 170 : 210, height: n.data.isRoot ? 58 : 98 })
  );
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const { x, y } = g.node(n.id);
      const yOffset = n.data.isRoot ? 28 : 49;
      const xOffset = n.data.isRoot ? 82 : 102;
      return { ...n, position: { x: x - xOffset, y: y - yOffset } };
    }),
    edges,
  };
}

function layoutGraph(steps = [], agentStatus = {}, rankdir = "LR") {
  if (!Array.isArray(steps) || !steps.length) return { nodes: [], edges: [] };
  const nodes = steps.map((s) => ({
    id: s.id,
    type: "execStep",
    data: {
      label: s.title,
      agent: s.agent,
      description: s.description,
      status: agentStatus[s.agent] || "planned",
    },
    position: { x: 0, y: 0 },
    style: { background: "transparent", border: "none", padding: 0 },
  }));
  const edges = [];
  for (const step of steps) {
    for (const depId of step.dependsOn || []) {
      edges.push({
        id: `e${depId}-${step.id}`,
        source: depId,
        target: step.id,
        animated: true,
        style: { stroke: CRT.text },
        markerEnd: { type: MarkerType.ArrowClosed, color: CRT.text },
      });
    }
  }
  if (!edges.length && steps.length > 1) {
    steps.slice(0, -1).forEach((s, i) => {
      edges.push({
        id: `e${s.id}-${steps[i + 1].id}`,
        source: s.id,
        target: steps[i + 1].id,
        animated: true,
        style: { stroke: CRT.text },
        markerEnd: { type: MarkerType.ArrowClosed, color: CRT.text },
      });
    });
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir,
    nodesep: rankdir === "LR" ? 32 : 40,
    ranksep: rankdir === "LR" ? 88 : 60,
  });
  nodes.forEach((n) => g.setNode(n.id, { width: 170, height: 52 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const { x, y } = g.node(n.id);
      return { ...n, position: { x: x - 80, y: y - 25 } };
    }),
    edges,
  };
}

function basename(path) {
  const name = String(path || "");
  const parts = name.split("/");
  return parts[parts.length - 1] || name;
}

function languageForFile(filename) {
  const name = String(filename || "");
  if (name.endsWith(".sql")) return "sql";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".html")) return "html";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "typescript";
  return "javascript";
}

function chatAgentKey(message = {}) {
  if (message.role === "user") {
    const target = String(message.target || "").toLowerCase();
    if (target.includes("altbot") || target.includes("controller")) return "altbot";
    if (target.includes("jobalyser") || target === "backend") return "backend";
    if (target.includes("ives") || target === "frontend") return "frontend";
    if (target.includes("wzdata") || target === "database") return "database";
    return "user";
  }
  if (message.role === "controller") return "altbot";
  if (message.role === "system") return "system";
  if (message.role === "agent") {
    const agent = String(message.agent || "").toLowerCase();
    if (agent === "frontend" || agent === "backend" || agent === "database") return agent;
  }
  return "system";
}

function chatTargetKey(targetId) {
  if (targetId === "altbot") return "altbot";
  if (targetId === "Frontend") return "frontend";
  if (targetId === "Backend") return "backend";
  if (targetId === "Database") return "database";
  return "user";
}

function chatSpeakerLabel(message = {}) {
  if (message.role === "user") {
    return message.target ? `YOU → ${message.target}` : "YOU";
  }
  if (message.role === "controller") return "ALTBOT";
  const card = AGENT_CARDS.find((item) => item.agent === message.agent);
  if (card?.name) return card.name.toUpperCase();
  if (message.agent) return String(message.agent).toUpperCase();
  return String(message.role || "system").toUpperCase();
}

function App() {
  const [stage, setStage] = useState(() => initialStage());
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [selected, setSelected] = useState(["Frontend", "Backend"]);
  const [status, setStatus] = useState({});
  const [activeFile, setActiveFile] = useState(null);
  const [runningAgents, setRunningAgents] = useState([]);
  const [typedPrompt, setTypedPrompt] = useState("");
  const [fileSystem, setFileSystem] = useState({});
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [searchPhase, setSearchPhase] = useState("idle");
  const [bottomPanelTab, setBottomPanelTab] = useState("terminal");
  const [cloudMode, setCloudMode] = useState(false);
  const [searchLog, setSearchLog] = useState([]);
  const [searchWinner, setSearchWinner] = useState(null);
  const [searchVerdict, setSearchVerdict] = useState(null);
  const [searchComparisons, setSearchComparisons] = useState([]);
  const [searchSavings, setSearchSavings] = useState(null);
  const [planSummary, setPlanSummary] = useState("");
  const [planSteps, setPlanSteps] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatMode, setChatMode] = useState("chat");
  const [chatTarget, setChatTarget] = useState("altbot");
  const [searchGraphData, setSearchGraphData] = useState({ branches: [], edges: [], bestPath: [] });
  const [inspoCandidates, setInspoCandidates] = useState([]);
  const [inspoSelectedIds, setInspoSelectedIds] = useState([]);
  const [inspoLoading, setInspoLoading] = useState(false);
  const [inspoMood, setInspoMood] = useState("");
  const [sessionId, setSessionId] = useState(() => getOrCreateSessionId());
  const [sessionReady, setSessionReady] = useState(false);
  const [savedSession, setSavedSession] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [outputBusy, setOutputBusy] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [githubRepo, setGithubRepo] = useState(null);
  const [newRepoName, setNewRepoName] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoMode, setRepoMode] = useState("open");
  const [existingRepos, setExistingRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState("");
  const [rightWidth, setRightWidth] = useState(400);
  const [graphHeight, setGraphHeight] = useState(360);
  const searchNodesRef = useRef([]);
  const searchEdgesRef = useRef([]);
  const bestPathRef = useRef([]);
  const searchGraphRef = useRef({ nodes: [], edges: [] });
  const searchPhaseRef = useRef("idle");
  const executionGraphRef = useRef({ nodes: [], edges: [] });
  const promptInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const inspoFileInputRef = useRef(null);
  const lastInspoQueryRef = useRef("");
  const chatEndRef = useRef(null);
  const repoAutoLoadRef = useRef(new Set());

  const appendChat = useCallback((role, text, meta = {}) => {
    setChatMessages((current) => [
      ...current,
      { id: `${Date.now()}-${current.length}`, role, text, ts: Date.now(), ...meta },
    ]);
  }, []);

  const appendSearchLog = useCallback((text) => {
    setSearchLog((current) => [...current, { id: `${Date.now()}-${current.length}`, text, ts: Date.now() }]);
  }, []);

  useEffect(() => {
    searchPhaseRef.current = searchPhase;
  }, [searchPhase]);

  const paintSearchGraph = useCallback(
    () => {
      const laid = layoutSearchGraph(
        searchNodesRef.current,
        searchEdgesRef.current,
        bestPathRef.current
      );
      searchGraphRef.current = laid;
      setSearchGraphData({
        branches: [...searchNodesRef.current],
        edges: [...searchEdgesRef.current],
        bestPath: [...bestPathRef.current],
      });
      setNodes(laid.nodes);
      setEdges(laid.edges);
    },
    [setNodes, setEdges]
  );

  const hydrateExecutionGraph = useCallback(
    (steps, { agentStatus = {} } = {}) => {
      const laid = layoutGraph(steps, agentStatus);
      executionGraphRef.current = laid;
      setPlanSteps(steps);
      return laid;
    },
    []
  );

  const swarmHandlers = useCallback(
    () => ({
      "run-started": ({ runId }) => {
        setStatus((current) => ({ ...current, runId, runPath: "" }));
      },
      "search-started": ({ subtitle }) => {
        setSearchPhase("searching");
        setBottomPanelTab("graph");
        searchPhaseRef.current = "searching";
        searchNodesRef.current = [];
        searchEdgesRef.current = [];
        bestPathRef.current = [];
        searchGraphRef.current = { nodes: [], edges: [] };
        setSearchVerdict(null);
        setSearchComparisons([]);
        setSearchSavings(null);
        setSearchWinner(null);
        setNodes([]);
        setEdges([]);
        appendSearchLog("Hyperreasoning search started");
        appendChat("system", subtitle || "Altbot is evaluating architectural branches…");
      },
      "search-node": ({ node }) => {
        searchNodesRef.current = [
          ...searchNodesRef.current.filter((item) => item.id !== node.id),
          node,
        ];
        if (node.depth === 0) {
          appendSearchLog(`Root: ${node.title}`);
        } else {
          appendSearchLog(`Branch: ${node.title} (${node.shortSummary || "candidate"})`);
        }
        paintSearchGraph();
      },
      "search-edge": ({ parentId, childId }) => {
        searchEdgesRef.current = [...searchEdgesRef.current, { parentId, childId }];
        paintSearchGraph();
      },
      "search-scored": ({ id, score, rank, breakdown }) => {
        const hit = searchNodesRef.current.find((node) => node.id === id);
        searchNodesRef.current = searchNodesRef.current.map((node) =>
          node.id === id
            ? {
                ...node,
                score,
                rank,
                breakdown,
                stepCount: breakdown?.stepCount ?? node.stepCount,
                agentsUsed: breakdown?.agentsUsed ?? node.agentsUsed,
                status: node.status || "IDLE",
              }
            : node
        );
        appendSearchLog(`Scored ${hit?.title || id}: ${score} (rank #${rank})`);
        paintSearchGraph();
      },
      "search-node-status": ({ nodeId, status: nodeStatus }) => {
        const hit = searchNodesRef.current.find((node) => node.id === nodeId);
        searchNodesRef.current = searchNodesRef.current.map((node) =>
          node.id === nodeId ? { ...node, status: nodeStatus } : node
        );
        appendSearchLog(`${hit?.title || nodeId} → ${nodeStatus}`);
        paintSearchGraph();
      },
      "search-pruned": ({ nodeId, reason }) => {
        const hit = searchNodesRef.current.find((node) => node.id === nodeId);
        searchNodesRef.current = searchNodesRef.current.map((node) =>
          node.id === nodeId ? { ...node, status: "PRUNED", pruneReason: reason } : node
        );
        appendSearchLog(`Pruned ${hit?.title || nodeId}: ${reason || "lower score"}`);
        paintSearchGraph();
      },
      "search-best-path": ({ nodeIds, winnerId }) => {
        bestPathRef.current = nodeIds || [];
        if (winnerId) setSearchWinner(winnerId);
        appendSearchLog(`Best path locked → ${(nodeIds || []).join(" → ")}`);
        paintSearchGraph();
      },
      "search-finished": ({ summary, winnerId, verdict, savings, comparisons }) => {
        if (summary) setPlanSummary(summary);
        if (winnerId) setSearchWinner(winnerId);
        if (verdict) setSearchVerdict(verdict);
        if (comparisons?.length) setSearchComparisons(comparisons);
        if (savings) setSearchSavings(savings);
        appendSearchLog(`Winner selected. Plan: ${summary || "ready"}`);
        const verdictLine = verdict?.headline
          ? `${verdict.headline}. ${verdict.body || ""}`
          : `Hyperreasoning picked the winning branch. ${summary || "Deploying swarm…"}`;
        appendChat("controller", verdictLine.trim());
        setSearchPhase("executing");
      },
      "graph-ready": ({ steps, summary }) => {
        if (summary) setPlanSummary(summary);
        hydrateExecutionGraph(steps || []);
      },
      "agent-status": ({ agent, status: agentStatus }) => {
        if (agentStatus === "running") {
          setRunningAgents((current) => [...new Set([...current, agent])]);
        }
        if (agentStatus === "complete" || agentStatus === "error") {
          setRunningAgents((current) => current.filter((item) => item !== agent));
        }
      },
      "agent-started": ({ agent, filename }) => {
        setRunningAgents((current) => [...new Set([...current, agent])]);
        appendChat("agent", `${agent} started writing ${filename}`, { agent });
        setActiveFile(filename);
        setFileSystem((files) => ({
          ...files,
          [filename]: {
            code: "",
            agent,
            filename,
            status: "writing",
            summary: "",
          },
        }));
      },
      "file-chunk": ({ agent, filename, chunk }) => {
        setFileSystem((files) => {
          const current = files[filename] || { code: "", agent, filename, status: "writing", summary: "" };
          return {
            ...files,
            [filename]: {
              ...current,
              code: `${current.code || ""}${chunk}`,
              agent,
              filename,
              status: "writing",
            },
          };
        });
      },
      "file-completed": ({ agent, filename, code, summary }) => {
        setFileSystem((files) => ({
          ...files,
          [filename]: {
            code,
            agent,
            filename,
            status: "complete",
            summary,
          },
        }));
        setActiveFile(filename);
        setRunningAgents((current) => current.filter((item) => item !== agent));
        appendChat("agent", `${agent} finished ${filename}: ${summary}`, { agent });
      },
      "swarm-complete": ({ runId, runPath, planSummary: summary }) => {
        setRunningAgents([]);
        if (summary) setPlanSummary(summary);
        setStatus((current) => ({ ...current, runId, runPath }));
        appendChat("controller", "Swarm complete. Files are saved — refresh will restore this session.");
      },
      "agent-error": ({ message }) => {
        setRunningAgents([]);
        setSearchPhase("idle");
        setStatus((current) => ({ ...current, error: message }));
        appendChat("system", message || "Agent error");
        setNodes((current) =>
          current.map((node) => ({
            ...node,
            data: { ...node.data, status: node.data?.status === "complete" ? "complete" : "error" },
            style: nodeStyle(node.data?.status === "complete" ? "complete" : "error"),
          }))
        );
      },
    }),
    [setNodes, paintSearchGraph, hydrateExecutionGraph, appendChat, appendSearchLog]
  );

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        setStatus((current) => ({
          ...current,
          ok: Boolean(data.ok),
          provider: data.provider,
          plannerModel: data.plannerModel,
          workerModel: data.workerModel,
          tokenBudget: data.tokenBudget,
          error: data.serverVersion < 3 ? "Backend is outdated. Restart npm run dev." : "",
        }));
        setGithubConfigured(Boolean(data.githubAuth));
        setCloudMode(Boolean(data.storage?.ephemeral));
      })
      .catch(() => {
        setStatus((current) => ({
          ...current,
          error: "Backend offline. Run npm run dev from the repo root.",
        }));
      });
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setGithubConfigured(Boolean(data.githubConfigured));
      setAuthUser(data.authenticated ? data : null);
    } catch {
      // auth optional
    }
  }, []);

  useEffect(() => {
    if (!sessionReady || !githubConfigured || githubRepo || localOnly) return;
    if (stage === "prompt" || stage === "cards") setStage("repo");
  }, [sessionReady, githubConfigured, githubRepo, localOnly, stage]);

  useEffect(() => {
    refreshAuth();
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "ok") {
      appendChat("system", "Signed in with GitHub — choose your repo to get started.");
      setStage("repo");
      window.history.replaceState({}, "", window.location.pathname);
      refreshAuth();
    }
    const authError = params.get("auth_error");
    if (authError) {
      appendChat("system", `GitHub sign-in failed: ${authError}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshAuth, appendChat]);

  const downloadZip = useCallback(() => {
    if (!status.runId) return;
    window.location.assign(`/api/runs/${status.runId}/download.zip`);
    appendChat("system", "Downloading project zip…");
  }, [status.runId, appendChat]);

  const runPreview = useCallback(async () => {
    if (!status.runId || outputBusy) return;
    setOutputBusy("run");
    try {
      const res = await fetch(`/api/runs/${status.runId}/preview`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreviewUrl(data.url);
      appendChat("system", `Preview running at ${data.url}`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      appendChat("system", error.message || "Preview failed");
    } finally {
      setOutputBusy("");
    }
  }, [status.runId, outputBusy, appendChat]);

  const loadExistingRepos = useCallback(async () => {
    if (!authUser?.authenticated) return;
    setReposLoading(true);
    setReposError("");
    try {
      const res = await fetch("/api/github/repos?perPage=100", { credentials: "include" });
      const contentType = res.headers.get("content-type") || "";
      const text = await res.text();
      let data = {};
      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("Invalid server response — rerun npm run dev from the repo root");
        }
      } else if (text.trimStart().startsWith("<!DOCTYPE") || text.includes("<html")) {
        throw new Error(
          res.status === 404
            ? "Backend outdated — stop terminal and rerun npm run dev from the repo root"
            : "Server returned HTML instead of JSON — rerun npm run dev from the repo root"
        );
      } else {
        throw new Error(text.slice(0, 120) || `Could not load repos (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(data.error || "Could not load repos");
      setExistingRepos(data.repos || []);
    } catch (error) {
      const message = error.message || "Could not load GitHub repos";
      setReposError(message);
      setExistingRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, [authUser]);

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return existingRepos;
    return existingRepos.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(q) ||
        repo.name.toLowerCase().includes(q) ||
        repo.owner?.toLowerCase().includes(q)
    );
  }, [existingRepos, repoSearch]);

  const manualRepoRef = useMemo(() => {
    const q = repoSearch.trim();
    if (!q || reposLoading) return "";
    const normalized = q.toLowerCase();
    const visibleMatch = filteredRepos.some(
      (repo) => repo.fullName.toLowerCase() === normalized || repo.name.toLowerCase() === normalized
    );
    return visibleMatch ? "" : q;
  }, [repoSearch, filteredRepos, reposLoading]);

  useEffect(() => {
    if (stage !== "repo" || repoMode !== "open" || !authUser?.authenticated || githubRepo) return;
    loadExistingRepos();
  }, [stage, repoMode, authUser, githubRepo, loadExistingRepos]);

  const loadRepoIntoWorkspace = useCallback(
    async (repo) => {
      if (!repo?.owner || !repo?.name) return 0;
      appendChat("system", `Loading files from ${repo.fullName}…`);
      const res = await fetch("/api/github/repo-files", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: repo.owner, repoName: repo.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load repo files");
      const next = {};
      for (const file of data.files || []) {
        next[file.path] = {
          code: file.content,
          agent: "GitHub",
          filename: file.path,
          status: "complete",
          summary: `From ${repo.fullName}`,
        };
      }
      const count = Object.keys(next).length;
      if (count) {
        setFileSystem(next);
        setActiveFile(data.files[0]?.path || null);
        if (repo.fullName) repoAutoLoadRef.current.add(repo.fullName);
        appendChat("system", `Loaded ${count} file(s) from GitHub (${data.branch || "main"}).`);
      } else {
        appendChat("system", "Repo linked — no readable text files found (or repo is empty).");
      }
      return count;
    },
    [appendChat]
  );

  const openExistingRepo = useCallback(
    async (repoRef) => {
      const ref = String(repoRef || manualRepoRef || repoSearch || "").trim();
      if (!ref || repoBusy) return;
      setRepoBusy(true);
      try {
        const res = await fetch("/api/github/open-repo", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoRef: ref }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not open repo");
        setGithubRepo(data);
        appendChat("system", `Opened repo: ${data.url}`);
        if (data.source === "existing") {
          await loadRepoIntoWorkspace(data);
        }
      } catch (error) {
        appendChat("system", error.message || "Could not open repo");
      } finally {
        setRepoBusy(false);
      }
    },
    [manualRepoRef, repoSearch, repoBusy, appendChat, loadRepoIntoWorkspace]
  );

  const handleRepoSearchKey = useCallback(
    (event) => {
      if (event.key !== "Enter" || repoBusy) return;
      const q = repoSearch.trim();
      if (!q) return;
      const exact = filteredRepos.find((repo) => repo.fullName.toLowerCase() === q.toLowerCase());
      if (exact) {
        openExistingRepo(exact.fullName);
        return;
      }
      if (filteredRepos.length === 1) {
        openExistingRepo(filteredRepos[0].fullName);
        return;
      }
      if (manualRepoRef || q.includes("/")) {
        openExistingRepo(q);
      }
    },
    [repoSearch, filteredRepos, manualRepoRef, repoBusy, openExistingRepo]
  );

  const createRepo = useCallback(async () => {
    const name = newRepoName.trim();
    if (!name || repoBusy) return;
    if (!authUser?.authenticated) {
      window.location.assign("/api/auth/github");
      return;
    }
    setRepoBusy(true);
    try {
      const res = await fetch("/api/github/create-repo", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoName: name, description: "Built with Open IDE" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create repo");
      setGithubRepo(data);
      appendChat("system", `Repo ready: ${data.url}`);
    } catch (error) {
      appendChat("system", error.message || "Repo creation failed");
    } finally {
      setRepoBusy(false);
    }
  }, [newRepoName, repoBusy, authUser, appendChat]);

  const pushToGitHub = useCallback(async () => {
    if (!status.runId || outputBusy) return;
    if (!authUser?.authenticated) {
      window.location.assign("/api/auth/github");
      return;
    }
    if (!githubRepo?.name) {
      appendChat("system", "Create a repo first (step 1).");
      setStage("repo");
      return;
    }
    setOutputBusy("push");
    try {
      const res = await fetch(`/api/runs/${status.runId}/push-github`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoName: githubRepo.name, repoOwner: githubRepo.owner }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Push failed");
      appendChat("controller", `Pushed to GitHub: ${data.url}`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      appendChat("system", error.message || "GitHub push failed");
    } finally {
      setOutputBusy("");
    }
  }, [status.runId, outputBusy, authUser, githubRepo, appendChat]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setAuthUser(null);
    setGithubRepo(null);
    setStage("repo");
    appendChat("system", "Signed out of GitHub.");
  }, [appendChat]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = getOrCreateSessionId();
      setSessionId(id);
      const session = await fetchSession(id);
      if (!session || cancelled) {
        setSessionReady(true);
        return;
      }
      if (session.prompt) setPrompt(session.prompt);
      if (session.selectedAgents?.length) setSelected(session.selectedAgents);
      if (session.attachments?.length) setAttachments(session.attachments);
      if (session.inspoCandidates?.length) setInspoCandidates(session.inspoCandidates);
      if (session.inspoSelectedIds?.length) setInspoSelectedIds(session.inspoSelectedIds);
      if (session.inspoMood) setInspoMood(session.inspoMood);
      if (session.chatMessages?.length) {
        setChatMessages(
          session.chatMessages.filter((msg) => !/session save failed/i.test(String(msg.text || "")))
        );
      }
      if (session.searchLog?.length) setSearchLog(session.searchLog);
      if (session.searchWinner) setSearchWinner(session.searchWinner);
      if (session.searchVerdict) setSearchVerdict(session.searchVerdict);
      if (session.searchComparisons?.length) setSearchComparisons(session.searchComparisons);
      if (session.searchSavings) setSearchSavings(session.searchSavings);
      if (session.searchGraphData?.branches?.length) {
        searchNodesRef.current = session.searchGraphData.branches;
        searchEdgesRef.current = session.searchGraphData.edges || [];
        bestPathRef.current = session.searchGraphData.bestPath || [];
        setSearchGraphData(session.searchGraphData);
        const laid = layoutSearchGraph(
          searchNodesRef.current,
          searchEdgesRef.current,
          bestPathRef.current
        );
        searchGraphRef.current = laid;
      }
      if (session.planSummary) setPlanSummary(session.planSummary);
      if (session.planSteps?.length) setPlanSteps(session.planSteps);
      const fileCount = session.fileSystem ? Object.keys(session.fileSystem).length : 0;
      if (session.githubRepo) {
        setGithubRepo(session.githubRepo);
        if (fileCount === 0 && session.githubRepo.source === "existing") {
          const key = session.githubRepo.fullName;
          if (key && !repoAutoLoadRef.current.has(key)) {
            repoAutoLoadRef.current.add(key);
            loadRepoIntoWorkspace(session.githubRepo).catch(() => {});
          }
        }
      }
      if (session.localOnly) setLocalOnly(true);
      const hasProgress =
        session.prompt ||
        session.githubRepo ||
        session.runId ||
        fileCount > 0;
      setSavedSession({
        hasProgress,
        prompt: session.prompt || "",
        fileCount,
        stage: session.stage,
      });
      const params = new URLSearchParams(window.location.search);
      if (params.get("resume") === "1" && hasProgress) {
        setStage(session.stage && session.stage !== "intro" ? session.stage : "ide");
      } else if (params.get("launch") === "1") {
        setStage("repo");
      }
      if (session.searchPhase) setSearchPhase(session.searchPhase);
      if (session.activeFile) setActiveFile(session.activeFile);
      if (session.runId) {
        setStatus((current) => ({
          ...current,
          runId: session.runId,
          runPath: session.runPath || "",
        }));
        try {
          const manifestRes = await fetch(`/api/runs/${session.runId}/manifest`);
          if (manifestRes.ok) {
            const manifest = await manifestRes.json();
            const files = await loadRunFiles(session.runId, manifest);
            if (Object.keys(files).length) {
              setFileSystem(files);
              const restoredFiles = files;
              setPlanSummary(manifest.plan?.summary || session.planSummary || "");
              setSearchPhase("executing");
              const agentStatus = {};
              for (const entry of Object.values(restoredFiles)) {
                if (entry?.agent && entry.status === "complete") agentStatus[entry.agent] = "complete";
              }
              hydrateExecutionGraph(manifest.plan?.steps || session.planSteps || [], {
                agentStatus,
              });
            }
          }
        } catch {
          if (session.fileSystem && Object.keys(session.fileSystem).length) {
            setFileSystem(session.fileSystem);
          }
        }
      } else if (session.fileSystem && Object.keys(session.fileSystem).length) {
        setFileSystem(session.fileSystem);
        if (session.planSteps?.length) {
          const agentStatus = {};
          for (const entry of Object.values(session.fileSystem)) {
            if (entry?.agent && entry.status === "complete") agentStatus[entry.agent] = "complete";
          }
          hydrateExecutionGraph(session.planSteps, { agentStatus });
        }
      }
      setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateExecutionGraph, loadRepoIntoWorkspace]);

  useEffect(() => {
    if (stage !== "ide" || !githubRepo || githubRepo.source !== "existing") return;
    if (Object.keys(fileSystem).length > 0) return;
    const key = githubRepo.fullName;
    if (!key || repoAutoLoadRef.current.has(key)) return;
    repoAutoLoadRef.current.add(key);
    loadRepoIntoWorkspace(githubRepo).catch(() => {});
  }, [stage, githubRepo, fileSystem, loadRepoIntoWorkspace]);

  useEffect(() => {
    if (!sessionReady) return undefined;
    const timer = setTimeout(() => {
      syncSession(sessionId, {
        stage,
        prompt,
        selectedAgents: selected,
        attachments,
        inspoCandidates,
        inspoSelectedIds,
        inspoMood,
        chatMessages,
        searchLog,
        searchWinner,
        searchVerdict,
        searchComparisons,
        searchSavings,
        searchGraphData,
        planSummary,
        planSteps,
        githubRepo,
        localOnly,
        fileSystem,
        activeFile,
        searchPhase,
        runId: status.runId || null,
        runPath: status.runPath || null,
      }).catch((error) => console.warn("[session]", error.message));
    }, 1200);
    return () => clearTimeout(timer);
  }, [
    sessionReady,
    sessionId,
    stage,
    prompt,
    selected,
    attachments,
    inspoCandidates,
    inspoSelectedIds,
    inspoMood,
    chatMessages,
    searchLog,
    searchWinner,
    searchVerdict,
    searchComparisons,
    searchSavings,
    searchGraphData,
    planSummary,
    planSteps,
    githubRepo,
    localOnly,
    fileSystem,
    activeFile,
    searchPhase,
    status.runId,
    status.runPath,
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (stage !== "ide" || Object.keys(fileSystem).length === 0) return;
    if (searchPhase === "searching") return;
    if (searchGraphRef.current.nodes.length && nodes.length === 0) {
      setNodes(searchGraphRef.current.nodes);
      setEdges(searchGraphRef.current.edges);
    }
  }, [stage, fileSystem, nodes.length, searchPhase, setNodes, setEdges]);

  useEffect(() => {
    if (stage !== "prompt") return undefined;
    setTypedPrompt("");
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setTypedPrompt(PROMPT_QUESTION.slice(0, index));
      if (index >= PROMPT_QUESTION.length) {
        clearInterval(timer);
      }
    }, 58);
    return () => clearInterval(timer);
  }, [stage]);

  const toggleCard = (c) =>
    setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  const readAttachment = (file) =>
    new Promise((resolve) => {
      const isImage = file.type.startsWith("image/");
      const isText =
        file.type.startsWith("text/") ||
        /\.(md|txt|json|csv|js|jsx|ts|tsx|html|css|sql|xml|yaml|yml)$/i.test(file.name);

      if (isImage) {
        compressImageFile(file).then((dataUrl) =>
          resolve({
            id: `${file.name}-${file.size}-${file.lastModified}`,
            name: file.name,
            type: file.type || "image/jpeg",
            size: file.size,
            kind: "image",
            content: "",
            dataUrl,
          })
        );
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          kind: isText ? "text" : "file",
          content: isText ? String(reader.result || "").slice(0, 120000) : "",
          dataUrl: "",
        });
      };
      reader.onerror = () => {
        resolve({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          kind: "file",
          content: "",
          dataUrl: "",
        });
      };

      if (isText) reader.readAsText(file);
      else reader.readAsArrayBuffer(file);
    });

  const addAttachments = useCallback(async (files) => {
    const next = await Promise.all(Array.from(files || []).map(readAttachment));
    setAttachments((current) => {
      const existing = new Set(current.map((item) => item.id));
      return [...current, ...next.filter((item) => !existing.has(item.id))].slice(0, 8);
    });
  }, []);

  const searchInspo = useCallback(async (query) => {
    const q = String(query || "").trim();
    if (q.length < 6) return null;
    if (lastInspoQueryRef.current === q) return null;
    lastInspoQueryRef.current = q;
    setInspoLoading(true);
    try {
      const result = await fetchInspiration(q);
      const images = result.images || [];
      setInspoCandidates(images);
      setInspoMood(result.mood || "");
      if (images.length) {
        setInspoSelectedIds((current) =>
          current.length ? current : images.slice(0, 3).map((img) => img.id)
        );
      }
      return result;
    } catch (error) {
      appendChat("system", error.message || "SurfAgent could not load inspiration images.");
      return null;
    } finally {
      setInspoLoading(false);
    }
  }, [appendChat]);

  useEffect(() => {
    if (stage !== "prompt") return undefined;
    const q = prompt.trim();
    if (q.length < 6) return undefined;
    const timer = setTimeout(() => {
      searchInspo(q);
    }, 800);
    return () => clearTimeout(timer);
  }, [prompt, stage, searchInspo]);

  const continueToCards = useCallback(async () => {
    if (!prompt.trim()) return;
    setStage("cards");
    if (lastInspoQueryRef.current !== prompt.trim()) {
      appendChat("system", "SurfAgent is scanning the web for visual inspiration…");
      const result = await searchInspo(prompt);
      if (result?.images?.length) {
        appendChat(
          "system",
          `SurfAgent found ${result.images.length} images (${(result.queries || []).join(", ")}).`
        );
      }
    }
  }, [prompt, searchInspo, appendChat]);

  const toggleInspo = useCallback((id) => {
    setInspoSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }, []);

  const addInspoImages = useCallback(async (fileList) => {
    const files = Array.from(fileList || [])
      .filter((file) => file.type?.startsWith("image/"))
      .slice(0, 6);
    if (!files.length) return;

    const additions = await Promise.all(
      files.map(async (file) => {
        const dataUrl = await compressImageFile(file);
        if (!dataUrl) return null;
        return {
          id: `inspo-local-${Date.now()}-${file.name}`,
          title: file.name.replace(/\.[^.]+$/, "") || "upload",
          url: dataUrl,
          thumbUrl: dataUrl,
          source: "upload",
        };
      })
    );

    const next = additions.filter(Boolean);
    if (!next.length) return;
    setInspoCandidates((current) => [...current, ...next].slice(0, 24));
    setInspoSelectedIds((current) => [...new Set([...current, ...next.map((item) => item.id)])]);
    appendChat("system", `Added ${next.length} image(s) to inspo board.`);
  }, [appendChat]);

  const chatTargets = useMemo(
    () => [
      { id: "altbot", label: "Altbot", subtitle: "Controller" },
      ...selected
        .filter((name) => AGENT_CARDS.some((card) => card.agent === name))
        .map((name) => {
          const card = AGENT_CARDS.find((item) => item.agent === name);
          return { id: name, label: card?.name || name, subtitle: card?.role || name };
        }),
    ],
    [selected]
  );

  const startResizeRight = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = rightWidth;
    const onMove = (ev) => setRightWidth(Math.min(560, Math.max(280, startW + (startX - ev.clientX))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rightWidth]);

  const startResizeGraph = useCallback((event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = graphHeight;
    const onMove = (ev) => setGraphHeight(Math.min(420, Math.max(150, startH + (ev.clientY - startY))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [graphHeight]);

  const clearWorkspace = useCallback(() => {
    setFileSystem({});
    setActiveFile(null);
    setRunningAgents([]);
    setSearchPhase("idle");
    setPlanSummary("");
    setPlanSteps([]);
    setSearchWinner(null);
    setSearchVerdict(null);
    setSearchComparisons([]);
    setSearchSavings(null);
    searchNodesRef.current = [];
    searchEdgesRef.current = [];
    bestPathRef.current = [];
    searchGraphRef.current = { nodes: [], edges: [] };
    executionGraphRef.current = { nodes: [], edges: [] };
    setSearchGraphData({ branches: [], edges: [], bestPath: [] });
    setNodes([]);
    setEdges([]);
    setStatus((current) => ({ ...current, error: "", runPath: "" }));
  }, [setNodes, setEdges]);

  const deleteWorkspaceFile = useCallback(
    (filePath) => {
      if (!filePath || !fileSystem[filePath]) return;
      const sorted = Object.keys(fileSystem).sort();
      const idx = sorted.indexOf(filePath);
      const remaining = sorted.filter((path) => path !== filePath);
      const nextActive =
        activeFile === filePath ? (remaining[idx] ?? remaining[idx - 1] ?? null) : activeFile;
      setFileSystem((current) => {
        const next = { ...current };
        delete next[filePath];
        return next;
      });
      setActiveFile(nextActive);
      appendChat("system", `Removed ${filePath} from workspace (not deleted on GitHub until you push).`);
    },
    [fileSystem, activeFile, appendChat]
  );

  useEffect(() => {
    if (stage !== "ide" || !activeFile) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
      event.preventDefault();
      deleteWorkspaceFile(activeFile);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stage, activeFile, deleteWorkspaceFile]);

  const clearGitHubRepo = useCallback(async () => {
    if (!githubRepo?.name || outputBusy) return;
    if (!authUser?.authenticated) {
      window.location.assign("/api/auth/github");
      return;
    }
    setOutputBusy("clear-repo");
    try {
      const res = await fetch("/api/github/clear-repo", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: githubRepo.owner, repoName: githubRepo.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not clear repo");
      clearWorkspace();
      if (githubRepo.fullName) repoAutoLoadRef.current.add(githubRepo.fullName);
      appendChat("controller", CLEAR_GITHUB_REPO_REPLY(githubRepo.fullName, data.deleted ?? 0));
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      appendChat("system", error.message || "GitHub repo clear failed");
    } finally {
      setOutputBusy("");
    }
  }, [githubRepo, outputBusy, authUser, clearWorkspace, appendChat]);

  const runSwarmFromPrompt = useCallback(
    async ({ promptText, resetWorkspace = false } = {}) => {
      const raw = String(promptText || "").trim();
      if (!raw) return false;
      if (searchPhase === "searching" || runningAgents.length > 0) {
        appendChat("system", "Swarm is already running — wait for it to finish.");
        return false;
      }
      if (!selected.length) {
        appendChat("system", "Select at least one agent (cards step) before running a swarm.");
        return false;
      }

      setStage("ide");
      if (resetWorkspace) {
        setFileSystem({});
        setActiveFile(null);
      }
      setRunningAgents([]);
      setSearchPhase("searching");
      setBottomPanelTab("graph");
      setSearchLog([]);
      setSearchWinner(null);
      setSearchVerdict(null);
      setSearchComparisons([]);
      setSearchSavings(null);
      setPlanSummary("");
      searchNodesRef.current = [];
      searchEdgesRef.current = [];
      bestPathRef.current = [];
      executionGraphRef.current = { nodes: [], edges: [] };
      setNodes([]);
      setEdges([]);
      setStatus((current) => ({ ...current, error: "" }));

      const fileNames = Object.keys(fileSystem);
      const swarmPrompt =
        !resetWorkspace && fileNames.length
          ? `Existing project files: ${fileNames.join(", ")}\n\nChange request: ${raw}`
          : raw;

      if (resetWorkspace) setPrompt(raw);

      const inspoSelection = inspoCandidates
        .filter((img) => inspoSelectedIds.includes(img.id))
        .map(({ id, title, url, source, thumbUrl }) => ({ id, title, url, source, thumbUrl }));
      if (inspoSelection.length) {
        appendChat("system", `Using ${inspoSelection.length} inspiration image(s) as visual context.`);
      }

      try {
        await streamSwarmGenerate(
          {
            prompt: swarmPrompt,
            agents: selected,
            attachments,
            inspoSelection,
            sessionId,
          },
          swarmHandlers()
        );
        return true;
      } catch (error) {
        setRunningAgents([]);
        setSearchPhase("idle");
        setStatus((current) => ({ ...current, error: error.message }));
        appendChat("system", error.message || "Swarm failed");
        return false;
      }
    },
    [
      searchPhase,
      runningAgents.length,
      selected,
      fileSystem,
      inspoCandidates,
      inspoSelectedIds,
      attachments,
      sessionId,
      appendChat,
      swarmHandlers,
    ]
  );

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text) return;
    const targetLabel =
      chatTarget === "altbot"
        ? "Altbot"
        : chatTargets.find((item) => item.id === chatTarget)?.label || chatTarget;
    appendChat("user", text, { target: targetLabel });
    setChatInput("");

    const intent = matchChatIntent(text);
    const hasFiles = Object.keys(fileSystem).length > 0;

    if (intent?.type === "clear-workspace") {
      clearWorkspace();
      if (githubRepo?.fullName) repoAutoLoadRef.current.add(githubRepo.fullName);
      appendChat("controller", CLEAR_WORKSPACE_REPLY);
      return;
    }

    if (intent?.type === "clear-github-repo") {
      if (!githubRepo?.name) {
        appendChat("controller", "No GitHub repo linked. Pick a repo first.");
        setStage("repo");
        return;
      }
      if (!authUser?.authenticated) {
        appendChat("controller", "Sign in with GitHub first…");
        window.location.assign("/api/auth/github");
        return;
      }
      appendChat("controller", `Deleting all files from ${githubRepo.fullName} on GitHub…`);
      clearGitHubRepo();
      return;
    }

    if (intent?.type === "push") {
      if (!hasFiles || !status.runId) {
        appendChat(
          "controller",
          "Nothing to push — the session is empty. Run a new swarm to generate files first."
        );
        return;
      }
      if (!githubRepo?.name) {
        appendChat("controller", "No GitHub repo linked. Pick or create one first.");
        setStage("repo");
        return;
      }
      if (!authUser?.authenticated) {
        appendChat("controller", "Sign in with GitHub to push — opening auth…");
        window.location.assign("/api/auth/github");
        return;
      }
      appendChat("controller", `Pushing generated files to ${githubRepo.fullName}…`);
      pushToGitHub();
      return;
    }

    if (intent?.type === "download") {
      if (!hasFiles || !status.runId) {
        appendChat("controller", "Nothing to download — generate files with a swarm first.");
        return;
      }
      appendChat("controller", "Downloading project zip…");
      downloadZip();
      return;
    }

    if (intent?.type === "run-preview") {
      if (!hasFiles || !status.runId) {
        appendChat("controller", "Nothing to run — generate files with a swarm first.");
        return;
      }
      const hasBackend = Object.keys(fileSystem).some(
        (name) => name === "server.js" || name.endsWith("server.js")
      );
      if (!hasBackend) {
        appendChat("controller", "Run preview needs server.js in the generated output.");
        return;
      }
      appendChat("controller", "Starting local preview…");
      runPreview();
      return;
    }

    if (chatMode === "code") {
      appendChat("controller", "Running hyperreasoning swarm…");
      await runSwarmFromPrompt({ promptText: text, resetWorkspace: false });
      return;
    }

    if (isGreeting(text)) {
      const agentKey = chatTargetKey(chatTarget);
      const reply = greetingReply(agentKey, {
        files: Object.keys(fileSystem),
        fileSystem,
      });
      if (chatTarget === "altbot") {
        appendChat("controller", reply);
      } else {
        appendChat("agent", reply, { agent: chatTarget });
      }
      return;
    }

    const fileContents = Object.entries(fileSystem)
      .filter(([, entry]) => {
        if (chatTarget === "altbot") return true;
        return entry?.agent === chatTarget;
      })
      .slice(0, chatTarget === "altbot" ? 2 : 1)
      .map(([filename, entry]) => ({
        filename,
        code: String(entry?.code || "").slice(0, chatTarget === "altbot" ? 500 : 800),
      }));
    const inspoSelection = inspoCandidates
      .filter((img) => inspoSelectedIds.includes(img.id))
      .map(({ id, title, url, source, thumbUrl }) => ({ id, title, url, source, thumbUrl }));

    try {
      const reply = await postChat({
        message: text,
        target: chatTarget,
        context: {
          prompt,
          planSummary: hasFiles ? planSummary : "",
          searchWinner: hasFiles ? searchWinner : null,
          selectedAgents: selected,
          files: Object.keys(fileSystem),
          fileContents,
          searchBranches: hasFiles ? searchGraphData.branches : [],
          searchLog: hasFiles ? searchLog.map((line) => line.text) : [],
          inspoSelection,
        },
      });
      appendChat(reply.role || "controller", reply.text, { agent: reply.agent });
    } catch (error) {
      appendChat("system", error.message || "Chat failed");
    }
  }, [
    chatInput,
    chatTarget,
    chatTargets,
    appendChat,
    prompt,
    planSummary,
    searchWinner,
    selected,
    fileSystem,
    searchGraphData.branches,
    searchLog,
    inspoCandidates,
    inspoSelectedIds,
    clearWorkspace,
    clearGitHubRepo,
    status.runId,
    githubRepo,
    authUser,
    pushToGitHub,
    downloadZip,
    runPreview,
    setStage,
    chatMode,
    runSwarmFromPrompt,
  ]);

  const openIdeDirectly = useCallback(() => {
    setStage("ide");
    appendChat("system", "IDE ready — use Code mode in chat to build or change files with hyperreasoning.");
  }, [appendChat]);

  const init = useCallback(async () => {
    appendChat("user", `Initialize swarm: ${prompt}`);
    await runSwarmFromPrompt({ promptText: prompt, resetWorkspace: true });
  }, [prompt, appendChat, runSwarmFromPrompt]);

  const showSearchGraph = useCallback(() => {
    setBottomPanelTab("graph");
    paintSearchGraph();
  }, [paintSearchGraph]);

  const launchFromIntro = useCallback(() => setStage("repo"), []);
  const resumeFromIntro = useCallback(() => {
    const target =
      savedSession?.stage && savedSession.stage !== "intro" ? savedSession.stage : "ide";
    setStage(target);
    if (searchGraphRef.current.nodes.length) {
      setNodes(searchGraphRef.current.nodes);
      setEdges(searchGraphRef.current.edges);
      setBottomPanelTab("graph");
    }
  }, [savedSession, setNodes, setEdges]);

  const goHome = useCallback(() => setStage("intro"), []);

  const renderInspoBoard = (compact = false) => (
    <div className={`inspo-board ${compact ? "compact" : ""}`}>
      <div className="inspo-head">
        <span>SURFAGENT · INSPO BOARD</span>
        <div className="inspo-head-actions">
          {inspoMood ? <span className="inspo-mood">{inspoMood}</span> : null}
          <button
            type="button"
            className="inspo-add-btn"
            title="Add inspiration image"
            onClick={() => inspoFileInputRef.current?.click()}
          >
            +
          </button>
        </div>
      </div>
      <input
        ref={inspoFileInputRef}
        className="file-hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          addInspoImages(e.target.files);
          e.target.value = "";
        }}
      />
      {inspoLoading && <div className="inspo-empty">Scanning the web…</div>}
      {!inspoLoading && inspoCandidates.length === 0 && (
        <div className="inspo-empty">
          {stage === "prompt" || prompt.trim().length >= 6
            ? "SurfAgent will search as you type…"
            : "Type a prompt (6+ chars) to search, or tap + to add images."}
        </div>
      )}
      <div className="inspo-grid">
        <button
          type="button"
          className="inspo-tile inspo-add-tile"
          title="Add inspiration image"
          onClick={() => inspoFileInputRef.current?.click()}
        >
          <span className="inspo-add-mark">+</span>
          <span className="inspo-tile-label">ADD</span>
        </button>
        {inspoCandidates.map((img) => {
          const on = inspoSelectedIds.includes(img.id);
          return (
            <button
              key={img.id}
              type="button"
              className={`inspo-tile ${on ? "on" : ""}`}
              onClick={() => toggleInspo(img.id)}
              title={img.title}
            >
              <img src={proxyImageUrl(img.thumbUrl || img.url)} alt={img.title} loading="lazy" />
              <span className="inspo-tile-label">{on ? "SELECTED" : "OFF"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const css = `
    * { box-sizing: border-box; margin: 0; }
    body {
      font-family: "VT323", monospace;
      color: ${CRT.text};
      background: #1a1a1a;
      min-height: 100vh;
      scrollbar-width: thin;
      scrollbar-color: ${CRT.textDim} #133f3f;
    }
    body::-webkit-scrollbar,
    .monitor ::-webkit-scrollbar,
    .viewport ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    body::-webkit-scrollbar-track,
    .monitor ::-webkit-scrollbar-track,
    .viewport ::-webkit-scrollbar-track {
      background: #133f3fcc;
      border: 1px solid #3a787866;
      box-shadow: inset 0 0 8px #00000033;
    }
    body::-webkit-scrollbar-thumb,
    .monitor ::-webkit-scrollbar-thumb,
    .viewport ::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, ${CRT.textDim} 0%, ${CRT.text} 100%);
      border: 2px solid ${CRT.screenEdge};
      box-shadow: 0 0 6px #dfff3f33;
    }
    body::-webkit-scrollbar-thumb:hover,
    .monitor ::-webkit-scrollbar-thumb:hover,
    .viewport ::-webkit-scrollbar-thumb:hover {
      background: ${CRT.textSoft};
      box-shadow: 0 0 10px #dfff3f55;
    }
    body::-webkit-scrollbar-corner,
    .monitor ::-webkit-scrollbar-corner,
    .viewport ::-webkit-scrollbar-corner {
      background: #133f3f;
    }
    .monitor,
    .monitor * {
      scrollbar-width: thin;
      scrollbar-color: ${CRT.textDim} #133f3f99;
    }
    .monaco-editor .scrollbar .slider {
      background: ${CRT.textDim} !important;
      border: 1px solid ${CRT.screenEdge} !important;
      border-radius: 0 !important;
    }
    .monaco-editor .scrollbar .slider:hover {
      background: ${CRT.textSoft} !important;
    }
    .monaco-editor .scrollbar.vertical {
      width: 10px !important;
    }
    .monaco-editor .scrollbar.horizontal {
      height: 10px !important;
    }
    input, button { font-family: inherit; }
    .viewport {
      width: 100vw;
      height: 100dvh;
      display: flex;
      overflow: hidden;
    }
    .viewport-full { height: 100dvh; }
    .monitor {
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, ${CRT.beigeHi}, ${CRT.beige});
      border: 4px solid ${CRT.beigeLo};
      border-radius: 0;
      padding: 10px;
      box-shadow:
        inset 2px 2px 0 #eee2cc,
        inset -3px -3px 0 #7a6a4c;
      display: flex;
      flex-direction: column;
    }
    .monitor-full { max-width: none; }
    .monitor-bezel {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 6px 12px;
      color: ${CRT.beigeLo};
      font-size: 18px;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
    .monitor-label { flex: 1; }
    .monitor-slot {
      width: 48px;
      height: 8px;
      background: #2a2a2a;
      border: 2px solid ${CRT.beigeLo};
      border-radius: 1px;
      box-shadow: inset 0 1px 3px #000;
    }
    .monitor-base {
      height: 14px;
      margin-top: 10px;
      background: linear-gradient(180deg, ${CRT.beige}, #9a8a6c);
      border: 2px solid ${CRT.beigeLo};
      border-radius: 0 0 6px 6px;
    }
    .crt-screen {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: linear-gradient(165deg, ${CRT.screenHi}, ${CRT.screen});
      border: 5px solid ${CRT.screenEdge};
      border-radius: 2px;
      box-shadow: inset 0 0 80px #00000035;
      position: relative;
      overflow: hidden;
    }
    .crt-screen::after {
      content: "";
      position: absolute;
      inset: 0;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        #00000010 2px,
        #00000010 4px
      );
      pointer-events: none;
      z-index: 1;
    }
    .screen-content {
      flex: 1;
      position: relative;
      z-index: 2;
      padding: 2rem;
      min-height: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.25rem;
    }
    .screen-content.stage-cards {
      padding: 1.25rem 1.5rem 1rem;
      justify-content: flex-start;
      overflow: hidden;
      width: 100%;
      max-width: 100%;
    }
    .crt-scroll {
      -webkit-overflow-scrolling: touch;
    }
    .stage-cards-scroll {
      flex: 1;
      min-height: 0;
      width: 100%;
      max-width: 100%;
      overflow-y: auto;
      overflow-x: clip;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.85rem;
      padding-bottom: 0.5rem;
      -webkit-overflow-scrolling: touch;
    }
    .stage-cards-scroll .card-grid {
      gap: 0.65rem;
      width: 100%;
      max-width: min(100%, 900px);
    }
    .stage-cards-scroll .card-copy {
      min-height: 68px;
      padding: 7px 9px 8px;
    }
    .stage-cards-footer {
      flex-shrink: 0;
      width: 100%;
      display: flex;
      justify-content: center;
      padding: 0.75rem 0 0.25rem;
      border-top: 1px solid #3a787866;
      background: linear-gradient(180deg, transparent, ${CRT.screen} 35%);
      position: relative;
      z-index: 3;
    }
    .screen-prompt {
      width: 100%;
      max-width: 640px;
      font-size: 30px;
      text-transform: uppercase;
      text-align: center;
      cursor: text;
    }
    .typewriter {
      min-height: 42px;
      color: ${CRT.textSoft};
      letter-spacing: 3px;
      text-shadow: 0 0 12px #dfff3f66, 2px 2px 0 #0003;
    }
    @keyframes cursor-blink { 50% { opacity: 0; } }
    .terminal-line {
      width: 100%;
      min-height: 46px;
      margin-top: 1.2rem;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 10px;
      color: ${CRT.text};
      font-size: 30px;
      letter-spacing: 2px;
      text-shadow: 0 0 10px #dfff3f66, 2px 2px 0 #0004;
      overflow-wrap: anywhere;
    }
    .prompt-cursor {
      width: 15px;
      height: 30px;
      display: inline-block;
      background: ${CRT.text};
      box-shadow: 0 0 10px ${CRT.text}88;
      animation: cursor-blink 0.85s steps(1) infinite;
    }
    .prompt-hidden-input {
      position: fixed;
      left: -1000px;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
    .file-hidden-input { display: none; }
    .attachment-row {
      margin-top: 0.95rem;
      display: flex;
      justify-content: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .attach-btn {
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #0000001f;
      border: 0;
      border-radius: 50%;
      color: ${CRT.text};
      font: inherit;
      font-size: 32px;
      line-height: 1;
      text-transform: uppercase;
      cursor: pointer;
      text-shadow: 0 0 10px #dfff3f77, 1px 1px 0 #0005;
    }
    .attach-btn:hover { color: ${CRT.textSoft}; box-shadow: 0 0 14px ${CRT.text}33; }
    .attachment-list {
      width: min(100%, 660px);
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .attachment-chip {
      max-width: 210px;
      padding: 5px 8px;
      border: 1px solid ${CRT.textDim};
      border-radius: 999px;
      background: #133f3fcc;
      color: ${CRT.textSoft};
      font-size: 17px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow: 1px 1px 0 #0005;
    }
    .crt-title {
      color: ${CRT.textSoft};
      font-size: 34px;
      letter-spacing: 4px;
      text-shadow: 0 0 12px #dfff3f55, 2px 2px 0 #0004;
    }
    .crt-sub {
      color: ${CRT.text};
      font-size: 24px;
      text-shadow: 0 0 8px #dfff3f44;
    }
    .card-grid {
      width: min(100%, 900px);
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 205px));
      gap: 0.9rem;
      justify-content: center;
    }
    .card {
      min-width: 0;
      padding: 0;
      border: 0;
      cursor: pointer;
      color: ${CRT.textDim};
      text-align: left;
      background: transparent;
      transition: transform 0.12s;
      position: relative;
    }
    .card:hover:not(.locked) {
      transform: translateY(-3px);
    }
    .card-frame {
      display: block;
      position: relative;
      overflow: hidden;
      border: 2px solid ${CRT.textDim};
      border-radius: 14px;
      background: #00000024;
      box-shadow: inset 0 0 18px #00000030;
      aspect-ratio: 0.72;
    }
    .card-image {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      object-position: center;
      filter: saturate(0.7) contrast(1.08);
      opacity: 0.72;
      transition: filter 0.12s, opacity 0.12s;
    }
    .card-copy {
      display: block;
      min-height: 82px;
      margin-top: 8px;
      padding: 9px 11px 10px;
      border: 2px solid ${CRT.textDim};
      border-radius: 10px;
      background: #133f3fcc;
      box-shadow: inset 0 0 14px #00000028;
      text-transform: uppercase;
    }
    .card-name {
      display: block;
      color: ${CRT.textSoft};
      font-size: 26px;
      line-height: 1;
      text-shadow: 0 0 9px #dfff3f66, 1px 1px 0 #0005;
    }
    .card-role {
      display: block;
      margin-top: 4px;
      color: ${CRT.text};
      font-size: 20px;
      letter-spacing: 1px;
      text-shadow: 1px 1px 0 #0004;
    }
    .card-description {
      display: block;
      margin-top: 4px;
      color: ${CRT.textSoft};
      font-size: 16px;
      line-height: 1.05;
      text-shadow: 1px 1px 0 #0005;
    }
    .card-model {
      display: block;
      margin-top: 4px;
      color: ${CRT.led};
      font-size: 13px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      text-shadow: 1px 1px 0 #0005;
    }
    .card-state {
      position: absolute;
      top: 7px;
      right: 7px;
      padding: 2px 6px;
      border: 1px solid currentColor;
      background: #163f3fe6;
      color: ${CRT.text};
      font-size: 16px;
      text-transform: uppercase;
      white-space: nowrap;
      text-shadow: 1px 1px 0 #0006;
    }
    .card.on {
      color: ${CRT.text};
    }
    .card.on .card-frame,
    .card.on .card-copy {
      border-color: ${CRT.text};
      box-shadow: 0 0 16px ${CRT.text}44;
    }
    .card.on .card-image {
      filter: saturate(1) contrast(1.05);
      opacity: 1;
    }
    .card.locked {
      cursor: default;
    }
    .card.locked .card-state { color: ${CRT.led}; }
    .card.locked .card-frame,
    .card.locked .card-copy {
      border-color: ${CRT.led};
      box-shadow: 0 0 14px ${CRT.led}33;
    }
    .btn {
      background: transparent;
      border: 0;
      color: ${CRT.text};
      padding: 2px 8px;
      font-size: 26px;
      cursor: pointer;
      text-transform: uppercase;
      text-shadow: 0 0 10px #dfff3f66, 2px 2px 0 #0004;
    }
    .btn:hover:not(:disabled) { color: ${CRT.textSoft}; }
    .btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .led {
      width: 10px; height: 10px; border-radius: 50%;
      background: ${CRT.led};
      box-shadow: 0 0 8px ${CRT.led};
      display: inline-block;
      margin-right: 8px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 50% { opacity: 0.6; } }
    ${introCss}
    ${flowNodeCss}
    .ide {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      position: relative;
      z-index: 2;
    }
    .ide-crt {
      background: transparent;
      color: ${CRT.text};
      font-family: "VT323", monospace;
    }
    .ide-header {
      font-size: 18px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .ide-header-title { color: ${CRT.textSoft}; }
    .ide-header-repo {
      color: ${CRT.textDim};
      font-size: 16px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 220px;
    }
    .ide-header-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .crt-statusbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      height: 28px;
      padding: 0 12px;
      border-top: 2px solid #3a787899;
      background: #00000028;
      color: ${CRT.textDim};
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .ide-status-item { opacity: 0.95; }
    .ide-status-item:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ide-bottom-panel {
      flex-shrink: 0;
      min-height: 120px;
      max-height: 480px;
      display: flex;
      flex-direction: column;
      background: #00000022;
      border-top: 2px solid #3a787899;
    }
    .panel-tabs {
      flex-shrink: 0;
      display: flex;
      gap: 0;
      background: #00000028;
      border-bottom: 1px solid #3a787866;
    }
    .panel-tab {
      position: relative;
      background: transparent;
      border: 0;
      border-right: 1px solid #3a787866;
      color: ${CRT.textDim};
      padding: 5px 12px;
      font: inherit;
      font-size: 15px;
      text-transform: uppercase;
      letter-spacing: 1px;
      cursor: pointer;
    }
    .panel-tab.on {
      color: ${CRT.textSoft};
      background: #00000030;
      box-shadow: inset 0 -2px 0 ${CRT.textDim};
    }
    .panel-tab-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-left: 6px;
      border-radius: 50%;
      background: ${CRT.led};
      vertical-align: middle;
      animation: explorer-pulse 1.2s ease-in-out infinite;
    }
    .panel-body {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .graph-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${CRT.textDim};
      font-size: 18px;
      padding: 16px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .terminal-panel {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: #00000035;
      font-family: "VT323", monospace;
      font-size: 16px;
    }
    .terminal-log {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 8px 10px;
      color: ${CRT.textSoft};
      white-space: pre-wrap;
      word-break: break-word;
      text-shadow: 0 0 8px #dfff3f33;
    }
    .terminal-line-input { color: ${CRT.text}; margin-bottom: 4px; }
    .terminal-line-output { color: ${CRT.textSoft}; margin-bottom: 6px; }
    .terminal-line-system { color: ${CRT.textDim}; margin-bottom: 6px; }
    .terminal-line-error { color: #ff9999; margin-bottom: 6px; }
    .terminal-input-row {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-top: 1px solid #3a787866;
      background: #00000028;
    }
    .terminal-prompt { color: ${CRT.text}; flex-shrink: 0; }
    .terminal-input {
      flex: 1;
      background: transparent;
      border: 0;
      color: ${CRT.textSoft};
      font: inherit;
      font-size: 16px;
      outline: none;
    }
    .panel-body .graph-canvas {
      flex: 1;
      min-height: 0;
    }
    .graph-panel-stack {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .graph-panel-stack .graph-canvas {
      flex: 1;
      min-height: 120px;
    }
    .ide-crt .work-main {
      border-right: 2px solid #3a787899;
      background: transparent;
    }
    .ide-crt .right {
      border-left: 0;
      background: #00000012;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
    .ide-crt .chat {
      flex: 1 1 auto;
      min-height: 140px;
      border-bottom: 0;
      border-top: 2px solid #3a787866;
    }
    .ide-crt .inspo-board {
      flex: 0 0 auto;
      min-height: 200px;
      max-height: 46%;
      overflow: hidden;
      border-top: 0;
      border-bottom: 1px solid #3a787866;
    }
    .ide-crt .right.ui-bot-active .inspo-board {
      min-height: 220px;
      max-height: 52%;
    }
    .ide-workspace {
      flex: 1;
      display: flex;
      min-height: 0;
      overflow: hidden;
    }
    .header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0 10px;
      border-bottom: 2px solid #3a787899;
      font-size: 20px;
      text-transform: uppercase;
    }
    .output-bar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 6px 10px;
      border-bottom: 2px solid #3a787866;
      background: #00000018;
      font-size: 16px;
    }
    .output-btn {
      background: transparent;
      border: 1px solid ${CRT.textDim};
      color: ${CRT.text};
      padding: 2px 10px;
      font: inherit;
      font-size: 16px;
      cursor: pointer;
      text-transform: uppercase;
    }
    .output-btn:hover:not(:disabled) {
      border-color: ${CRT.text};
      color: ${CRT.textSoft};
    }
    .output-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .output-hint {
      color: ${CRT.textDim};
      font-size: 14px;
      margin-left: auto;
    }
    .auth-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 15px;
      color: ${CRT.textDim};
      text-transform: uppercase;
    }
    .auth-chip img {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 1px solid ${CRT.textDim};
    }
    .auth-link {
      background: transparent;
      border: 0;
      color: ${CRT.text};
      font: inherit;
      font-size: 16px;
      cursor: pointer;
      text-transform: uppercase;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .repo-panel {
      width: min(100%, 680px);
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.85rem;
      text-align: center;
    }
    .repo-panel .crt-title,
    .repo-panel .crt-sub { text-align: center; }
    .repo-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .repo-refresh {
      background: transparent;
      border: 1px solid ${CRT.textDim};
      color: ${CRT.text};
      padding: 4px 10px;
      font: inherit;
      font-size: 15px;
      cursor: pointer;
      text-transform: uppercase;
    }
    .repo-refresh:hover:not(:disabled) {
      border-color: ${CRT.text};
      color: ${CRT.textSoft};
    }
    .repo-refresh:disabled { opacity: 0.4; cursor: wait; }
    .repo-segments {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      border: 2px solid ${CRT.textDim};
      background: #133f3fcc;
    }
    .repo-segment {
      padding: 10px 12px;
      border: 0;
      border-right: 2px solid ${CRT.textDim};
      background: transparent;
      color: ${CRT.textDim};
      font: inherit;
      font-size: 20px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .repo-segment:last-child { border-right: 0; }
    .repo-segment.on {
      color: ${CRT.textSoft};
      background: #00000030;
      text-shadow: 0 0 10px #dfff3f55;
    }
    .repo-card {
      border: 2px solid ${CRT.textDim};
      border-radius: 10px;
      background: #133f3fcc;
      box-shadow: inset 0 0 18px #00000028;
      overflow: hidden;
      text-align: left;
    }
    .repo-search-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 2px solid #3a787866;
    }
    .repo-search-mark {
      color: ${CRT.textDim};
      font-size: 22px;
      line-height: 1;
      flex-shrink: 0;
    }
    .repo-input {
      width: 100%;
      background: transparent;
      border: 0;
      color: ${CRT.textSoft};
      padding: 0;
      font: inherit;
      font-size: 22px;
      text-transform: lowercase;
    }
    .repo-input::placeholder { color: ${CRT.textDim}; opacity: 1; }
    .repo-input:focus { outline: none; }
    .repo-input-boxed {
      width: 100%;
      background: #133f3fcc;
      border: 2px solid ${CRT.textDim};
      color: ${CRT.textSoft};
      padding: 12px 14px;
      font: inherit;
      font-size: 26px;
      text-align: center;
      text-transform: lowercase;
    }
    .repo-input-boxed:focus {
      outline: none;
      border-color: ${CRT.text};
    }
    .repo-hint {
      padding: 8px 12px 0;
      color: ${CRT.textDim};
      font-size: 16px;
      text-align: center;
      text-transform: uppercase;
    }
    .repo-list {
      max-height: min(42vh, 320px);
      overflow-y: auto;
    }
    .repo-list-item {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 4px 10px;
      padding: 10px 12px;
      border: 0;
      border-bottom: 1px solid #3a787866;
      background: transparent;
      color: ${CRT.text};
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .repo-list-item:hover:not(:disabled) {
      background: #00000028;
      color: ${CRT.textSoft};
    }
    .repo-list-item:disabled { opacity: 0.5; cursor: wait; }
    .repo-list-name {
      font-size: 20px;
      text-transform: uppercase;
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .repo-list-sub {
      grid-column: 1;
      color: ${CRT.textDim};
      font-size: 14px;
      text-transform: uppercase;
    }
    .repo-list-badge {
      grid-row: 1 / span 2;
      align-self: center;
      padding: 2px 7px;
      border: 1px solid currentColor;
      color: ${CRT.textDim};
      font-size: 13px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .repo-list-item:hover .repo-list-badge { color: ${CRT.text}; }
    .repo-list-empty {
      padding: 28px 16px;
      color: ${CRT.textDim};
      font-size: 18px;
      text-align: center;
      text-transform: uppercase;
      line-height: 1.35;
    }
    .repo-list-empty.err { color: ${CRT.text}; }
    .repo-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 10px 12px;
      border-top: 2px solid #3a787866;
      background: #00000018;
    }
    .repo-footer-meta {
      color: ${CRT.textDim};
      font-size: 15px;
      text-transform: uppercase;
    }
    .repo-action {
      background: transparent;
      border: 2px solid ${CRT.text};
      color: ${CRT.textSoft};
      padding: 6px 14px;
      font: inherit;
      font-size: 18px;
      cursor: pointer;
      text-transform: uppercase;
      text-shadow: 0 0 8px #dfff3f44;
    }
    .repo-action:hover:not(:disabled) {
      color: ${CRT.text};
      box-shadow: 0 0 12px ${CRT.text}33;
    }
    .repo-action:disabled { opacity: 0.35; cursor: not-allowed; }
    .repo-action.ghost {
      border-color: ${CRT.textDim};
      color: ${CRT.text};
      text-shadow: none;
    }
    .repo-ready {
      padding: 16px 18px;
      border: 2px solid ${CRT.text};
      border-radius: 10px;
      background: #133f3fcc;
      color: ${CRT.textSoft};
      font-size: 22px;
      word-break: break-all;
      box-shadow: 0 0 16px ${CRT.text}33;
    }
    .repo-ready-label {
      display: block;
      margin-bottom: 6px;
      color: ${CRT.textDim};
      font-size: 15px;
      letter-spacing: 2px;
    }
    .repo-ready a {
      color: ${CRT.textSoft};
      text-decoration: none;
      text-shadow: 0 0 10px #dfff3f55;
    }
    .repo-ready a:hover { color: ${CRT.text}; text-decoration: underline; }
    .repo-ready-meta {
      display: block;
      margin-top: 8px;
      color: ${CRT.textDim};
      font-size: 15px;
      text-transform: uppercase;
    }
    .repo-cta-row {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .explorer {
      width: 220px;
      flex-shrink: 0;
      border-right: 1px solid #2a5a5a;
      background: #0a1212;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      color: #c5c5c5;
    }
    .explorer-header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #8a9a9a;
      border-bottom: 1px solid #1e3030;
    }
    .explorer-delete {
      flex-shrink: 0;
      background: transparent;
      border: 1px solid #6a4040;
      color: #ff9999;
      padding: 2px 7px;
      font: inherit;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      cursor: pointer;
      border-radius: 2px;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .explorer-delete:hover {
      border-color: #ff7777;
      color: #ffcccc;
      background: #ff999922;
    }
    .explorer-section {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 4px 0 8px;
    }
    .explorer-section-label {
      padding: 4px 12px 6px;
      font-size: 11px;
      font-weight: 600;
      color: #9cdcfe;
      letter-spacing: 0.02em;
    }
    .explorer-empty {
      padding: 6px 12px;
      color: #6a7a7a;
      font-size: 12px;
    }
    .explorer-tree { user-select: none; }
    .explorer-row {
      display: flex;
      align-items: center;
      gap: 4px;
      min-height: 22px;
      padding-right: 8px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .explorer-row:hover { background: #ffffff0a; }
    .explorer-row.file.active {
      background: #2a4a4a;
      color: #fff;
    }
    .explorer-row.file.writing .explorer-label { color: #9a9a6a; }
    .explorer-chevron {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
    }
    .explorer-chevron::before {
      content: "";
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 5px solid #8a9a9a;
      transition: transform 0.12s ease;
    }
    .explorer-chevron.open::before { transform: rotate(90deg); }
    .explorer-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
    }
    .folder-icon {
      position: relative;
      border-radius: 1px;
    }
    .folder-icon::before {
      content: "";
      width: 11px;
      height: 8px;
      border-radius: 1px;
      background: #8a7a4a;
      box-shadow: 0 -3px 0 0 #a89458 inset;
    }
    .file-icon {
      border: 1px solid #5a6a6a;
      border-radius: 1px;
      background: #1a2222;
      font-size: 8px;
      font-weight: 600;
      color: #8a9a9a;
    }
    .file-icon.kind-js::before,
    .file-icon.kind-ts::before { content: "JS"; color: #dcdcaa; }
    .file-icon.kind-json::before { content: "{}"; color: #ce9178; }
    .file-icon.kind-css::before { content: "#"; color: #569cd6; }
    .file-icon.kind-html::before { content: "<>"; color: #ce9178; }
    .file-icon.kind-sql::before { content: "DB"; color: #4ec9b0; }
    .file-icon.kind-md::before { content: "MD"; color: #9cdcfe; }
    .file-icon.kind-file::before { content: "··"; letter-spacing: -2px; }
    .explorer-label {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }
    .explorer-status {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #c7da2e;
      flex-shrink: 0;
      animation: explorer-pulse 1.2s ease-in-out infinite;
    }
    @keyframes explorer-pulse {
      50% { opacity: 0.35; }
    }
    .work-main {
      flex: 1;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-right: 2px solid #3a787899;
    }
    .center {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .resize-handle-v,
    .resize-handle-h {
      flex-shrink: 0;
      background: ${CRT.beigeLo};
      opacity: 0.55;
      transition: opacity 0.15s;
      z-index: 4;
    }
    .resize-handle-v {
      width: 8px;
      cursor: col-resize;
      border-left: 1px solid #3a787866;
      border-right: 1px solid #3a787866;
    }
    .resize-handle-h {
      height: 8px;
      cursor: row-resize;
      border-top: 1px solid #3a787866;
      border-bottom: 1px solid #3a787866;
    }
    .resize-handle-v:hover,
    .resize-handle-h:hover {
      opacity: 0.9;
      background: ${CRT.textDim};
    }
    .tabs {
      display: flex;
      gap: 0;
      padding: 0;
      border-bottom: 1px solid #2a5a5a;
      flex-wrap: nowrap;
      overflow-x: auto;
      background: #0d1515;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .tab {
      padding: 6px 12px;
      font-size: 13px;
      border: none;
      border-right: 1px solid #1e3030;
      cursor: pointer;
      color: #9a9a9a;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .tab:hover { background: #ffffff08; color: #d0d0d0; }
    .tab.on {
      color: #fff;
      background: #1a2a2a;
      border-bottom: 2px solid ${CRT.textDim};
      margin-bottom: -1px;
    }
    .editor { flex: 1; min-height: 0; }
    .right {
      flex-shrink: 0;
      min-width: 280px;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-left: 0;
      background: #00000010;
    }
    .graph-dock {
      flex-shrink: 0;
      min-height: 200px;
      max-height: 520px;
      background: #080e0e;
      display: flex;
      flex-direction: column;
      border-top: 2px solid #3a787899;
    }
    .graph {
      min-height: 0;
      background: #00000015;
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .graph-head {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 5px 8px;
      border-bottom: 1px solid #3a787866;
      font-size: 15px;
      text-transform: uppercase;
      color: ${CRT.textDim};
    }
    .graph-toggle {
      background: transparent;
      border: 1px solid ${CRT.textDim};
      color: ${CRT.text};
      padding: 1px 6px;
      font: inherit;
      font-size: 14px;
      cursor: pointer;
      text-transform: uppercase;
    }
    .graph-toggle.on { border-color: ${CRT.text}; color: ${CRT.textSoft}; }
    .graph-canvas { flex: 1; min-height: 140px; height: 100%; }
    .graph-canvas .react-flow { width: 100%; height: 100%; min-height: 140px; }
    .header-home {
      padding: 2px 8px;
      border: 1px solid ${CRT.textDim};
      background: transparent;
      color: ${CRT.textDim};
      font: inherit;
      font-size: 14px;
      text-transform: uppercase;
      cursor: pointer;
      margin-right: 6px;
    }
    .header-home:hover { color: ${CRT.text}; border-color: ${CRT.text}; }
    .hyper-panel {
      flex-shrink: 0;
      border-bottom: 1px solid #2a4a4a;
      background: #0a1212;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #c8d8d8;
    }
    .hyper-panel.compact .hr-header { border-bottom: 0; }
    .hyper-panel.expanded {
      max-height: 180px;
      overflow: auto;
    }
    .hr-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 10px;
      border-bottom: 1px solid #1e3030;
    }
    .hr-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .hr-header-actions { flex-shrink: 0; }
    .hr-winner-chip {
      font-size: 10px;
      color: #7dff95;
      padding: 2px 7px;
      border: 1px solid #7dff9555;
      border-radius: 10px;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hr-saved-chip {
      font-size: 10px;
      color: ${CRT.textSoft};
      padding: 2px 7px;
      background: #1a3020;
      border-radius: 10px;
    }
    .hr-toggle {
      padding: 2px 8px;
      border: 1px solid #3a6868;
      border-radius: 3px;
      background: #142020;
      color: #9ab0b0;
      font: inherit;
      font-size: 10px;
      text-transform: uppercase;
      cursor: pointer;
    }
    .hr-toggle:hover { border-color: ${CRT.textDim}; color: ${CRT.text}; }
    .hr-title { font-size: 12px; font-weight: 700; color: #9cdcfe; letter-spacing: 0.03em; }
    .hr-phase {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: #1a2828;
      color: #8aa0a0;
    }
    .hr-phase.searching { color: #fff06a; background: #fff06a18; }
    .hr-phase.executing { color: #7dff95; background: #7dff9518; }
    .hr-ledger {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 11px;
    }
    .hr-ledger.pending { color: #8aa0a0; font-size: 11px; }
    .hr-ledger-stat { display: flex; flex-direction: column; gap: 1px; }
    .hr-ledger-stat strong { color: #e8f0f0; font-size: 12px; }
    .hr-ledger-stat.highlight strong { color: ${CRT.textSoft}; }
    .hr-ledger-label { color: #6a8080; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
    .hr-credit-bar { padding: 6px 10px 8px; border-bottom: 1px solid #1e3030; }
    .hr-credit-track {
      position: relative;
      height: 28px;
      border-radius: 3px;
      background: #141c1c;
      overflow: hidden;
    }
    .hr-credit-naive,
    .hr-credit-hyper {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 8px;
      font-size: 10px;
      white-space: nowrap;
    }
    .hr-credit-naive {
      width: 100%;
      background: #3a2020;
      color: #d0a0a0;
    }
    .hr-credit-hyper {
      background: linear-gradient(90deg, #1a4a3a, #2a6a4a);
      color: #b8f0c8;
      border-right: 2px solid ${CRT.textDim};
      min-width: 120px;
      z-index: 1;
    }
    .hr-credit-naive em,
    .hr-credit-hyper em { font-style: normal; font-weight: 700; }
    .hr-credit-caption {
      margin: 5px 0 0;
      font-size: 10px;
      line-height: 1.35;
      color: #7a9090;
    }
    .hr-branches {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      padding: 6px 8px;
    }
    .hr-branches.compact-row {
      display: flex;
      gap: 5px;
      padding: 4px 8px 6px;
    }
    .hr-branch-compact {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      border: 1px solid #2a4040;
      border-radius: 4px;
      background: #101818;
      font-size: 10px;
    }
    .hr-branch-compact.winner { border-color: #7dff9588; background: #102018; }
    .hr-branch-compact.pruned { opacity: 0.55; }
    .hr-branch-compact .hr-branch-title { flex: 1; min-width: 0; }
    .hr-branch {
      padding: 7px 8px;
      border: 1px solid #2a4040;
      border-radius: 4px;
      background: #101818;
      min-width: 0;
    }
    .hr-branch.winner {
      border-color: #7dff9588;
      background: #102018;
      box-shadow: 0 0 10px #7dff9522;
    }
    .hr-branch.pruned { opacity: 0.72; }
    .hr-branch-top {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .hr-rank { font-size: 10px; font-weight: 700; color: #9cdcfe; flex-shrink: 0; }
    .hr-branch-title {
      font-size: 11px;
      font-weight: 600;
      color: #eef4f4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .hr-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 2px;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .hr-badge.win { color: #7dff95; background: #7dff9518; }
    .hr-badge.prune { color: #ff9a9a; background: #ff9a9a18; }
    .hr-badge.idle { color: #dcdcaa; background: #dcdcaa18; }
    .hr-strategy {
      margin-top: 3px;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: ${CRT.textDim};
    }
    .hr-score-row { display: flex; align-items: center; gap: 5px; margin-top: 5px; }
    .hr-score-bar {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: #0a1010;
      overflow: hidden;
    }
    .hr-score-fill {
      height: 100%;
      background: linear-gradient(90deg, #3a7a7a, ${CRT.textDim});
    }
    .hr-score-val { font-size: 10px; font-weight: 700; color: ${CRT.textSoft}; min-width: 24px; text-align: right; }
    .hr-meta {
      display: flex;
      gap: 8px;
      margin-top: 4px;
      font-size: 10px;
      color: #7a9090;
    }
    .hr-rationale {
      margin: 5px 0 0;
      font-size: 10px;
      line-height: 1.35;
      color: #9ab0b0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .hr-prune-reason {
      margin: 4px 0 0;
      font-size: 9px;
      line-height: 1.3;
      color: #c09090;
    }
    .hr-factors {
      margin: 5px 0 0;
      padding: 0;
      list-style: none;
      font-size: 9px;
      color: #8aa0a0;
    }
    .hr-factors li { margin-bottom: 2px; }
    .hr-factors .pos { color: #7dff95; font-weight: 700; }
    .hr-factors .neg { color: #ff9a9a; font-weight: 700; }
    .hr-verdict {
      padding: 7px 10px 9px;
      border-top: 1px solid #1e3030;
      background: #0c1616;
    }
    .hr-verdict-head { font-size: 12px; font-weight: 700; color: #e8f4f4; }
    .hr-verdict-body { margin: 4px 0 0; font-size: 11px; line-height: 1.4; color: #a8c0c0; }
    .hr-verdict-quote {
      margin: 5px 0 0;
      padding-left: 8px;
      border-left: 2px solid ${CRT.textDim};
      font-size: 10px;
      line-height: 1.35;
      color: #8aa8a8;
      font-style: italic;
    }
    @media (max-width: 900px) {
      .hr-branches { grid-template-columns: 1fr; }
    }
    .chat {
      flex: 1.15;
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-bottom: 2px solid #3a787899;
      background: #00000012;
    }
    .chat-head {
      padding: 5px 8px;
      font-size: 15px;
      color: ${CRT.textDim};
      text-transform: uppercase;
      border-bottom: 1px solid #3a787866;
    }
    .chat-mode-row {
      display: flex;
      gap: 6px;
      padding: 5px 8px;
      border-bottom: 1px solid #3a787866;
      background: #00000018;
    }
    .chat-mode-btn {
      flex: 1;
      background: transparent;
      border: 1px solid #3a686866;
      color: ${CRT.textDim};
      padding: 4px 8px;
      font: inherit;
      font-size: 14px;
      text-transform: uppercase;
      cursor: pointer;
    }
    .chat-mode-btn.on {
      border-color: ${CRT.text};
      color: ${CRT.textSoft};
      box-shadow: 0 0 10px ${CRT.text}33;
    }
    .chat-tabs {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      padding: 5px 8px;
      border-bottom: 1px solid #3a787866;
    }
    .chat-tab {
      background: transparent;
      border: 1px solid #3a686866;
      border-bottom: 3px solid #3a686866;
      color: #9ab0b0;
      padding: 4px 10px 3px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      text-transform: uppercase;
      transition: color 0.12s, border-color 0.12s, box-shadow 0.12s;
    }
    .chat-tab.agent-altbot { border-bottom-color: #c7da2e55; }
    .chat-tab.agent-frontend { border-bottom-color: #569cd655; }
    .chat-tab.agent-backend { border-bottom-color: #ce917855; }
    .chat-tab.agent-database { border-bottom-color: #4ec9b055; }
    .chat-tab.agent-altbot.on {
      border-color: #c7da2e;
      border-bottom-color: #e7ff4a;
      color: #e7ff4a;
      box-shadow: 0 0 12px #e7ff4a33;
    }
    .chat-tab.agent-frontend.on {
      border-color: #569cd6;
      border-bottom-color: #9cdcfe;
      color: #9cdcfe;
      box-shadow: 0 0 12px #9cdcfe33;
    }
    .chat-tab.agent-backend.on {
      border-color: #ce9178;
      border-bottom-color: #e8b090;
      color: #e8b090;
      box-shadow: 0 0 12px #ce917833;
    }
    .chat-tab.agent-database.on {
      border-color: #4ec9b0;
      border-bottom-color: #7dffdf;
      color: #7dffdf;
      box-shadow: 0 0 12px #4ec9b033;
    }
    .chat-tab-sub {
      display: block;
      font-size: 10px;
      opacity: 0.75;
      line-height: 1;
    }
    .chat-log {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 8px;
      font-size: 15px;
      line-height: 1.35;
    }
    .chat-line {
      margin-bottom: 8px;
      padding: 7px 10px 7px 12px;
      border-left: 4px solid transparent;
      border-radius: 0 6px 6px 0;
      background: #00000022;
    }
    .chat-line strong {
      display: inline-block;
      min-width: 0;
      margin-right: 4px;
      letter-spacing: 0.5px;
    }
    .chat-speaker-altbot {
      border-left-color: #e7ff4a;
      color: #e8f0a8;
      background: #2a3810aa;
    }
    .chat-speaker-altbot strong { color: #e7ff4a; }
    .chat-speaker-frontend {
      border-left-color: #9cdcfe;
      color: #c8e8ff;
      background: #102838aa;
    }
    .chat-speaker-frontend strong { color: #9cdcfe; }
    .chat-speaker-backend {
      border-left-color: #e8b090;
      color: #f0d0b8;
      background: #2a1810aa;
    }
    .chat-speaker-backend strong { color: #ce9178; }
    .chat-speaker-database {
      border-left-color: #7dffdf;
      color: #c0fff0;
      background: #102820aa;
    }
    .chat-speaker-database strong { color: #4ec9b0; }
    .chat-speaker-user {
      border-left-color: #dcdcaa;
      color: #f2f2d0;
      background: #28281888;
    }
    .chat-speaker-user strong { color: #dcdcaa; }
    .chat-speaker-system {
      border-left-color: #6a8080;
      color: ${CRT.textDim};
      background: #0a181888;
      font-size: 14px;
    }
    .chat-speaker-system strong { color: #8aa0a0; }
    .chat-input-row {
      display: flex;
      gap: 6px;
      padding: 6px 8px;
      border-top: 2px solid #3a787866;
    }
    .chat-input-row.target-altbot { border-top-color: #c7da2e88; }
    .chat-input-row.target-frontend { border-top-color: #569cd688; }
    .chat-input-row.target-backend { border-top-color: #ce917888; }
    .chat-input-row.target-database { border-top-color: #4ec9b088; }
    .chat-input {
      flex: 1;
      min-width: 0;
      background: #133f3fcc;
      border: 1px solid ${CRT.textDim};
      color: ${CRT.text};
      padding: 4px 6px;
      font: inherit;
      font-size: 16px;
    }
    .chat-input-row.target-altbot .chat-input { border-color: #c7da2e99; }
    .chat-input-row.target-frontend .chat-input { border-color: #569cd699; }
    .chat-input-row.target-backend .chat-input { border-color: #ce917899; }
    .chat-input-row.target-database .chat-input { border-color: #4ec9b099; }
    .chat-send {
      background: transparent;
      border: 1px solid ${CRT.textDim};
      color: ${CRT.text};
      padding: 2px 8px;
      font: inherit;
      font-size: 15px;
      cursor: pointer;
      text-transform: uppercase;
    }
    .inspo-board {
      flex: 0.85;
      min-height: 200px;
      display: flex;
      flex-direction: column;
      padding: 6px 8px 8px;
      overflow: hidden;
    }
    .inspo-board.compact { padding: 4px 0 0; }
    .inspo-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      color: ${CRT.textDim};
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .inspo-head-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .inspo-add-btn {
      width: 28px;
      height: 28px;
      padding: 0;
      border: 2px solid ${CRT.textDim};
      background: #133f3fcc;
      color: ${CRT.textSoft};
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      text-shadow: 0 0 8px #dfff3f44;
    }
    .inspo-add-btn:hover {
      border-color: ${CRT.text};
      color: ${CRT.text};
    }
    .inspo-mood { color: ${CRT.text}; font-size: 13px; }
    .inspo-empty { font-size: 14px; color: ${CRT.textDim}; margin-bottom: 6px; }
    .inspo-grid {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      overflow: auto;
    }
    .inspo-tile {
      position: relative;
      padding: 0;
      border: 2px solid ${CRT.textDim};
      background: #00000025;
      cursor: pointer;
      min-height: 56px;
      overflow: hidden;
    }
    .inspo-tile img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      filter: saturate(0.75);
      opacity: 0.8;
    }
    .inspo-tile.on {
      border-color: ${CRT.text};
      box-shadow: 0 0 10px ${CRT.text}44;
    }
    .inspo-tile.on img { filter: saturate(1); opacity: 1; }
    .inspo-add-tile {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 56px;
      border-style: dashed;
    }
    .inspo-add-tile:hover {
      border-color: ${CRT.text};
      color: ${CRT.textSoft};
    }
    .inspo-add-mark {
      font-size: 34px;
      line-height: 1;
      color: ${CRT.text};
      text-shadow: 0 0 10px #dfff3f55;
    }
    .inspo-tile-label {
      position: absolute;
      left: 3px;
      bottom: 3px;
      padding: 1px 4px;
      background: #163f3fe6;
      color: ${CRT.text};
      font-size: 11px;
      text-transform: uppercase;
    }
    .cards-inspo {
      width: min(100%, 900px);
      margin-top: 0.15rem;
    }
    .prompt-inspo {
      width: min(100%, 640px);
      margin-top: 1rem;
    }
    .prompt-inspo .inspo-board.compact {
      min-height: 180px;
      max-height: 240px;
      overflow: hidden;
    }
    .prompt-inspo .inspo-grid {
      max-height: 160px;
      overflow-y: auto;
    }
    .cards-inspo .inspo-board.compact {
      overflow: visible;
      max-height: none;
      padding: 0;
    }
    .cards-inspo .inspo-grid {
      max-height: none;
      overflow: visible;
      width: 100%;
      grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
    }
    .react-flow__controls button {
      background: ${CRT.beige} !important;
      border-color: ${CRT.beigeLo} !important;
      color: #3a3020 !important;
    }
    @media (max-width: 760px) {
      .monitor { padding: 6px; }
      .monitor-bezel { padding-bottom: 6px; font-size: 15px; }
      .monitor-base { height: 8px; margin-top: 6px; }
      .screen-content { padding: 1.25rem; }
      .card-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        max-width: 460px;
      }
      .cards-inspo .inspo-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .ide-workspace { flex-direction: column; }
      .work-main { border-right: 0; }
      .right {
        width: 100% !important;
        max-width: none;
        min-height: 220px;
        border-top: 2px solid #3a787899;
      }
      .resize-handle-v { display: none; }
      .explorer { width: 100%; max-height: 160px; border-right: 0; border-bottom: 1px solid #2a5a5a; }
    }
  `;

  if (stage === "intro") {
    return (
      <>
        <style>{css}</style>
        <Monitor full>
          <IntroSite
            onLaunch={launchFromIntro}
            onResume={resumeFromIntro}
            savedSession={savedSession}
          />
        </Monitor>
      </>
    );
  }

  if (stage === "repo") {
    return (
      <>
        <style>{css}</style>
        <Monitor>
          <div className="screen-content">
            <div className="repo-panel">
              <div className="crt-title">CHOOSE YOUR REPO</div>

              {!githubConfigured ? (
                <>
                  <div className="repo-card">
                    <div className="repo-list-empty">
                      GitHub OAuth not configured
                      <br />
                      add keys to .env or skip for local-only
                    </div>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setLocalOnly(true);
                      openIdeDirectly();
                    }}
                  >
                    OPEN IDE · LOCAL
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setLocalOnly(true);
                      setStage("prompt");
                    }}
                  >
                    BUILD WITH PROMPT
                  </button>
                </>
              ) : !authUser?.authenticated ? (
                <>
                  <div className="repo-card">
                    <div className="repo-list-empty">
                      Sign in to open or create a repo on GitHub
                    </div>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => window.location.assign("/api/auth/github")}
                  >
                    SIGN IN WITH GITHUB
                  </button>
                </>
              ) : githubRepo ? (
                <>
                  <div className="repo-ready">
                    <span className="repo-ready-label">
                      <span className="led" style={{ marginRight: 6 }} />
                      connected
                    </span>
                    <a href={githubRepo.url} target="_blank" rel="noreferrer">
                      {githubRepo.fullName}
                    </a>
                    <span className="repo-ready-meta">
                      {githubRepo.source === "created" ? "new repo" : "existing repo"} · ready for push
                    </span>
                  </div>
                  <div className="repo-cta-row">
                    <button className="repo-action ghost" type="button" onClick={() => setGithubRepo(null)}>
                      change repo
                    </button>
                    <button className="repo-action ghost" type="button" onClick={openIdeDirectly}>
                      open IDE
                    </button>
                    <button className="repo-action" type="button" onClick={() => setStage("prompt")}>
                      continue →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="repo-toolbar">
                    <div className="auth-chip">
                      {authUser.avatar ? <img src={authUser.avatar} alt="" /> : null}
                      <span>@{authUser.login}</span>
                      <button type="button" className="auth-link" onClick={signOut}>
                        sign out
                      </button>
                    </div>
                    {repoMode === "open" ? (
                      <button
                        type="button"
                        className="repo-refresh"
                        disabled={reposLoading}
                        onClick={loadExistingRepos}
                      >
                        {reposLoading ? "loading…" : "refresh"}
                      </button>
                    ) : null}
                  </div>

                  <div className="repo-segments">
                    <button
                      type="button"
                      className={`repo-segment ${repoMode === "open" ? "on" : ""}`}
                      onClick={() => setRepoMode("open")}
                    >
                      open existing
                    </button>
                    <button
                      type="button"
                      className={`repo-segment ${repoMode === "create" ? "on" : ""}`}
                      onClick={() => setRepoMode("create")}
                    >
                      create new
                    </button>
                  </div>

                  {repoMode === "open" ? (
                    <div className="repo-card">
                      <div className="repo-search-row">
                        <span className="repo-search-mark" aria-hidden>
                          ⌕
                        </span>
                        <input
                          className="repo-input"
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          onKeyDown={handleRepoSearchKey}
                          placeholder="search repos or type owner/repo"
                          aria-label="Search repositories"
                          autoFocus
                        />
                      </div>

                      <div className="repo-list crt-scroll">
                        {reposLoading ? (
                          <div className="repo-list-empty">scanning github…</div>
                        ) : reposError ? (
                          <div className="repo-list-empty err">
                            {reposError}
                            <br />
                            <button
                              type="button"
                              className="repo-refresh"
                              style={{ marginTop: 10 }}
                              onClick={loadExistingRepos}
                            >
                              retry
                            </button>
                          </div>
                        ) : filteredRepos.length > 0 ? (
                          filteredRepos.map((repo) => (
                            <button
                              key={repo.fullName}
                              type="button"
                              className="repo-list-item"
                              disabled={repoBusy}
                              onClick={() => openExistingRepo(repo.fullName)}
                            >
                              <span className="repo-list-name">{repo.name}</span>
                              <span className="repo-list-sub">
                                {repo.owner} · {formatRepoAge(repo.updatedAt)}
                              </span>
                              <span className="repo-list-badge">{repo.private ? "private" : "public"}</span>
                            </button>
                          ))
                        ) : existingRepos.length === 0 ? (
                          <div className="repo-list-empty">
                            no repos on your account
                            <br />
                            type owner/repo above or create a new one
                          </div>
                        ) : (
                          <div className="repo-list-empty">no matches for “{repoSearch.trim()}”</div>
                        )}
                      </div>

                      <div className="repo-footer">
                        <span className="repo-footer-meta">
                          {reposLoading
                            ? "fetching…"
                            : `${filteredRepos.length} repo${filteredRepos.length === 1 ? "" : "s"} shown`}
                        </span>
                        {manualRepoRef ? (
                          <button
                            type="button"
                            className="repo-action"
                            disabled={repoBusy}
                            onClick={() => openExistingRepo(manualRepoRef)}
                          >
                            {repoBusy ? "opening…" : `open “${manualRepoRef}”`}
                          </button>
                        ) : (
                          <span className="repo-footer-meta">click a repo or press enter</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="repo-card" style={{ padding: "16px 14px 14px" }}>
                      <input
                        className="repo-input-boxed"
                        value={newRepoName}
                        onChange={(e) => setNewRepoName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && createRepo()}
                        placeholder="my-open-ide-app"
                        aria-label="New repository name"
                        autoFocus
                      />
                      <div className="repo-hint">letters, numbers, and hyphens only</div>
                      <div className="repo-footer" style={{ marginTop: 14, borderTop: 0, padding: 0, background: "transparent" }}>
                        <span className="repo-footer-meta">creates under @{authUser.login}</span>
                        <button
                          type="button"
                          className="repo-action"
                          disabled={!newRepoName.trim() || repoBusy}
                          onClick={createRepo}
                        >
                          {repoBusy ? "creating…" : "create repo"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Monitor>
      </>
    );
  }

  if (stage === "prompt") {
    return (
      <>
        <style>{css}</style>
        <Monitor>
          <div className="screen-content">
            <div className="screen-prompt" onClick={() => promptInputRef.current?.focus()}>
              <div className="typewriter">{typedPrompt}</div>
              <div className="terminal-line">
                <span>&gt;</span>
                <span>{prompt || " "}</span>
                <span className="prompt-cursor" />
              </div>
              <input
                ref={promptInputRef}
                className="prompt-hidden-input"
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && prompt.trim() && continueToCards()}
                aria-label="What do you want to build today?"
              />
              <div className="attachment-row">
                <button className="attach-btn" type="button" onClick={() => fileInputRef.current?.click()}>
                  +
                </button>
                <input
                  ref={fileInputRef}
                  className="file-hidden-input"
                  type="file"
                  multiple
                  accept="image/*,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.html,.css,.sql,.xml,.yaml,.yml"
                  onChange={(event) => addAttachments(event.target.files)}
                />
              </div>
              {attachments.length > 0 && (
                <div className="attachment-list">
                  {attachments.map((attachment) => (
                    <span className="attachment-chip" key={attachment.id}>
                      {attachment.kind.toUpperCase()} · {attachment.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {githubRepo ? (
              <div className="repo-ready" style={{ marginTop: "0.5rem", fontSize: 17 }}>
                repo · <a href={githubRepo.url} target="_blank" rel="noreferrer">{githubRepo.fullName}</a>
              </div>
            ) : null}
            <div className="prompt-inspo">{renderInspoBoard(true)}</div>
            <button className="btn" disabled={!prompt.trim()} onClick={continueToCards}>
              CONTINUE
            </button>
          </div>
        </Monitor>
      </>
    );
  }

  if (stage === "cards") {
    return (
      <>
        <style>{css}</style>
        <Monitor>
          <div className="screen-content stage-cards">
            <div className="stage-cards-scroll crt-scroll">
              <div className="crt-title">SELECT YOUR SWARM</div>
              <div className="crt-sub">pick agents to deploy</div>
              <div className="card-grid">
                {AGENT_CARDS.map((card) => {
                  const active = card.locked || selected.includes(card.agent);
                  return (
                    <button
                      key={card.name}
                      type="button"
                      className={`card ${active ? "on" : ""} ${card.locked ? "locked" : ""}`}
                      aria-pressed={card.locked ? undefined : active}
                      onClick={() => card.agent && toggleCard(card.agent)}
                    >
                      <span className="card-frame">
                        <img className="card-image" src={card.image} alt="" />
                        <span className="card-state">
                          {card.locked ? "Always on" : active ? "Selected" : "Standby"}
                        </span>
                      </span>
                      <span className="card-copy">
                        <span className="card-name">{card.name}</span>
                        <span className="card-role">{card.role}</span>
                        {card.model ? (
                          <span className="card-model">Groq · {formatGroqModel(card.model)}</span>
                        ) : null}
                        <span className="card-description">{card.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="cards-inspo">{renderInspoBoard(true)}</div>
            </div>
            <div className="stage-cards-footer">
              <button className="btn" disabled={!selected.length} onClick={init}>
                INITIALIZE
              </button>
            </div>
          </div>
        </Monitor>
      </>
    );
  }

  const files = Object.keys(fileSystem);
  const activeFileEntry = activeFile ? fileSystem[activeFile] : null;
  const hasOutput = Boolean(status.runId && files.length > 0 && !runningAgents.length);

  return (
    <>
      <style>{css}</style>
      <Monitor full>
        <div className="ide ide-crt">
          <header className="header ide-header">
            <button type="button" className="header-home" onClick={goHome} title="Back to intro">
              ⌂ Home
            </button>
            <span className="ide-header-title">
              SWARM · GROQ · {status.workerModel || "CONNECTING"}
              {status.runId ? ` · RUN ${status.runId.slice(0, 8)}` : ""}
            </span>
            {githubRepo ? (
              <span className="ide-header-repo" title={githubRepo.url}>
                {githubRepo.fullName}
              </span>
            ) : null}
            <div className="ide-header-actions">
              {hasOutput ? (
                <>
                  <button type="button" className="output-btn" disabled={!!outputBusy} onClick={downloadZip}>
                    Export
                  </button>
                  <button
                    type="button"
                    className="output-btn"
                    disabled={!!outputBusy || !githubRepo}
                    onClick={pushToGitHub}
                  >
                    {outputBusy === "push" ? "Pushing…" : "Push"}
                  </button>
                </>
              ) : null}
              {authUser?.authenticated ? (
                <span className="auth-chip">
                  {authUser.avatar ? <img src={authUser.avatar} alt="" /> : null}@{authUser.login}
                </span>
              ) : null}
            </div>
          </header>
          <div className="ide-workspace">
            <FileExplorer
              fileSystem={fileSystem}
              activeFile={activeFile}
              onSelectFile={setActiveFile}
              onDeleteFile={deleteWorkspaceFile}
            />
            <div className="work-main">
              <section className="center">
                <div className="tabs">
                  {files.length === 0 ? (
                    <span className="tab on">Welcome</span>
                  ) : (
                    files.map((filename) => (
                      <span
                        key={filename}
                        className={`tab ${activeFile === filename ? "on" : ""}`}
                        onClick={() => setActiveFile(filename)}
                        title={filename}
                      >
                        {basename(filename)}
                      </span>
                    ))
                  )}
                </div>
                <div className="editor">
                  <Editor
                    theme="vs-dark"
                    language={languageForFile(activeFile)}
                    value={activeFileEntry?.code || "// Open a repo or run a swarm to load files"}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      fontFamily: "VT323, monospace",
                      lineNumbers: "on",
                      readOnly: true,
                      scrollBeyondLastLine: false,
                      padding: { top: 8 },
                    }}
                  />
                </div>
              </section>
              <div
                className="resize-handle-h"
                role="separator"
                aria-label="Resize bottom panel"
                onMouseDown={startResizeGraph}
              />
              <section className="ide-bottom-panel" style={{ height: graphHeight }}>
                <div className="panel-tabs">
                  <button
                    type="button"
                    className={`panel-tab ${bottomPanelTab === "terminal" ? "on" : ""}`}
                    onClick={() => setBottomPanelTab("terminal")}
                  >
                    Terminal
                  </button>
                  <button
                    type="button"
                    className={`panel-tab ${bottomPanelTab === "graph" ? "on" : ""}`}
                    onClick={() => {
                      setBottomPanelTab("graph");
                      showSearchGraph();
                    }}
                  >
                    Plan graph
                    {searchPhase === "searching" ? <span className="panel-tab-dot" /> : null}
                  </button>
                </div>
                <div className="panel-body">
                  {bottomPanelTab === "terminal" ? (
                    <TerminalPanel
                      fileSystem={fileSystem}
                      githubRepo={githubRepo}
                      runId={status.runId}
                      cloudMode={cloudMode}
                      onOpenFile={setActiveFile}
                    />
                  ) : (
                    <div className="graph-panel-stack">
                      <HyperreasoningPanel
                        phase={searchPhase}
                        branches={searchGraphData.branches}
                        comparisons={searchComparisons}
                        verdict={searchVerdict}
                        savings={searchSavings}
                        winnerId={searchWinner}
                        agentCount={selected.length}
                      />
                      <div className="graph-canvas">
                        {nodes.length === 0 ? (
                          <div className="graph-empty">Run a swarm to see Altbot&apos;s hyperreasoning graph</div>
                        ) : (
                          <ReactFlow
                            key={`flow-${nodes.length}`}
                            nodes={nodes}
                            edges={edges}
                            nodeTypes={flowNodeTypes}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            fitView
                            fitViewOptions={{ padding: 0.2 }}
                            proOptions={{ hideAttribution: true }}
                          >
                            <Background color="#2a4a4a" gap={18} />
                            <Controls showInteractive={false} />
                          </ReactFlow>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
            <div
              className="resize-handle-v"
              role="separator"
              aria-label="Resize sidebar"
              onMouseDown={startResizeRight}
            />
            <aside
              className={`right crt-scroll ${chatTarget === "Frontend" ? "ui-bot-active" : ""}`}
              style={{ width: rightWidth }}
            >
              {renderInspoBoard()}
              <div className="chat">
                <div className="chat-head">CHAT · ROUTING</div>
                <div className="chat-mode-row">
                  <button
                    type="button"
                    className={`chat-mode-btn ${chatMode === "chat" ? "on" : ""}`}
                    onClick={() => setChatMode("chat")}
                  >
                    Chat
                  </button>
                  <button
                    type="button"
                    className={`chat-mode-btn ${chatMode === "code" ? "on" : ""}`}
                    onClick={() => setChatMode("code")}
                    title="Run hyperreasoning + swarm to build or change code"
                  >
                    Code
                  </button>
                </div>
                <div className="chat-tabs">
                  {chatTargets.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      className={`chat-tab agent-${chatTargetKey(target.id)} ${chatTarget === target.id ? "on" : ""}`}
                      onClick={() => setChatTarget(target.id)}
                    >
                      {target.label}
                      <span className="chat-tab-sub">{target.subtitle}</span>
                    </button>
                  ))}
                </div>
                <div className="chat-log crt-scroll">
                  {chatMessages.length === 0 && (
                    <div className="chat-line chat-speaker-system">
                      Ask Altbot to orchestrate, or switch tabs for lane-specific help.
                    </div>
                  )}
                  {chatMessages.map((msg) => {
                    const speakerKey = chatAgentKey(msg);
                    const speaker = chatSpeakerLabel(msg);
                    return (
                      <div key={msg.id} className={`chat-line chat-speaker-${speakerKey}`}>
                        <strong>{speaker}:</strong> {msg.text}
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
                <div className={`chat-input-row target-${chatTargetKey(chatTarget)}`}>
                  <input
                    className="chat-input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendChat()}
                    placeholder={
                      chatMode === "code"
                        ? "Describe what to build or change… (hyperreasoning swarm)"
                        : chatTarget === "altbot"
                          ? "Message Altbot…"
                          : `Message ${chatTargets.find((t) => t.id === chatTarget)?.label || chatTarget}…`
                    }
                    aria-label="Chat message"
                  />
                  <button type="button" className="chat-send" onClick={sendChat}>
                    {chatMode === "code" ? "RUN" : "SEND"}
                  </button>
                </div>
              </div>
            </aside>
          </div>
          <footer className="ide-statusbar crt-statusbar">
            <span className="led" />
            <span className="ide-status-item">
              {status.error
                ? status.error
                : searchPhase === "searching"
                  ? "Hyperreasoning…"
                  : runningAgents.length
                    ? `Deploying: ${runningAgents.join(", ")}`
                    : "Ready"}
            </span>
            <span className="ide-status-item">{status.workerModel || "Groq"}</span>
            {status.runId ? <span className="ide-status-item">Run {status.runId.slice(0, 8)}</span> : null}
            {files.length ? <span className="ide-status-item">{files.length} files</span> : null}
          </footer>
        </div>
      </Monitor>
    </>
  );
}

function AppRoot() {
  return (
    <ReactFlowProvider>
      <App />
      <Analytics />
    </ReactFlowProvider>
  );
}

createRoot(document.getElementById("root")).render(<AppRoot />);
