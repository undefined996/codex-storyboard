import readline from "node:readline";

const SERVER_NAME = "Codex Storyboard MCP";
const SERVER_VERSION = "0.2.0";
const DEFAULT_URL = "http://127.0.0.1:43218";

const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function storyboardUrl(args = {}) {
  return String(args.storyboardUrl || process.env.CODEX_STORYBOARD_URL || DEFAULT_URL).replace(/\/+$/, "");
}

async function requestJson(path, options = {}, args = {}) {
  const response = await fetch(`${storyboardUrl(args)}${path}`, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function jsonOptions(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

function tools() {
  return [
    {
      name: "list_storyboard_generation_tasks",
      title: "List Storyboard Generation Tasks",
      description: "List pending, processing, ready, or failed image/video generation tasks from the local Codex storyboard.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Comma-separated statuses. Defaults to pending. Values: pending,processing,ready,failed."
          },
          storyboardUrl: { type: "string", description: `Storyboard URL. Defaults to ${DEFAULT_URL}.` }
        },
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "claim_storyboard_generation_task",
      title: "Claim Storyboard Generation Task",
      description: "Mark a pending storyboard task as processing before starting Image Generation, HyperFrames, or Remotion work.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "complete_storyboard_generation_task",
      title: "Complete Storyboard Generation Task",
      description: "Copy a generated local image or video into the storyboard media directory and mark the task ready.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          sourcePath: { type: "string", description: "Absolute path to the generated PNG/JPEG/WebP/MP4/WebM/MOV." },
          mediaType: { type: "string", enum: ["image", "video"] },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId", "sourcePath"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "fail_storyboard_generation_task",
      title: "Fail Storyboard Generation Task",
      description: "Mark a storyboard generation task failed and return a visible error message to the row.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          error: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId", "error"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    }
  ];
}

async function callTool(id, params) {
  const args = params?.arguments ?? {};

  if (params?.name === "list_storyboard_generation_tasks") {
    const status = encodeURIComponent(args.status || "pending");
    const result = await requestJson(`/api/generation/tasks?status=${status}`, {}, args);
    const summary = result.tasks.length === 0
      ? "No matching storyboard generation tasks."
      : result.tasks
          .map((task) => `${task.taskId} | ${task.projectTitle} (${task.aspectRatio}) | shot ${task.shotIndex} | ${task.generator} | ${task.mediaType} | ${task.status}\n${task.visualPrompt}`)
          .join("\n\n");
    sendResult(id, {
      content: [{ type: "text", text: summary }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "claim_storyboard_generation_task") {
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/claim`,
      jsonOptions({}),
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Claimed ${args.taskId} from ${result.task.projectTitle} (${result.task.aspectRatio}) for ${result.task.generator}.` }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "complete_storyboard_generation_task") {
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/complete`,
      jsonOptions({ sourcePath: args.sourcePath, mediaType: args.mediaType }),
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Completed ${args.taskId}; asset returned to ${result.task.projectTitle}, shot ${result.task.shotIndex}.` }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "fail_storyboard_generation_task") {
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/fail`,
      jsonOptions({ error: args.error }),
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Marked ${args.taskId} failed: ${args.error}` }],
      structuredContent: result
    });
    return;
  }

  sendError(id, JsonRpcError.INVALID_PARAMS, `Unknown tool: ${params?.name ?? ""}`);
}

async function handle(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        "Use the storyboard task tools to claim pending tasks, generate assets with the matching Codex skill, and complete or fail each task. Never complete a task before verifying the local output file."
    });
    return;
  }

  if (method === "ping") return sendResult(id, {});
  if (method === "tools/list") return sendResult(id, { tools: tools() });

  if (method === "tools/call") {
    try {
      await callTool(id, params);
    } catch (error) {
      sendError(id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (id !== undefined) sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    handle(message).catch((error) => {
      if (message.id !== undefined) sendError(message.id, JsonRpcError.INVALID_PARAMS, String(error));
    });
  } catch {
    // Ignore non-JSON stdout input.
  }
});
