import { agentGroqConfig, groqText, GroqError } from "./groq.js";
import { attachmentContent, subagentPrompt, workerSystemPrompt } from "./agents.js";

const SUBAGENT_DISPLAY = {
  Frontend: "Ives UI",
  Backend: "Jobalyser",
  Database: "WzData",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripModelReasoning(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, "")
    .trim();
}

function stripCodeFence(value) {
  const match = value.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : value;
}

function parseWorkerText(text, agent, step) {
  const files = [];
  const raw = stripModelReasoning(text);
  const re = /---FILE:\s*([^\n]+?)\s*---\n([\s\S]*?)(?:\n---END FILE---|$)/gi;
  let match = re.exec(raw);
  while (match) {
    const filename = String(match[1] || "").trim();
    const code = stripCodeFence(String(match[2] || "").trim());
    if (filename && code) {
      files.push({
        filename,
        code,
        summary: `${agent.title} subagent (${step.title}) → ${filename}`,
      });
    }
    match = re.exec(raw);
  }

  if (!files.length) {
    const code = stripCodeFence(raw.trim());
    if (code) {
      files.push({
        filename: agent.file,
        code,
        summary: `${agent.title} subagent (${step.title}) → ${agent.file}`,
      });
    }
  }

  if (!files.length) {
    throw new GroqError(`${agent.title} subagent returned no file content for step "${step.title}"`);
  }

  return {
    summary: files.map((file) => file.filename).join(", "),
    files,
  };
}

function agentVisionContext(agent, attachments, inspoImages) {
  const visionAttachments =
    agent.title === "Frontend" && inspoImages.length
      ? [...attachments.filter((item) => item.kind !== "image"), ...inspoImages]
      : attachments;
  const includeImages = agent.title === "Frontend" && inspoImages.length > 0;
  return { visionAttachments, includeImages };
}

async function callSubagentGroq({ agent, step, intent, plan, attachments, includeImages, sharedContext, priorSummaries }) {
  const provider = agentGroqConfig(agent.title);
  const userText = subagentPrompt({
    intent,
    plan,
    agent,
    step,
    attachments,
    sharedContext,
    priorSummaries,
  });
  const user = attachmentContent(userText, attachments, { includeImages });
  const system = workerSystemPrompt(agent);

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const text = await groqText({
        system,
        user,
        model: provider.model,
        apiKey: provider.apiKey,
        agentKey: agent.title,
        maxTokens: 1600,
        temperature: 0.2 + attempt * 0.05,
      });
      return { provider, output: parseWorkerText(text, agent, step) };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(500 * (attempt + 1));
    }
  }

  throw lastError || new GroqError(`${agent.title} subagent failed on "${step.title}"`);
}

function stepsForAgent(plan, agent) {
  const owned = (plan.steps || []).filter((step) => step.agent === agent.title);
  if (owned.length) return owned;
  return [
    {
      id: `${agent.id || agent.title.toLowerCase()}-main`,
      title: `Implement ${agent.file}`,
      description: plan.summary || "Primary implementation pass",
      agent: agent.title,
      dependsOn: [],
    },
  ];
}

/**
 * Run one card agent as a fleet of step-scoped subagents (one Groq call per plan step).
 */
export async function runAgentSubagents({
  emit,
  intent,
  plan,
  agent,
  attachments = [],
  inspoImages = [],
  sharedContext = "",
}) {
  const steps = stepsForAgent(plan, agent);
  const displayName = SUBAGENT_DISPLAY[agent.title] || agent.title;
  const { visionAttachments, includeImages } = agentVisionContext(agent, attachments, inspoImages);
  const fileMap = new Map();
  const priorSummaries = [];

  emit("subagent-fleet-started", {
    parentAgent: agent.title,
    displayName,
    count: steps.length,
  });

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const subagentId = `${agent.title.toLowerCase()}-${step.id}`;
    const provider = agentGroqConfig(agent.title);

    emit("subagent-spawned", {
      subagentId,
      parentAgent: agent.title,
      displayName,
      stepId: step.id,
      stepTitle: step.title,
      stepIndex: index + 1,
      stepCount: steps.length,
      model: provider.model,
    });
    emit("subagent-status", {
      subagentId,
      parentAgent: agent.title,
      stepId: step.id,
      status: "running",
      message: step.title,
    });

    const { output } = await callSubagentGroq({
      agent,
      step,
      intent,
      plan,
      attachments: visionAttachments,
      includeImages,
      sharedContext,
      priorSummaries,
    });

    for (const file of output.files) {
      fileMap.set(file.filename, file);
    }
    priorSummaries.push(`${step.title}: ${output.summary}`);

    emit("subagent-complete", {
      subagentId,
      parentAgent: agent.title,
      stepId: step.id,
      status: "complete",
      files: output.files.map((file) => file.filename),
      summary: output.summary,
      model: provider.model,
    });

    await sleep(120);
  }

  const files = [...fileMap.values()];
  return {
    summary: `${displayName} · ${steps.length} subagent${steps.length === 1 ? "" : "s"} → ${files.map((f) => f.filename).join(", ")}`,
    files,
    subagentCount: steps.length,
  };
}

export function listAgentModels() {
  return Object.entries(SUBAGENT_DISPLAY).map(([agent, displayName]) => {
    const provider = agentGroqConfig(agent);
    return { agent, displayName, model: provider.model };
  });
}
