const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_PLANNER = "meta-llama/llama-4-scout-17b-16e-instruct";
const DEFAULT_WORKER = "meta-llama/llama-4-scout-17b-16e-instruct";

/** Per-card defaults — matches .env.vercel.template when env overrides are unset. */
export const AGENT_DEFAULT_MODELS = {
  ALTBOT: "meta-llama/llama-4-scout-17b-16e-instruct",
  FRONTEND: "llama-3.3-70b-versatile",
  BACKEND: "qwen/qwen3-32b",
  DATABASE: "llama-3.1-8b-instant",
};

export class GroqError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "GroqError";
    this.status = status;
  }
}

const AGENT_ENV_KEYS = {
  altbot: "ALTBOT",
  Altbot: "ALTBOT",
  Frontend: "FRONTEND",
  Backend: "BACKEND",
  Database: "DATABASE",
};

export function groqConfig() {
  const fallback = process.env.GROQ_MODEL || DEFAULT_PLANNER;
  return {
    apiKey: process.env.GROQ_API_KEY || "",
    plannerModel: process.env.GROQ_PLANNER_MODEL || fallback,
    workerModel: process.env.GROQ_WORKER_MODEL || DEFAULT_WORKER,
    maxOutputTokens: Number(process.env.GROQ_MAX_OUTPUT_TOKENS || 1600),
    requestCharBudget: Number(process.env.GROQ_REQUEST_CHAR_BUDGET || 7000),
    tpmSafeTotal: Number(process.env.GROQ_TPM_SAFE_TOTAL || 5500),
    minGapMs: Number(process.env.GROQ_MIN_GAP_MS || 700),
  };
}

/** Per-card provider config — optional GROQ_{ALTBOT|FRONTEND|BACKEND|DATABASE}_{API_KEY,MODEL}. */
export function agentGroqConfig(agentKey = "altbot") {
  const global = groqConfig();
  const envPrefix = AGENT_ENV_KEYS[agentKey] || String(agentKey || "ALTBOT").toUpperCase();
  const perKey = process.env[`GROQ_${envPrefix}_API_KEY`] || "";
  const perModel = process.env[`GROQ_${envPrefix}_MODEL`] || "";
  const isPlanner = envPrefix === "ALTBOT";
  const defaultModel =
    AGENT_DEFAULT_MODELS[envPrefix] || (isPlanner ? global.plannerModel : global.workerModel);
  return {
    ...global,
    agentKey: envPrefix,
    apiKey: perKey || global.apiKey,
    model: perModel || defaultModel,
  };
}

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

let lastGroqCall = 0;

async function groqThrottle() {
  const { minGapMs } = groqConfig();
  const wait = minGapMs - (Date.now() - lastGroqCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastGroqCall = Date.now();
}

function userPayloadCharLength(user) {
  if (typeof user === "string") return user.length;
  if (!Array.isArray(user)) return String(user || "").length;
  let chars = 0;
  for (const part of user) {
    if (part?.type === "text") chars += String(part.text || "").length;
    else if (part?.type === "image_url") chars += 12_000;
  }
  return chars;
}

function truncateUserPayload(user, maxChars) {
  if (typeof user === "string") return truncateText(user, maxChars);
  if (!Array.isArray(user)) return truncateText(String(user || ""), maxChars);
  let remaining = maxChars;
  return user
    .map((part) => {
      if (part?.type !== "text") return part;
      const text = String(part.text || "");
      if (text.length <= remaining) {
        remaining -= text.length;
        return part;
      }
      const clipped = truncateText(text, Math.max(0, remaining));
      remaining = 0;
      return { ...part, text: clipped };
    })
    .filter((part) => part?.type !== "text" || String(part.text || "").length > 0);
}

function fitUserPayload(systemLen, user, maxTokens) {
  const { requestCharBudget } = groqConfig();
  const userBudget = Math.max(1800, requestCharBudget - systemLen);
  let userContent =
    typeof user === "string"
      ? truncateText(user, userBudget)
      : truncateUserPayload(user, userBudget);

  if (Array.isArray(userContent)) {
    while (userContent.some((part) => part?.type === "image_url")) {
      const inputChars = systemLen + userPayloadCharLength(userContent);
      try {
        capOutputTokens(inputChars, maxTokens);
        break;
      } catch {
        const lastImageIndex = userContent.map((part, index) => (part?.type === "image_url" ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
        if (lastImageIndex < 0) break;
        userContent = userContent.filter((_, index) => index !== lastImageIndex);
      }
    }
    if (!userContent.some((part) => part?.type === "image_url")) {
      userContent = truncateUserPayload(
        userContent,
        userBudget
      );
    }
  }

  const inputChars = systemLen + userPayloadCharLength(userContent);
  const cappedOutput = capOutputTokens(inputChars, maxTokens);
  return { userContent, inputChars, cappedOutput };
}

function fitChatPayload(systemLen, user, maxTokens) {
  const requestCharBudget = Number(process.env.GROQ_CHAT_CHAR_BUDGET || 3200);
  const tpmSafeTotal = Number(process.env.GROQ_CHAT_TPM_SAFE || 4800);
  const userBudget = Math.max(1200, requestCharBudget - systemLen);
  let userContent =
    typeof user === "string"
      ? truncateText(user, userBudget)
      : truncateUserPayload(user, userBudget);

  if (Array.isArray(userContent)) {
    while (userContent.some((part) => part?.type === "image_url")) {
      const inputChars = systemLen + userPayloadCharLength(userContent);
      try {
        capOutputTokens(inputChars, maxTokens, tpmSafeTotal);
        break;
      } catch {
        const lastImageIndex = userContent
          .map((part, index) => (part?.type === "image_url" ? index : -1))
          .reduce((a, b) => Math.max(a, b), -1);
        if (lastImageIndex < 0) break;
        userContent = userContent.filter((_, index) => index !== lastImageIndex);
      }
    }
    userContent = truncateUserPayload(userContent, userBudget);
  }

  const inputChars = systemLen + userPayloadCharLength(userContent);
  const cappedOutput = capOutputTokens(inputChars, maxTokens, tpmSafeTotal);
  return { userContent, inputChars, cappedOutput };
}

function capOutputTokens(inputChars, requestedOutput, tpmSafeTotalOverride) {
  const { maxOutputTokens, tpmSafeTotal } = groqConfig();
  const safeTotal = tpmSafeTotalOverride ?? tpmSafeTotal;
  const inputTokens = estimateTokens(inputChars);
  const room = safeTotal - inputTokens - 150;
  const capped = Math.min(requestedOutput, maxOutputTokens, room);
  if (capped < 256) {
    throw new GroqError(
      "Prompt too large for Groq free tier — shorten your build prompt, deselect an agent, or use fewer/smaller inspo images."
    );
  }
  return capped;
}

export function truncateText(text, maxChars = 12000) {
  const value = String(text || "");
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated for Groq token limits]`;
}

function normalizeUserContent(user) {
  if (typeof user === "string") return user;
  if (!Array.isArray(user)) return String(user);
  const hasImage = user.some((part) => part?.type === "image_url");
  if (!hasImage) {
    return user
      .map((part) => (part?.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  return user;
}

export function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new GroqError("Groq returned an empty response");
  }

  const attempts = [
    trimmed,
    trimmed.match(/^```(?:json)?\s*([\s\S]*?)\n```$/i)?.[1]?.trim(),
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
  ].filter(Boolean);

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next shape
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // fall through
    }
  }

  throw new GroqError("Groq returned invalid JSON");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function groqJson({
  name,
  schema,
  system,
  user,
  temperature = 0.2,
  model: modelOverride,
  apiKey: apiKeyOverride,
  agentKey,
}) {
  const provider = agentKey ? agentGroqConfig(agentKey) : groqConfig();
  const apiKey = apiKeyOverride || provider.apiKey;
  const model = modelOverride || provider.model || provider.plannerModel;
  if (!apiKey) {
    throw new GroqError("GROQ_API_KEY is not configured");
  }

  const { requestCharBudget } = groqConfig();
  const schemaHint = JSON.stringify(schema);
  const systemWithSchema = truncateText(
    `${system}\nReturn ONLY valid JSON for "${name}". Match this JSON Schema:\n${schemaHint}`,
    3200
  );

  const userContent = truncateText(
    normalizeUserContent(user),
    Math.max(1500, requestCharBudget - systemWithSchema.length)
  );

  await groqThrottle();

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: "system", content: systemWithSchema },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Groq request failed with ${response.status}`;
    throw new GroqError(message, response.status);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new GroqError("Groq returned an empty response");
  }

  return extractJsonObject(content);
}

/** Workers emit large code strings — json_object mode often fails validation on Groq. */
export async function groqWorkerJson({
  name,
  schema,
  system,
  user,
  temperature = 0.2,
  model: modelOverride,
  maxTokens = 12000,
  retries = 2,
}) {
  const schemaHint = JSON.stringify(schema);
  const workerSystem = [
    system,
    `Return ONLY valid JSON for "${name}".`,
    "The files[].code values must be properly JSON-escaped strings.",
    "Do not wrap the response in markdown fences.",
    `Match this shape:\n${schemaHint}`,
  ].join("\n");

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      if (attempt === 0) {
        return await groqJson({
          name,
          schema,
          system: workerSystem,
          user,
          temperature,
          model: modelOverride,
        });
      }

      const content = await groqText({
        system: workerSystem,
        user,
        temperature: Math.min(0.35, temperature + attempt * 0.05),
        model: modelOverride,
        maxTokens,
      });
      return extractJsonObject(content);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof GroqError &&
        (error.status === 400 ||
          error.status === 429 ||
          /invalid json|validate json|empty response/i.test(error.message));
      if (!retryable || attempt >= retries) break;
      await sleep(400 * (attempt + 1));
    }
  }

  throw lastError || new GroqError("Worker generation failed");
}

export async function groqText({
  system,
  user,
  temperature = 0.35,
  model: modelOverride,
  maxTokens = 500,
  apiKey: apiKeyOverride,
  agentKey,
  chatMode = false,
}) {
  const provider = agentKey ? agentGroqConfig(agentKey) : groqConfig();
  const apiKey = apiKeyOverride || provider.apiKey;
  const model = modelOverride || provider.model || provider.plannerModel;
  if (!apiKey) {
    throw new GroqError("GROQ_API_KEY is not configured");
  }

  const systemCap = chatMode ? 1400 : 2800;
  const systemContent = truncateText(system, systemCap);
  const { userContent, cappedOutput } = chatMode
    ? fitChatPayload(systemContent.length, user, maxTokens)
    : fitUserPayload(systemContent.length, user, maxTokens);

  await groqThrottle();

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: cappedOutput,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Groq request failed with ${response.status}`;
    throw new GroqError(message, response.status);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new GroqError("Groq returned an empty response");
  }
  return String(content).trim();
}
