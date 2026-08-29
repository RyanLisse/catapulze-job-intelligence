import type { CapabilityRegistry } from "@ji/application/registry";
import type { Context } from "hono";

import { createRequestId, parseAuthHeader } from "./auth";
import { invokeMcpTool, mcpToolsFromRegistry } from "./rest";

type AnyRegistry = CapabilityRegistry<readonly { readonly id: string }[]>;

interface JsonRpcRequest {
  readonly id?: number | string;
  readonly jsonrpc?: string;
  readonly method: string;
  readonly params?: unknown;
}

const jsonRpcResponse = (
  id: number | string | undefined,
  result: unknown
): Response =>
  new Response(JSON.stringify({ id, jsonrpc: "2.0", result }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });

const jsonRpcError = (
  id: number | string | undefined,
  code: number,
  message: string
): Response =>
  new Response(JSON.stringify({ error: { code, message }, id, jsonrpc: "2.0" }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });

export const createMcpHandler = (registry: AnyRegistry) => {
  const tools = mcpToolsFromRegistry(registry);
  return async (context: Context): Promise<Response> => {
    let request: JsonRpcRequest;
    try {
      request = (await context.req.json()) as JsonRpcRequest;
    } catch {
      return jsonRpcError(undefined, -32_600, "Invalid JSON-RPC request");
    }
    const requestId = createRequestId();
    const principal = parseAuthHeader(context.req.header("Authorization"));

    if (request.method === "tools/list") {
      const visibleTools = principal
        ? tools
        : tools.map((tool) => ({ ...tool, description: tool.description }));
      return jsonRpcResponse(request.id, { tools: visibleTools });
    }

    if (request.method === "tools/call") {
      if (!principal) {
        return jsonRpcResponse(request.id, {
          content: [
            {
              text: JSON.stringify({
                error: { code: "UNAUTHENTICATED", message: "Authentication required" },
              }),
              type: "text",
            },
          ],
          isError: true,
        });
      }
      const params =
        typeof request.params === "object" && request.params !== null
          ? (request.params as Record<string, unknown>)
          : {};
      const toolName = String(params.name ?? "");
      const args = params.arguments ?? {};
      const result = await invokeMcpTool(
        registry,
        toolName,
        args,
        principal,
        requestId
      );
      if (!result.ok) {
        return jsonRpcResponse(request.id, {
          content: [{ text: JSON.stringify(result), type: "text" }],
          isError: true,
        });
      }
      return jsonRpcResponse(request.id, {
        content: [{ text: JSON.stringify(result.value), type: "text" }],
        structuredContent: result.value,
      });
    }

    return jsonRpcError(request.id, -32_601, `Method not found: ${request.method}`);
  };
};
