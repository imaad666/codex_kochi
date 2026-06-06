import { useEffect, useMemo, useState } from "react";

function formatK(tokens) {
  if (!tokens) return "0";
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

function phaseLabel(phase, hasResults) {
  if (phase === "searching") return "Evaluating branches";
  if (phase === "executing") return "Winner locked";
  if (hasResults) return "Decision complete";
  return "Standby";
}

function BranchCard({ branch, winnerId, maxScore, compact = false }) {
  const isWinner = branch.id === winnerId || branch.status === "SUCCESS" || branch.selected;
  const isPruned = branch.status === "PRUNED";
  const scorePct = maxScore > 0 ? Math.min(100, Math.round((branch.score / maxScore) * 100)) : 0;

  if (compact) {
    return (
      <div className={`hr-branch-compact ${isWinner ? "winner" : ""} ${isPruned ? "pruned" : ""}`}>
        <span className="hr-rank">#{branch.rank || "—"}</span>
        <span className="hr-branch-title">{branch.title}</span>
        <span className="hr-score-val">{branch.score ?? "…"}</span>
        {isWinner ? <span className="hr-badge win">✓</span> : isPruned ? <span className="hr-badge prune">✕</span> : null}
      </div>
    );
  }

  return (
    <div className={`hr-branch ${isWinner ? "winner" : ""} ${isPruned ? "pruned" : ""}`}>
      <div className="hr-branch-top">
        <span className="hr-rank">#{branch.rank || "—"}</span>
        <span className="hr-branch-title">{branch.title}</span>
        {isWinner ? <span className="hr-badge win">Selected</span> : null}
        {isPruned ? <span className="hr-badge prune">Pruned</span> : null}
        {!isWinner && !isPruned && branch.status === "IDLE" ? (
          <span className="hr-badge idle">Scoring</span>
        ) : null}
      </div>
      <div className="hr-strategy">{branch.strategyLabel || branch.shortSummary || branch.strategy}</div>
      <div className="hr-score-row">
        <div className="hr-score-bar">
          <div className="hr-score-fill" style={{ width: `${scorePct}%` }} />
        </div>
        <span className="hr-score-val">{branch.score != null ? branch.score : "…"}</span>
      </div>
      <div className="hr-meta">
        <span>{branch.stepCount ?? "?"} steps</span>
        <span>{branch.agentsUsed ?? "?"} agents</span>
      </div>
      {branch.pruneReason ? <p className="hr-prune-reason">{branch.pruneReason}</p> : null}
    </div>
  );
}

export default function HyperreasoningPanel({
  phase,
  branches = [],
  comparisons = [],
  verdict,
  savings,
  winnerId,
  agentCount = 0,
}) {
  const isSearching = phase === "searching";
  const [expanded, setExpanded] = useState(isSearching);

  useEffect(() => {
    if (isSearching) setExpanded(true);
    else if (phase === "executing") setExpanded(false);
  }, [isSearching, phase]);

  const branchRows = useMemo(() => {
    const byId = new Map(comparisons.map((row) => [row.id, row]));
    return branches
      .filter((branch) => branch.depth > 0)
      .map((branch) => ({
        ...byId.get(branch.id),
        ...branch,
        score: branch.score ?? byId.get(branch.id)?.score,
        rank: branch.rank ?? byId.get(branch.id)?.rank,
        factors: byId.get(branch.id)?.factors || branch.factors,
        pruneReason: branch.pruneReason || byId.get(branch.id)?.pruneReason,
        strategyLabel: byId.get(branch.id)?.strategyLabel || branch.shortSummary,
        rationale: byId.get(branch.id)?.rationale || branch.rationaleSummary,
      }))
      .sort((a, b) => (a.rank || 99) - (b.rank || 99));
  }, [branches, comparisons]);

  const maxScore = useMemo(
    () => Math.max(1, ...branchRows.map((branch) => branch.score || 0)),
    [branchRows]
  );

  const winner = branchRows.find(
    (branch) => branch.id === winnerId || branch.status === "SUCCESS" || branch.selected
  );

  const showPanel = isSearching || branchRows.length > 0 || verdict;
  if (!showPanel) return null;

  const saved = savings?.tokensSaved || 0;
  const naive = savings?.naiveTokens || 0;
  const hyper = savings?.hyperTokens || 0;
  const savedPct = naive > 0 ? Math.round((saved / naive) * 100) : 0;
  const showDetails = isSearching || expanded;

  return (
    <div className={`hyper-panel ${showDetails ? "expanded" : "compact"}`}>
      <div className="hr-header">
        <div className="hr-header-left">
          <span className="hr-title">Hyperreasoning</span>
          <span className={`hr-phase ${phase}`}>{phaseLabel(phase, branchRows.length > 0)}</span>
          {!isSearching && winner ? (
            <span className="hr-winner-chip">{winner.title}</span>
          ) : null}
          {savings && !showDetails ? (
            <span className="hr-saved-chip">~{formatK(saved)} saved ({savedPct}%)</span>
          ) : null}
        </div>
        <div className="hr-header-actions">
          {!isSearching && branchRows.length > 0 ? (
            <button type="button" className="hr-toggle" onClick={() => setExpanded((open) => !open)}>
              {expanded ? "Hide" : "Details"}
            </button>
          ) : null}
        </div>
      </div>

      {showDetails && savings ? (
        <div className="hr-credit-bar" aria-label="Token budget comparison">
          <div className="hr-credit-track">
            <div className="hr-credit-naive" style={{ width: "100%" }}>
              <span>Naive: {savings.branchesExplored} branches</span>
              <em>~{formatK(naive)}</em>
            </div>
            <div
              className="hr-credit-hyper"
              style={{ width: `${Math.max(12, Math.round((hyper / naive) * 100))}%` }}
            >
              <span>Hyper: 1 winner</span>
              <em>~{formatK(hyper)}</em>
            </div>
          </div>
        </div>
      ) : null}

      {showDetails && branchRows.length > 0 ? (
        <div className={`hr-branches ${isSearching ? "" : "compact-row"}`}>
          {branchRows.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              winnerId={winnerId}
              maxScore={maxScore}
              compact={!isSearching}
            />
          ))}
        </div>
      ) : null}

      {showDetails && verdict && expanded ? (
        <div className="hr-verdict">
          <p className="hr-verdict-body">{verdict.body}</p>
        </div>
      ) : null}
    </div>
  );
}
