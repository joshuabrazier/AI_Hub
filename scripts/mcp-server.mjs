// ===================================================================
// AN MCP SERVER FOR CREATING A PROJECT BY TALKING
//
// "Here is a new project, 250 hours, one phase, these are the tasks, the
// client is Bowhill." Claude Code turns that into a call to plan_project,
// shows you what it would do, and only writes when you say so.
//
// IT IS A CLIENT OF THE APP, NOT A SECOND COPY OF IT. Every rule - which
// names resolve, what is refused, who may write, the single transaction -
// lives in the app behind /api/delivery/project-plan. This holds a token and
// speaks JSON-RPC. That is deliberate: an MCP server that reached the
// database directly would be a second implementation of authorization, in
// the process least likely to be updated when the rules change.
//
// HAND-ROLLED RATHER THAN A DEPENDENCY, which is a judgement worth stating.
// The stdio transport is newline-delimited JSON-RPC and the surface used
// here is four methods; @modelcontextprotocol/sdk would do it properly but
// this repo has no MCP dependency, and adding one to the application's
// package.json for a script that never ships in the bundle is a cost paid by
// every install. If this grows past two tools, take the dependency.
//
// SET UP, from the repo root:
//
//   claude mcp add ai-hub -- node scripts/mcp-server.mjs
//
// with these in the environment:
//
//   AI_HUB_URL     http://localhost:3100 or the deployed address
//   AI_HUB_TOKEN   from scripts/create-access-token.mjs
//
// TWO TOOLS, AND THE SPLIT IS THE SAFETY. plan_project reads and returns
// what would happen; create_project writes. A model that calls the first and
// reports "done" has told you nothing was created, which is true. Claude
// Code's own permission prompt lands on the second.
// ===================================================================
import { createInterface } from "node:readline";

const BASE_URL = (process.env.AI_HUB_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const TOKEN = process.env.AI_HUB_TOKEN;

// The protocol version this speaks. Echoed back to a client that asks for
// the same one; a client asking for something else still gets this, which is
// what the specification says to do rather than failing the handshake.
const PROTOCOL_VERSION = "2024-11-05";

const TASK_SCHEMA = {
  type: "object",
  required: ["title", "estimateHours"],
  properties: {
    title: { type: "string", description: "What the task is." },
    estimateHours: { type: "number", description: "Hours, not minutes." },
    description: { type: "string" },
    assigneeName: {
      type: "string",
      description:
        "A person's name as it appears in the portal. Resolved against real accounts - an ambiguous or unknown name leaves the task unassigned and says so, rather than guessing.",
    },
  },
};

const PLAN_SCHEMA = {
  type: "object",
  required: ["clientName", "projectTitle", "phases"],
  properties: {
    clientName: {
      type: "string",
      description:
        "The client this is for. Matched against existing clients - an exact or uniquely-prefixed name reuses that client, an ambiguous one is refused, and an unknown one creates a new client.",
    },
    projectTitle: { type: "string" },
    description: { type: "string" },
    isBillable: { type: "boolean", description: "Defaults to true." },
    budgetHours: {
      type: "number",
      description:
        "What the project was sold for. Compared against the total of the task estimates and reported either way. This is the WHOLE project, not one task.",
    },
    phases: {
      type: "array",
      description: "At least one. A phase is a stage of work and becomes a section of the board.",
      items: {
        type: "object",
        required: ["name", "tasks"],
        properties: {
          name: { type: "string" },
          tasks: { type: "array", items: TASK_SCHEMA },
        },
      },
    },
    members: {
      type: "array",
      description:
        "Who is on the project. Anybody assigned a task is added automatically, so this is for people who are on it without having a task yet - and for saying who leads.",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          isLead: { type: "boolean" },
        },
      },
    },
  },
};

const TOOLS = [
  {
    name: "plan_project",
    description:
      "Work out what creating a project would do, and CREATE NOTHING. Returns the client it would use or make, every phase and task, who each task would go to, the totals against the budget, and any warnings or blockers. Always call this first and show the result before calling create_project.",
    inputSchema: PLAN_SCHEMA,
  },
  {
    name: "create_project",
    description:
      "Actually create the project, its phases, its tasks and its members, in one transaction. Only call this after plan_project has been shown to the person and they have agreed to it. Takes the same arguments.",
    inputSchema: PLAN_SCHEMA,
  },
];

async function callApi(plan, confirm) {
  if (!TOKEN) {
    return {
      error:
        "AI_HUB_TOKEN is not set, so there is no credential to call with. Mint one with scripts/create-access-token.mjs.",
    };
  }

  let response;

  try {
    response = await fetch(`${BASE_URL}/api/delivery/project-plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ ...plan, confirm }),
    });
  } catch (cause) {
    // The commonest failure by far, and the one where a bare "fetch failed"
    // wastes the most time.
    return { error: `Could not reach ${BASE_URL}. Is the app running? (${cause.message})` };
  }

  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: `The app answered ${response.status} with something that is not JSON.` };
  }

  if (response.status === 401) {
    return { error: "The token was refused. It may be expired, revoked, or for the wrong scope." };
  }

  return body;
}

// -------------------------------------------------------------------
// JSON-RPC over stdio: one message per line, responses to stdout, anything
// diagnostic to stderr.
//
// STDOUT IS THE PROTOCOL. A stray console.log here corrupts the stream and
// the client's failure is unhelpful, so everything human goes to stderr.
// -------------------------------------------------------------------
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const result = (id, value) => send({ jsonrpc: "2.0", id, result: value });

const failure = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

// A tool result is content blocks. Text carrying JSON, because the model
// reads it and a person reads it over its shoulder.
const toolText = (id, value) =>
  result(id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

async function handle(message) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "ai-hub-delivery", version: "1.0.0" },
      });

    // A notification. It has no id and takes no response - replying to one
    // is a protocol error some clients report and others silently ignore.
    case "notifications/initialized":
      return;

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: TOOLS });

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};

      if (name !== "plan_project" && name !== "create_project") {
        return failure(id, -32602, `Unknown tool: ${name}`);
      }

      const body = await callApi(args, name === "create_project");

      return toolText(id, body);
    }

    default:
      // Unknown methods are refused rather than ignored, so a client asking
      // for something this does not do finds out.
      return failure(id, -32601, `Unknown method: ${method}`);
  }
}

const reader = createInterface({ input: process.stdin });

reader.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    process.stderr.write(`mcp-server: ignoring a line that is not JSON\n`);
    return;
  }

  // Errors are answered rather than thrown, because an unhandled rejection
  // takes the server down and the client sees the pipe close with nothing
  // said.
  handle(message).catch((error) => {
    process.stderr.write(`mcp-server: ${error.stack ?? error}\n`);

    if (message.id !== undefined) failure(message.id, -32603, String(error.message ?? error));
  });
});

process.stderr.write(`mcp-server: ready, talking to ${BASE_URL}\n`);
