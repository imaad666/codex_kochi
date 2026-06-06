import { Handle, Position } from "@xyflow/react";

const CRT = {
  text: "#e7ff4a",
  textDim: "#c7da2e",
  textSoft: "#f2ff8a",
};

const STATUS_LABEL = {
  planned: "INTENT",
  ready: "CANDIDATE",
  running: "EVALUATING",
  complete: "WINNER",
  error: "PRUNED",
};

export function PlanBranchNode({ data }) {
  const status = data.status || "planned";
  const label = STATUS_LABEL[status] || status.toUpperCase();
  const maxScore = data.maxScore || data.score || 1;
  const scorePct = data.score != null ? Math.min(100, Math.round((data.score / maxScore) * 100)) : 0;
  const isRoot = data.isRoot;

  if (isRoot) {
    return (
      <div className="flow-node plan-node root-node">
        <Handle type="source" position={Position.Right} style={{ opacity: 0.35 }} />
        <div className="flow-node-title">{data.label}</div>
        <div className="flow-node-meta">Your build intent</div>
        <div className="flow-node-badge status-planned">{label}</div>
      </div>
    );
  }

  return (
    <div className={`flow-node plan-node status-${status}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0.35 }} />
      <div className="flow-node-head">
        <span className="flow-node-rank">#{data.rank || "?"}</span>
        <div className={`flow-node-badge status-${status}`}>{label}</div>
      </div>
      <div className="flow-node-title">{data.label}</div>
      {data.shortSummary ? <div className="flow-node-strategy">{data.shortSummary}</div> : null}
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
      {data.rationale ? <div className="flow-node-rationale">{data.rationale}</div> : null}
      <Handle type="source" position={Position.Right} style={{ opacity: 0.35 }} />
    </div>
  );
}

export function ExecStepNode({ data }) {
  const status = data.status || "planned";
  return (
    <div className="flow-node exec-node">
      <Handle type="target" position={Position.Top} style={{ opacity: 0.35 }} />
      <div className="flow-node-title">{data.label}</div>
      {data.agent ? <div className="flow-node-meta">{data.agent}</div> : null}
      <div className={`flow-node-badge status-${status}`}>{status.toUpperCase()}</div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0.35 }} />
    </div>
  );
}

export const flowNodeTypes = {
  planBranch: PlanBranchNode,
  execStep: ExecStepNode,
};

export const flowNodeCss = `
  .flow-node {
    min-width: 168px;
    max-width: 240px;
    padding: 10px 12px;
    border-radius: 4px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #d8e8e8;
    background: #142020;
    border: 1px solid #3a6868;
    box-shadow: 0 4px 14px #00000044;
  }
  .flow-node.root-node {
    background: #1a2c2c;
    border-color: ${CRT.textDim};
    box-shadow: 0 0 12px ${CRT.text}33;
  }
  .plan-node.status-complete {
    border-color: #7dff95;
    box-shadow: 0 0 16px #7dff9544;
  }
  .plan-node.status-error {
    opacity: 0.62;
    border-color: #6a4a4a;
    filter: grayscale(0.35);
  }
  .flow-node-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 4px;
  }
  .flow-node-rank {
    font-size: 11px;
    font-weight: 700;
    color: #9cdcfe;
  }
  .flow-node-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    color: #f0f8f8;
  }
  .flow-node-strategy {
    margin-top: 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #c7da2e;
  }
  .flow-node-meta {
    margin-top: 5px;
    font-size: 11px;
    color: #8aa0a0;
  }
  .flow-node-score-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .flow-node-score-bar {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: #0a1010;
    overflow: hidden;
  }
  .flow-node-score-fill {
    height: 100%;
    background: linear-gradient(90deg, #4a8a8a, ${CRT.textDim});
  }
  .flow-node-score-val {
    font-size: 11px;
    font-weight: 700;
    color: ${CRT.textSoft};
    min-width: 28px;
    text-align: right;
  }
  .flow-node-rationale {
    margin-top: 6px;
    font-size: 10px;
    line-height: 1.35;
    color: #9ab0b0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .flow-node-badge {
    display: inline-block;
    padding: 1px 6px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    border-radius: 2px;
    border: 1px solid currentColor;
    text-transform: uppercase;
  }
  .flow-node-badge.status-planned { color: #9cdcfe; border-color: #9cdcfe55; background: #9cdcfe12; }
  .flow-node-badge.status-ready { color: #dcdcaa; border-color: #dcdcaa55; background: #dcdcaa12; }
  .flow-node-badge.status-complete { color: #7dff95; border-color: #7dff9555; background: #7dff9518; }
  .flow-node-badge.status-error { color: #ff8a8a; border-color: #ff8a8a55; background: #ff8a8a12; }
  .flow-node-badge.status-running { color: #fff06a; border-color: #fff06a55; background: #fff06a12; }
  .exec-node { background: #182424; }
`;
