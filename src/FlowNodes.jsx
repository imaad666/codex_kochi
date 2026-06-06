import { Handle, Position } from "@xyflow/react";

const CRT = {
  text: "#e7ff4a",
  textDim: "#c7da2e",
  textSoft: "#f2ff8a",
  led: "#e7ff4a",
};

const STATUS_LABEL = {
  planned: "INTENT",
  ready: "CANDIDATE",
  running: "EVALUATING",
  complete: "WINNER",
  error: "PRUNED",
};

const AGENT_COLORS = {
  Frontend: { border: "#569cd6", glow: "#569cd644", label: "#9cdcfe" },
  Backend: { border: "#ce9178", glow: "#ce917844", label: "#ce9178" },
  Database: { border: "#4ec9b0", glow: "#4ec9b044", label: "#4ec9b0" },
  GitHub: { border: "#8b949e", glow: "#8b949e44", label: "#c9d1d9" },
  default: { border: "#6a9898", glow: "#6a989844", label: "#a8c8c8" },
};

function agentTheme(agent) {
  return AGENT_COLORS[agent] || AGENT_COLORS.default;
}

export function PlanBranchNode({ data }) {
  const status = data.status || "planned";
  const label = STATUS_LABEL[status] || status.toUpperCase();
  const maxScore = data.maxScore || data.score || 1;
  const scorePct = data.score != null ? Math.min(100, Math.round((data.score / maxScore) * 100)) : 0;
  const isRoot = data.isRoot;
  const isWinner = status === "complete";
  const isPruned = status === "error";

  if (isRoot) {
    return (
      <div className={`flow-node plan-node root-node ${data.onPath ? "on-path" : ""}`}>
        <Handle type="source" position={Position.Right} className="flow-handle" />
        <div className="flow-node-eyebrow">Build intent</div>
        <div className="flow-node-title">{data.label}</div>
        {data.prompt ? <div className="flow-node-snippet">{data.prompt}</div> : null}
        <div className="flow-node-foot">
          <span className={`flow-node-badge status-${status}`}>{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flow-node plan-node branch-node status-${status} ${isWinner ? "winner" : ""} ${isPruned ? "pruned" : ""} ${data.onPath ? "on-path" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="flow-node-head">
        <span className="flow-node-rank">#{data.rank || "?"}</span>
        <span className={`flow-node-badge status-${status}`}>{label}</span>
      </div>
      <div className="flow-node-title">{data.label}</div>
      {data.shortSummary ? <div className="flow-node-strategy">{data.shortSummary}</div> : null}
      {data.branchPrompt ? <div className="flow-node-snippet">{data.branchPrompt}</div> : null}
      {data.score != null ? (
        <div className="flow-node-score-wrap">
          <div className="flow-node-score-bar">
            <div className="flow-node-score-fill" style={{ width: `${scorePct}%` }} />
          </div>
          <span className="flow-node-score-val">{data.score}</span>
        </div>
      ) : null}
      {data.stepCount != null ? (
        <div className="flow-node-meta">
          {data.stepCount} steps · {data.agentsUsed ?? "?"} agents
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}

export function ExecStepNode({ data }) {
  const status = data.status || "planned";
  const promptText = String(data.branchPrompt || data.description || "").trim();
  const theme = agentTheme(data.agent);
  const lane = data.isSubagent ? "subagent" : "exec";

  return (
    <div
      className={`flow-node exec-node ${lane} status-${status}`}
      style={{ "--lane-color": theme.border, "--lane-glow": theme.glow }}
    >
      <Handle type="target" position={Position.Top} className="flow-handle" />
      <div className="flow-node-eyebrow" style={{ color: theme.label }}>
        {data.agent || "Step"}
        {data.isSubagent ? " · subagent" : ""}
      </div>
      <div className="flow-node-title">{data.label}</div>
      {promptText ? <div className="flow-node-snippet">{promptText}</div> : null}
      <div className="flow-node-foot">
        <span className={`flow-node-badge status-${status}`}>{status.toUpperCase()}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="flow-handle" />
    </div>
  );
}

export const flowNodeTypes = {
  planBranch: PlanBranchNode,
  execStep: ExecStepNode,
};

export const flowNodeCss = `
  .flow-handle {
    width: 7px !important;
    height: 7px !important;
    background: ${CRT.textDim} !important;
    border: 1px solid #0a1010 !important;
    opacity: 0.85;
  }
  .flow-node {
    width: 196px;
    box-sizing: border-box;
    padding: 11px 13px 10px;
    border-radius: 10px;
    font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #dce8e8;
    background: linear-gradient(165deg, #162626 0%, #101818 100%);
    border: 1px solid #3d6666;
    box-shadow: 0 8px 24px #00000055, inset 0 1px 0 #ffffff0a;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .flow-node.on-path {
    border-color: ${CRT.textDim};
    box-shadow: 0 0 0 1px ${CRT.text}33, 0 10px 28px #00000066;
  }
  .flow-node.root-node {
    width: 212px;
    background: linear-gradient(165deg, #1c3232 0%, #142020 100%);
    border-color: ${CRT.textDim};
  }
  .flow-node.branch-node.winner {
    border-color: #7dff95;
    box-shadow: 0 0 0 1px #7dff9544, 0 0 22px #7dff9522, 0 10px 28px #00000066;
  }
  .flow-node.branch-node.pruned {
    opacity: 0.48;
    filter: saturate(0.45);
    border-color: #4a5555;
  }
  .flow-node.exec-node {
    width: 184px;
    border-left: 3px solid var(--lane-color, #6a9898);
    background: linear-gradient(165deg, #152222 0%, #0e1616 100%);
  }
  .flow-node.exec-node.subagent {
    width: 168px;
    padding: 9px 11px 8px;
    border-left-width: 2px;
    opacity: 0.92;
  }
  .flow-node-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .flow-node-eyebrow {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #7a9494;
    margin-bottom: 4px;
  }
  .flow-node-rank {
    font-size: 11px;
    font-weight: 800;
    color: #9cdcfe;
  }
  .flow-node-title {
    font-size: 13px;
    font-weight: 650;
    line-height: 1.3;
    color: #f4fafa;
    letter-spacing: -0.01em;
  }
  .flow-node-strategy {
    margin-top: 5px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: ${CRT.textDim};
  }
  .flow-node-snippet {
    margin-top: 7px;
    padding: 6px 8px;
    border-radius: 6px;
    background: #080e0ecc;
    border: 1px solid #2a444466;
    font-size: 10px;
    line-height: 1.45;
    color: ${CRT.textSoft};
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
  .flow-node-meta {
    margin-top: 6px;
    font-size: 10px;
    color: #7a9494;
  }
  .flow-node-foot {
    margin-top: 8px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
  }
  .flow-node-score-wrap {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 8px;
  }
  .flow-node-score-bar {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: #0a1010;
    overflow: hidden;
  }
  .flow-node-score-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #4a8a8a, ${CRT.textSoft});
  }
  .flow-node-score-val {
    font-size: 11px;
    font-weight: 800;
    color: ${CRT.textSoft};
    min-width: 26px;
    text-align: right;
  }
  .flow-node-badge {
    display: inline-block;
    padding: 2px 7px;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.07em;
    border-radius: 999px;
    border: 1px solid currentColor;
    text-transform: uppercase;
  }
  .flow-node-badge.status-planned { color: #9cdcfe; border-color: #9cdcfe55; background: #9cdcfe14; }
  .flow-node-badge.status-ready { color: #dcdcaa; border-color: #dcdcaa55; background: #dcdcaa14; }
  .flow-node-badge.status-complete { color: #7dff95; border-color: #7dff9566; background: #7dff9518; }
  .flow-node-badge.status-error { color: #ff9a9a; border-color: #ff9a9a55; background: #ff9a9a12; }
  .flow-node-badge.status-running { color: #fff06a; border-color: #fff06a66; background: #fff06a18; }
`;
