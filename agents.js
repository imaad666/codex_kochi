export const AGENTS = {
  Frontend: {
    id: "frontend",
    title: "Frontend",
    file: "src/App.jsx",
    language: "javascript",
    systemPrompt: [
      "You are Open IDE's frontend implementation agent.",
      "Build accessible React interfaces with clear component boundaries.",
      "Return complete, runnable project files. Use ES modules. Do not use Markdown fences.",
      "Honor the controller plan and avoid inventing backend contracts.",
    ].join(" "),
  },
  Backend: {
    id: "backend",
    title: "Backend",
    file: "server.js",
    language: "javascript",
    systemPrompt: [
      "You are Open IDE's Node.js backend implementation agent.",
      "Build small, secure Express APIs with explicit validation and errors.",
      "Return complete, runnable project files. Use ES modules because package.json sets type=module. Do not use Markdown fences.",
      "Honor the controller plan and any shared data contract.",
    ].join(" "),
  },
  Database: {
    id: "database",
    title: "Database",
    file: "schema.sql",
    language: "sql",
    systemPrompt: [
      "You are Open IDE's PostgreSQL data design agent.",
      "Produce a minimal schema with constraints and useful indexes.",
      "Return one complete SQL file. Do not use Markdown fences.",
      "Honor the controller plan and avoid unnecessary tables.",
    ].join(" "),
  },
};

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
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
          agent: {
            type: "string",
            enum: Object.keys(AGENTS),
          },
          dependsOn: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "title", "description", "agent", "dependsOn"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "steps"],
  additionalProperties: false,
};

export const FILE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          filename: { type: "string" },
          code: { type: "string" },
          summary: { type: "string" },
        },
        required: ["filename", "code", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "files"],
  additionalProperties: false,
};

export function selectedAgents(names = []) {
  return names.filter((name) => AGENTS[name]).map((name) => AGENTS[name]);
}

const AGENT_CHAT_PERSONAS = {
  Frontend: {
    displayName: "Ives UI",
    lane: "React UI, components, layout, styling, and client-side files like src/App.jsx",
    tone: "Visual, crisp, opinionated about UX and polish.",
  },
  Backend: {
    displayName: "Jobalyser",
    lane: "Express APIs, server.js, routes, middleware, validation, and backend architecture",
    tone: "Direct, systems-minded, no fluff.",
  },
  Database: {
    displayName: "WzData",
    lane: "SQL schemas, migrations, indexes, and data contracts in schema.sql",
    tone: "Precise and schema-focused.",
  },
};

export function agentChatSystem(agentName) {
  const agent = AGENTS[agentName];
  const persona = AGENT_CHAT_PERSONAS[agentName];
  if (!agent || !persona) return "";
  return [
    `You are ${persona.displayName} (${agent.title}) inside Open IDE — a live multi-agent coding swarm.`,
    persona.tone,
    `Your lane only: ${persona.lane}.`,
    "Answer the user's CURRENT message. Reference project files from context when they exist.",
    "Never sound like a generic chatbot. Banned phrases: 'How can I help', 'What can I assist', 'I'm here to help'.",
    "On greetings: one in-character sentence about what you own in this repo right now.",
    "You cannot clear the workspace or push to GitHub — Altbot handles that.",
    "Reply in 1-3 short sentences. No code blocks or JSON.",
  ].join(" ");
}

export const ALTBOT_CHAT_SYSTEM = [
  "You are Altbot, the Open IDE controller — hyperreasoning, orchestration, workspace actions.",
  "Answer the user's CURRENT message in 1-3 sentences. In-character, not generic customer support.",
  "Never say 'How can I help you today' or offer vague assistance.",
  "Workspace actions (clear, push, download, run preview) are handled by the IDE automatically.",
  "On greetings: one sentence on swarm status, hyperreasoning, or what you can orchestrate.",
  "Only mention Frontend/Backend/Database when routing a specific code question to them.",
].join(" ");

export function attachmentText(attachments = [], maxChars = 24000) {
  const lines = attachments.map((attachment, index) => {
    const header = [
      `Attachment ${index + 1}: ${attachment.name}`,
      `type=${attachment.type}`,
      `kind=${attachment.kind}`,
      `size=${attachment.size} bytes`,
    ].join(" | ");

    if (attachment.kind === "text" && attachment.content) {
      return `${header}\n<file name="${attachment.name}">\n${attachment.content.slice(0, maxChars)}\n</file>`;
    }
    if (attachment.kind === "image") {
      return `${header}\nImage is included as multimodal input. Use it as product/context reference.`;
    }
    return `${header}\nBinary file metadata only. Ask for a text export if exact contents are required.`;
  });

  return lines.length ? `User-provided attachments:\n${lines.join("\n\n")}` : "";
}

export function attachmentContent(text, attachments = [], { includeImages = true } = {}) {
  const content = [{ type: "text", text }];
  if (!includeImages) return content;
  for (const attachment of attachments) {
    if (attachment.kind === "image" && attachment.dataUrl) {
      content.push({
        type: "image_url",
        image_url: {
          url: attachment.dataUrl,
        },
      });
    }
  }
  return content;
}

export function controllerPrompt(intent, agents, attachments = []) {
  return [
    "You are the controller for a visual multi-agent coding environment.",
    "Create a concise implementation plan, not code.",
    "Every step must be owned by one of the selected agents.",
    "Use dependsOn only when a real output dependency exists; otherwise allow parallel work.",
    "If Database and Backend are both selected, Backend usually depends on the Database schema step.",
    "If Backend and Frontend are both selected, Frontend usually depends on the Backend API contract step.",
    `Selected agents: ${agents.map((agent) => agent.title).join(", ")}`,
    `User intent: ${intent}`,
    attachmentText(attachments),
  ].join("\n");
}

export function workerPrompt({ intent, plan, agent, attachments = [], sharedContext = "" }) {
  const ownedSteps = plan.steps.filter((step) => step.agent === agent.title);
  return [
    `User intent: ${intent}`,
    `Primary target filename: ${agent.file}`,
    `Controller summary: ${plan.summary}`,
    `Your assigned steps: ${JSON.stringify(ownedSteps)}`,
    attachmentText(attachments, 1000),
    sharedContext ? `Upstream context:\n${sharedContext}` : "",
    "Return the primary target file. Add one small helper file only if required.",
    "Use the ---FILE / ---END FILE--- block format from your system instructions.",
  ]
    .filter(Boolean)
    .join("\n");
}
