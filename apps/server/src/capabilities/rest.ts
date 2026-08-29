import type {
  CapabilityRegistry,
  InvocationPrincipal,
  InvocationResult,
} from "@ji/application/registry";
import type { Context } from "hono";

import { createRequestId, parseAuthHeader } from "./auth";

type AnyRegistry = CapabilityRegistry<readonly { readonly id: string }[]>;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const invocationErrorStatus = (code: string): number => {
  switch (code) {
    case "UNAUTHENTICATED": {
      return 401;
    }
    case "FORBIDDEN":
    case "TRANSPORT_NOT_BOUND": {
      return 403;
    }
    case "INVALID_INPUT":
    case "INVALID_CONTEXT": {
      return 400;
    }
    case "NOT_FOUND": {
      return 404;
    }
    default: {
      return 500;
    }
  }
};

const domainErrorStatus = (code: string): number => {
  switch (code) {
    case "NOT_FOUND": {
      return 404;
    }
    case "FORBIDDEN_FULL": {
      return 403;
    }
    case "SYNTAX_ERROR":
    case "VALIDATION_ERROR":
    case "ALREADY_ACKED": {
      return 400;
    }
    default: {
      return 500;
    }
  }
};

export interface RestRouteSpec {
  readonly capabilityId: string;
  readonly method: string;
  readonly operation: string;
  readonly pathPattern: string;
}

const pathParamNames = (pattern: string): readonly string[] => {
  const names: string[] = [];
  for (const segment of pattern.split("/")) {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      names.push(segment.slice(1, -1));
    }
  }
  return names;
};

const matchPath = (
  pattern: string,
  pathname: string
): Record<string, string> | null => {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (!patternPart || !pathPart) {
      return null;
    }
    if (patternPart.startsWith("{") && patternPart.endsWith("}")) {
      params[patternPart.slice(1, -1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
};

export const restRoutesFromRegistry = (registry: AnyRegistry): RestRouteSpec[] =>
  registry.catalog.flatMap((descriptor) =>
    descriptor.bindings
      .filter((binding) => binding.transport === "rest")
      .map((binding) => {
        const [method = "GET", ...pathParts] = binding.operation.split(" ");
        return {
          capabilityId: descriptor.id,
          method,
          operation: binding.operation,
          pathPattern: pathParts.join(" "),
        };
      })
  );

const normalizeRestInput = (
  capabilityId: string,
  raw: Record<string, unknown>
): Record<string, unknown> => {
  switch (capabilityId) {
    case "list_versies": {
      return { aanvraagId: raw.id ?? raw.aanvraagId };
    }
    case "markeer_aanvraag": {
      return {
        aanvraagId: raw.id ?? raw.aanvraagId,
        reden: raw.reden,
        status: raw.status,
      };
    }
    case "get_bron":
    case "get_bron_health":
    case "start_run":
    case "start_test_import": {
      return { bronId: raw.id ?? raw.bronId };
    }
    case "ack_alert": {
      return { alertId: raw.id ?? raw.alertId };
    }
    case "read_raw": {
      return { full: raw.full, ref: raw.ref ?? raw.id };
    }
    default: {
      return raw;
    }
  }
};

const invokeRest = async (
  registry: AnyRegistry,
  route: RestRouteSpec,
  input: unknown,
  principal: InvocationPrincipal | null,
  requestId: string
): Promise<InvocationResult<unknown, { readonly code: string }>> =>
  registry.createInvoker({
    capabilityId: route.capabilityId,
    operation: route.operation,
    transport: "rest",
  })(input, { principal, requestId });

export const createRestCapabilityHandler =
  (registry: AnyRegistry, routes: readonly RestRouteSpec[]) =>
  async (context: Context): Promise<Response> => {
    const requestId = createRequestId();
    const principal = parseAuthHeader(context.req.header("Authorization"));
    const pathname = context.req.path.replace(/^\/v1/u, "/v1");
    const matched = routes.find(
      (route) =>
        route.method === context.req.method &&
        matchPath(route.pathPattern, pathname) !== null
    );
    if (!matched) {
      return jsonResponse(404, { error: "Route not found" });
    }
    const params = matchPath(matched.pathPattern, pathname) ?? {};
    let body: Record<string, unknown> = {};
    if (context.req.method === "POST" || context.req.method === "PUT") {
      try {
        body = (await context.req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const query: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      Object.fromEntries(new URL(context.req.url).searchParams.entries())
    )) {
      if (key === "full" && value === "true") {
        query.full = true;
      } else {
        query[key] = value;
      }
    }
    const input = normalizeRestInput(matched.capabilityId, {
      ...body,
      ...params,
      ...query,
    });
    const result = await invokeRest(
      registry,
      matched,
      input,
      principal,
      requestId
    );
    if (!result.ok) {
      const code = "requestId" in result.error ? result.error.code : result.error.code;
      const status =
        "requestId" in result.error
          ? invocationErrorStatus(code)
          : domainErrorStatus(code);
      return jsonResponse(status, result);
    }
    return jsonResponse(200, result.value);
  };

export const invokeMcpTool = async (
  registry: AnyRegistry,
  toolName: string,
  args: unknown,
  principal: InvocationPrincipal | null,
  requestId: string
): Promise<InvocationResult<unknown, { readonly code: string }>> =>
  registry.createInvoker({
    capabilityId: toolName,
    operation: toolName,
    transport: "mcp",
  })(args, { principal, requestId });

export const mcpToolsFromRegistry = (registry: AnyRegistry) =>
  registry.catalog.flatMap((descriptor) =>
    descriptor.bindings
      .filter((binding) => binding.transport === "mcp")
      .map((binding) => ({
        description: descriptor.outcome,
        name: binding.operation,
        readOnly: descriptor.effect === "read",
      }))
  );

export { matchPath, pathParamNames };
