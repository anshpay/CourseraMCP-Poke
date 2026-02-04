import { randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createCourseraServer, getCourseraConfig } from "./coursera-server.js";

// Validate config on startup
try {
  getCourseraConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\n=== Setup Instructions ===");
  console.error("1. Open Coursera in your browser and log in");
  console.error("2. Open DevTools (F12) > Application > Cookies");
  console.error("3. Find the CAUTH cookie and copy its value");
  console.error("4. Create .env.local with: COURSERA_CAUTH=<your_cauth_value>");
  console.error("   Or copy all cookies: COURSERA_COOKIES=<all_cookies>");
  console.error("===========================\n");
  process.exit(1);
}

function parseCsv(value) {
  if (!value) return undefined;
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function loadHttpConfig() {
  const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
  const portValue = Number.parseInt(process.env.MCP_HTTP_PORT ?? "", 10);
  const port = Number.isFinite(portValue) ? portValue : 3334;
  const apiKey = process.env.MCP_API_KEY;
  const allowedHosts = parseCsv(process.env.MCP_ALLOWED_HOSTS);
  return { host, port, apiKey, allowedHosts };
}

const { host, port, apiKey, allowedHosts } = loadHttpConfig();
const app = createMcpExpressApp({
  host,
  allowedHosts,
});

function getFirstHeaderValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function extractApiKey(req) {
  const authHeader = getFirstHeaderValue(req.headers.authorization);
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return (match ? match[1] : authHeader).trim();
  }
  const headerKey = getFirstHeaderValue(req.headers["x-api-key"]);
  if (typeof headerKey === "string") {
    return headerKey.trim();
  }
  return null;
}

function respondJsonRpcError(res, status, code, message) {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

// Optional API key authentication
if (apiKey) {
  app.use((req, res, next) => {
    const provided = extractApiKey(req);
    if (!provided || provided !== apiKey) {
      respondJsonRpcError(res, 401, -32000, "Unauthorized");
      return;
    }
    next();
  });
}

const sessions = new Map();

function storeSession(sessionId, transport, server) {
  sessions.set(sessionId, { transport, server });
}

async function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);
  if (session?.server) {
    try {
      await session.server.close();
    } catch {
      // Ignore server close errors.
    }
  }
}

async function shutdownSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session?.transport) {
    try {
      await session.transport.close();
    } catch {
      // Ignore transport close errors.
    }
  }
  await cleanupSession(sessionId);
}

function hasInitializeRequest(body) {
  if (!body) return false;
  if (isInitializeRequest(body)) return true;
  return Array.isArray(body) && body.some((entry) => isInitializeRequest(entry));
}

async function getStreamableTransport(req, res) {
  const sessionId = getFirstHeaderValue(req.headers["mcp-session-id"]);
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      respondJsonRpcError(
        res,
        400,
        -32000,
        "Bad Request: No valid session ID provided"
      );
      return null;
    }
    if (!(session.transport instanceof StreamableHTTPServerTransport)) {
      respondJsonRpcError(
        res,
        400,
        -32000,
        "Bad Request: Session exists but uses a different transport protocol"
      );
      return null;
    }
    return session.transport;
  }

  if (req.method !== "POST" || !hasInitializeRequest(req.body)) {
    respondJsonRpcError(
      res,
      400,
      -32000,
      "Bad Request: No valid session ID provided"
    );
    return null;
  }

  const server = createCourseraServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      storeSession(sid, transport, server);
    },
  });
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      cleanupSession(sid).catch(() => {});
    }
  };
  await server.connect(transport);
  return transport;
}

// Streamable HTTP endpoint (for Poke)
app.all("/mcp", async (req, res) => {
  try {
    const transport = await getStreamableTransport(req, res);
    if (!transport) return;
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling /mcp request:", error);
    if (!res.headersSent) {
      respondJsonRpcError(res, 500, -32603, "Internal server error");
    }
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "coursera-mcp" });
});

const httpServer = app.listen(port, host, (error) => {
  if (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
  console.log(`\n========================================`);
  console.log(`Coursera MCP Server`);
  console.log(`========================================`);
  console.log(`Listening on: http://${host}:${port}`);
  console.log(`MCP endpoint: http://${host}:${port}/mcp`);
  console.log(`\nTo connect from Poke:`);
  console.log(`  Server URL: http://localhost:${port}/mcp`);
  if (apiKey) {
    console.log(`  API Key: (configured)`);
  }
  console.log(`========================================\n`);
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  const sessionIds = [...sessions.keys()];
  for (const sessionId of sessionIds) {
    await shutdownSession(sessionId);
  }
  httpServer.close(() => {
    process.exit(0);
  });
});
