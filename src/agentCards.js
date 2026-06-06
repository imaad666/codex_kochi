import altbotCard from "../cards/sam_altman_ALTBOT.jpeg";
import jobalyserCard from "../cards/SteveJob_Jobalyserr.jpg";
import ivesCard from "../cards/jonyives_IVESUI.jpg";
import wzdataCard from "../cards/steveaoz_WZDATA.jpg";

export const GROQ_MODEL_DEFAULTS = {
  altbot: "meta-llama/llama-4-scout-17b-16e-instruct",
  frontend: "llama-3.3-70b-versatile",
  backend: "qwen/qwen3-32b",
  database: "llama-3.1-8b-instant",
};

export function formatGroqModel(modelId = "") {
  const slug = String(modelId).split("/").pop() || modelId;
  return slug.replace(/-16e-instruct$/i, "").replace(/-versatile$/i, "").replace(/-instant$/i, "").replace(/-/g, " ");
}

export const AGENT_CARDS = [
  {
    name: "Altbot",
    role: "Controller",
    description: "Plans and routes the swarm",
    image: altbotCard,
    locked: true,
    model: GROQ_MODEL_DEFAULTS.altbot,
    introBlurb:
      "Altbot is always on. It runs hyperreasoning, scores three architectural branches, kills the losers before any agent writes code, and routes your chat to the right specialist.",
  },
  {
    name: "Jobalyser",
    role: "Backend",
    description: "Architecture and API systems",
    image: jobalyserCard,
    agent: "Backend",
    model: GROQ_MODEL_DEFAULTS.backend,
    introBlurb:
      "Jobalyser owns the server. APIs, routes, middleware, and system design — streamed live into server.js and whatever backend files your build needs.",
  },
  {
    name: "Ives UI",
    role: "Frontend",
    description: "Interface and experience",
    image: ivesCard,
    agent: "Frontend",
    model: GROQ_MODEL_DEFAULTS.frontend,
    introBlurb:
      "Ives UI owns what people see. React components, layout, interaction, and visual polish — written in real time while you watch the editor update.",
  },
  {
    name: "WzData",
    role: "Database",
    description: "Schema and data contracts",
    image: wzdataCard,
    agent: "Database",
    model: GROQ_MODEL_DEFAULTS.database,
    introBlurb:
      "WzData owns the data layer. Schemas, migrations, contracts, and persistence — aligned with what Frontend and Backend are building in parallel.",
  },
];

export const INTRO_MANIFESTO = {
  headline: "You describe the product. The swarm builds it.",
  paragraphs: [
    "Open IDE is not a chatbot that dumps code into a paste bin. It is a real-time multi-agent development environment — repo-first, Groq-powered, and built for people who want to see architecture get decided before tokens get burned.",
    "You connect GitHub. You say what you want. Altbot generates three genuinely different plans, ranks them in the open, and deploys only the winner. Each card agent spawns step-scoped subagents — own model, own lane — writing into a live workspace you can download, run, or push.",
    "This is what coding with a swarm actually looks like — not one model guessing, but specialized agents with a controller that chooses.",
  ],
};

export const INTRO_STATS = [
  { value: "3", label: "Plan branches explored" },
  { value: "1", label: "Winner deployed" },
  { value: "~60%", label: "Est. tokens saved vs naive" },
  { value: "4", label: "Agent cards in the deck" },
];

export const INTRO_FLOW = [
  {
    step: "01",
    title: "Choose your repo",
    detail:
      "Connect GitHub and open an existing repository or spin up a new one. Every file the swarm generates is destined for this repo — local session, zip download, or direct push.",
  },
  {
    step: "02",
    title: "Describe the build",
    detail:
      "Tell Open IDE what you want in plain language. Attach specs, screenshots, markdown, or reference files. Pick which agent cards join the swarm — Altbot is always in control.",
  },
  {
    step: "03",
    title: "Hyperreason first",
    detail:
      "Before a single agent writes code, Altbot runs hyperreasoning: three architectural strategies, scored in public, losers pruned. You see why the controller chose what it chose — and how much Groq budget it saved you.",
  },
  {
    step: "04",
    title: "Watch the swarm",
    detail:
      "Selected agents deploy sequentially on Groq. Files stream into a folder tree. Monaco updates live. The execution graph shows who is writing what. Chat lets you talk to Altbot or any agent directly.",
  },
  {
    step: "05",
    title: "Ship it",
    detail:
      "When the swarm finishes, you have real artifacts on disk — not a hallucinated snippet. Download a zip, run a local preview, or push to GitHub in one click.",
  },
];

export const INTRO_FEATURES = [
  {
    tag: "HYPERREASONING",
    title: "Plan before you pay",
    body: "Three branches every time — minimal patch, layered dependencies, parallel agents. Scored, ranked, and pruned with visible token savings before worker models fire. No more burning TPM on a bad architecture.",
  },
  {
    tag: "LIVE IDE",
    title: "A real workspace, not a demo",
    body: "Folder explorer, syntax-highlighted editor, hyperreasoning graph, and agent execution graph in one CRT shell. Sessions persist. Refresh restores your swarm state.",
  },
  {
    tag: "CHAT ROUTING",
    title: "Talk to the controller or the crew",
    body: "Message Altbot for orchestration or open a direct line to Frontend, Backend, or Database. Every reply knows the winning plan, file state, and what agents have already shipped.",
  },
  {
    tag: "SURFAGENT",
    title: "Visual direction before codegen",
    body: "SurfAgent scans the web for mood-matched UI references. Pin what you like on the inspo board and the swarm steers toward that aesthetic — without sending raw images into every Groq call.",
  },
  {
    tag: "TOKEN BUDGET",
    title: "Built for Groq free tier",
    body: "Conservative output caps, throttled requests, sequential agent runs, and text-only planner context. Open IDE is opinionated about not nuking your TPM on the first prompt.",
  },
  {
    tag: "OUTPUT",
    title: "Artifacts you can actually use",
    body: "Generated files land in .open-ide/runs, sync to your session, and export as a zip. Run server.js locally or push to the repo you picked in step one. This is deployable output.",
  },
];
