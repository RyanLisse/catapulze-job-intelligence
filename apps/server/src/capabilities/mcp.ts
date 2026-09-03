import type { Context } from "hono";

import { createRequestId, hasAllowedCookieOrigin } from "./auth";
import type { CookieAuthOriginPolicy, PrincipalResolver } from "./auth";
import type { SliceARegistry } from "./registry-types";
import { invokeMcpTool, mcpToolsFromRegistry } from "./rest";
import {
  jsonRpcRequestSchema,
  mcpToolsCallParamsSchema,
} from "./transport-boundary";
import type { JsonRpcRequest, JsonRpcResult } from "./transport-boundary";

const jsonRpcResponse = (
  id: JsonRpcRequest["id"],
  result: JsonRpcResult
): Response => Response.json({ id, jsonrpc: "2.0", result });

const jsonRpcError = (
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status = 200
): Response =>
  Response.json({ error: { code, message }, id, jsonrpc: "2.0" }, { status });

export const createMcpHandler = (
  registry: SliceARegistry,
  resolvePrincipal: PrincipalResolver,
  security: CookieAuthOriginPolicy
) => {
  const tools = mcpToolsFromRegistry(registry);
  return async (context: Context): Promise<Response> => {
    const requestId = createRequestId();
    const requestHeaders = context.req.raw.headers;
    if (
      !hasAllowedCookieOrigin(
        "POST",
        requestHeaders,
        security.allowedCookieOrigin
      )
    ) {
      return jsonRpcError(
        undefined,
        -32_003,
        "Cookie-authenticated requests require the allowed Origin",
        403
      );
    }
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return jsonRpcError(undefined, -32_600, "Invalid JSON-RPC request");
    }
    const parsedRequest = jsonRpcRequestSchema.safeParse(rawBody);
    if (!parsedRequest.success) {
      return jsonRpcError(undefined, -32_600, "Invalid JSON-RPC request");
    }
    const request = parsedRequest.data;
    const principalResolution = await resolvePrincipal(
      requestHeaders,
      requestId
    );
    if (!principalResolution.ok) {
      return jsonRpcError(
        request.id,
        -32_603,
        principalResolution.error.message,
        503
      );
    }
    const { principal } = principalResolution;

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
                error: {
                  code: "UNAUTHENTICATED",
                  message: "Authentication required",
                },
              }),
              type: "text",
            },
          ],
          isError: true,
        });
      }
      const parsedParams = mcpToolsCallParamsSchema.safeParse(request.params);
      const toolName = parsedParams.success ? parsedParams.data.name : "";
      const args = parsedParams.success
        ? (parsedParams.data.arguments ?? {})
        : {};
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
        // SAFETY: Capability outputs are JSON-serializable values validated by the registry.
        structuredContent: result.value as JsonRpcResult,
      });
    }

    return jsonRpcError(
      request.id,
      -32_601,
      `Method not found: ${request.method}`
    );
  };
};
