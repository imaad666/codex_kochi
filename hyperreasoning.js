import { GroqError, agentGroqConfig, estimateTokens, groqJson } from "./groq.js";
import { attachmentContent, controllerPrompt } from "./agents.js";

export const CANDIDATES_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          strategy: { type: "string" },
          rationale: { type: "string" },
          summary: { type: "string" },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                agent: { type: "string" },
                dependsOn: { type: "array", items: { type: "string" } },
              },
              required: ["id", "title", "description", "agent", "dependsOn"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "title", "strategy", "rationale", "summary", "steps"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

const EST_TOKENS_PER_AGENT_RUN = 4200;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function candidateSteps(candidate) {
  return candidate.plan?.steps || candidate.steps || [];
}

/** Heuristic scorer — inspired by hyperreasoning's branch ranking (no RL for MVP). */
export function scoreCandidate(candidate, agents) {
  const agentSet = new Set(agents.map((a) => a.title));
  const steps = candidateSteps(candidate);
  let score = 0;

  const covered = new Set(steps.map((s) => s.agent).filter((a) => agentSet.has(a)));
  score += covered.size * 12;

  const depCount = steps.reduce((n, s) => n + (s.dependsOn?.length || 0), 0);
  score -= depCount * 2;
  score -= Math.max(0, steps.length - agents.length) * 3;

  if (candidate.strategy?.toLowerCase().includes("minimal")) score += 4;
  if (candidate.strategy?.toLowerCase().includes("parallel")) score += 3;

  score += Math.min(10, (candidate.rationale?.length || 0) / 40);
  return Math.round(score * 100) / 100;
}

export function explainScore(candidate, agents) {
  const agentSet = new Set(agents.map((a) => a.title));
  const steps = candidateSteps(candidate);
  const covered = new Set(steps.map((s) => s.agent).filter((a) => agentSet.has(a)));
  const depCount = steps.reduce((n, s) => n + (s.dependsOn?.length || 0), 0);
  const extraSteps = Math.max(0, steps.length - agents.length);
  const strategy = (candidate.strategy || "").toLowerCase();
  const rationaleBonus = Math.min(10, (candidate.rationale?.length || 0) / 40);

  const factors = [
    {
      key: "coverage",
      label: "Agent coverage",
      delta: covered.size * 12,
      detail: `${covered.size} of ${agents.length} agents get scoped work`,
    },
  ];

  if (depCount > 0) {
    factors.push({
      key: "deps",
      label: "Dependency cost",
      delta: -depCount * 2,
      detail: `${depCount} cross-step deps block parallel runs`,
    });
  }
  if (extraSteps > 0) {
    factors.push({
      key: "steps",
      label: "Step overhead",
      delta: -extraSteps * 3,
      detail: `${extraSteps} extra steps beyond agent count`,
    });
  }
  if (strategy.includes("minimal")) {
    factors.push({
      key: "minimal",
      label: "Minimal patch",
      delta: 4,
      detail: "Smaller diff → fewer worker tokens",
    });
  }
  if (strategy.includes("parallel")) {
    factors.push({
      key: "parallel",
      label: "Parallel tracks",
      delta: 3,
      detail: "Independent agents finish without waiting",
    });
  }
  if (rationaleBonus > 0) {
    factors.push({
      key: "clarity",
      label: "Plan clarity",
      delta: Math.round(rationaleBonus * 100) / 100,
      detail: "Clear rationale lowers rework risk",
    });
  }

  return {
    score: scoreCandidate(candidate, agents),
    factors,
    stepCount: steps.length,
    agentsUsed: covered.size,
    depCount,
  };
}

export function rankCandidates(candidates, agents) {
  return [...candidates]
    .map((c) => ({ ...c, score: scoreCandidate(c, agents) }))
    .sort((a, b) => b.score - a.score);
}

export function estimateCreditSavings({ branchCount, agentCount, intent, prunedCount }) {
  const plannerTokens = estimateTokens(intent) + 1800;
  const avoidedSwarmTokens = prunedCount * agentCount * EST_TOKENS_PER_AGENT_RUN;
  const winnerSwarmTokens = agentCount * EST_TOKENS_PER_AGENT_RUN;
  const naiveTokens = branchCount * agentCount * EST_TOKENS_PER_AGENT_RUN;
  const hyperTokens = plannerTokens + winnerSwarmTokens;

  return {
    plannerTokens,
    avoidedSwarmTokens,
    winnerSwarmTokens,
    naiveTokens,
    hyperTokens,
    tokensSaved: Math.max(0, naiveTokens - hyperTokens),
    branchesExplored: branchCount,
    branchesPruned: prunedCount,
    branchesExecuted: 1,
    agentCount,
  };
}

function pruneReason(winner, loser, agents) {
  const w = explainScore(winner, agents);
  const l = explainScore(loser, agents);
  const reasons = [`Score ${l.score} vs winner ${w.score}`];

  if (l.stepCount > w.stepCount) {
    reasons.push(`${l.stepCount - w.stepCount} extra steps → more Groq calls`);
  }
  if (l.depCount > w.depCount) {
    reasons.push(`${l.depCount - w.depCount} more blocking dependencies`);
  }
  if (l.agentsUsed < w.agentsUsed) {
    reasons.push(`Uses ${l.agentsUsed}/${agents.length} agents vs ${w.agentsUsed}`);
  }
  if (!loser.strategy?.toLowerCase().includes("minimal") && winner.strategy?.toLowerCase().includes("minimal")) {
    reasons.push("Winner favors minimal patch for token budget");
  }

  return reasons.slice(0, 3).join(" · ");
}

function buildControllerVerdict(winner, ranked, savings, agents) {
  const winnerExplain = explainScore(winner, agents);
  const positiveFactors = winnerExplain.factors
    .filter((factor) => factor.delta > 0)
    .slice(0, 2)
    .map((factor) => factor.detail);

  const savedK = Math.round(savings.tokensSaved / 1000);
  const headline = `Altbot chose "${winner.title}"`;
  const body = [
    `Explored ${savings.branchesExplored} branches in one planner pass (~${Math.round(savings.plannerTokens / 1000)}k tokens).`,
    `Pruned ${savings.branchesPruned} paths before any agent wrote code — saves ~${savedK}k tokens vs running every branch.`,
    positiveFactors.length ? `Why: ${positiveFactors.join(". ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    headline,
    body,
    winnerRationale: winner.rationale || "",
    strategy: winner.strategy || "",
  };
}

function formatStrategy(strategy = "") {
  return strategy.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

async function fetchCandidates(intent, agents, attachments) {
  const provider = agentGroqConfig("altbot");
  const result = await groqJson({
    name: "open_ide_hyper_candidates",
    schema: CANDIDATES_SCHEMA,
    model: provider.model,
    apiKey: provider.apiKey,
    agentKey: "altbot",
    temperature: 0.25,
    system: [
      "You are a hyperreasoning controller.",
      "Return exactly 3 distinct implementation plan candidates as JSON.",
      "Each candidate must use a different strategy: minimal_patch, layered_deps, parallel_agents.",
      "Every step.agent must be one of the selected agents.",
      "Do not write code — plans only.",
    ].join(" "),
    user: attachmentContent(
      [
        controllerPrompt(intent, agents, attachments),
        "Produce 3 meaningfully different architectural branches.",
      ].join("\n"),
      attachments
    ),
  });
  return result.candidates || [];
}

export async function runHyperreasoning(emit, { runId, intent, agents, attachments, normalizePlan }) {
  emit("search-started", {
    runId,
    title: "Hyperreasoning Search",
    subtitle: "Altbot is comparing 3 architectural branches before spending agent tokens…",
    agentCount: agents.length,
  });

  await sleep(280);
  emit("search-node", {
    runId,
    node: { id: "root", parentId: null, title: intent.slice(0, 80) || "Build task", status: "ROOT", depth: 0 },
  });

  const raw = await fetchCandidates(intent, agents, attachments);
  if (!raw.length) {
    throw new GroqError("Hyperreasoning returned no plan candidates");
  }

  const normalized = raw.map((c) => ({
    ...c,
    plan: normalizePlan({ summary: c.summary, steps: c.steps }, agents),
  }));

  const ranked = rankCandidates(
    normalized.map((c) => ({ ...c, steps: c.plan.steps })),
    agents
  ).map((rankedItem) => normalized.find((c) => c.id === rankedItem.id));

  const comparisons = [];

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    const rank = ranked.findIndex((r) => r.id === c.id) + 1;
    const breakdown = explainScore({ ...c, steps: c.plan.steps }, agents);

    await sleep(420);
    emit("search-node", {
      runId,
      node: {
        id: c.id,
        parentId: "root",
        title: c.title,
        shortSummary: formatStrategy(c.strategy),
        strategy: c.strategy,
        rationaleSummary: c.rationale,
        status: "IDLE",
        depth: 1,
        childIndex: i,
        childCount: normalized.length,
        stepCount: breakdown.stepCount,
        agentsUsed: breakdown.agentsUsed,
      },
    });
    emit("search-edge", { runId, parentId: "root", childId: c.id, actionLabel: `BRANCH_${i}` });
    emit("search-scored", {
      runId,
      id: c.id,
      score: breakdown.score,
      rank,
      breakdown,
    });

    comparisons.push({
      id: c.id,
      title: c.title,
      strategy: c.strategy,
      strategyLabel: formatStrategy(c.strategy),
      rationale: c.rationale,
      summary: c.plan.summary,
      score: breakdown.score,
      rank,
      stepCount: breakdown.stepCount,
      agentsUsed: breakdown.agentsUsed,
      factors: breakdown.factors,
    });
  }

  const winner = ranked[0];
  const losers = normalized.filter((c) => c.id !== winner.id);
  const savings = estimateCreditSavings({
    branchCount: normalized.length,
    agentCount: agents.length,
    intent,
    prunedCount: losers.length,
  });

  for (const loser of losers) {
    const reason = pruneReason(winner, loser, agents);
    await sleep(280);
    emit("search-pruned", { runId, nodeId: loser.id, reason });
    emit("search-node-status", { runId, nodeId: loser.id, status: "PRUNED" });
    const row = comparisons.find((item) => item.id === loser.id);
    if (row) row.pruneReason = reason;
  }

  await sleep(150);
  emit("search-node-status", { runId, nodeId: winner.id, status: "SUCCESS" });
  emit("search-best-path", { runId, nodeIds: ["root", winner.id], winnerId: winner.id });

  const verdict = buildControllerVerdict(winner, ranked, savings, agents);
  const winnerRow = comparisons.find((item) => item.id === winner.id);
  if (winnerRow) winnerRow.selected = true;

  emit("search-finished", {
    runId,
    success: true,
    winnerId: winner.id,
    summary: winner.plan.summary,
    verdict,
    savings,
    comparisons,
  });

  return {
    plan: winner.plan,
    winnerId: winner.id,
    ranked: ranked.map((c) => ({ id: c.id, score: scoreCandidate({ steps: c.plan.steps }, agents) })),
    verdict,
    savings,
    comparisons,
  };
}
