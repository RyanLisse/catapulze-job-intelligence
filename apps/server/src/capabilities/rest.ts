import type { InvocationPrincipal } from "@ji/application/registry";
import type { Context } from "hono";
import { z } from "zod";

import { createRequestId, parseAuthHeader } from "./auth";
import type {
  RegistryInvocationResult,
  SliceARegistry,
} from "./registry-types";
import {
  jsonValueSchema,
  pathParamsSchema,
  restJsonBodySchema,
  restQuerySchema,
} from "./transport-boundary";
import type {
  JsonValue,
  PathParams,
  RestJsonBody,
  RestQuery,
} from "./transport-boundary";

/* oxlint-disable unicorn/prefer-structured-clone -- JSON round-trip strips undefined keys before JsonValue validation. */
const serializeRegistryJson = (
  value: RegistryInvocationResult | JsonValue
): JsonValue => jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
/* oxlint-enable unicorn/prefer-structured-clone */

const jsonResponse = (status: number, body: JsonValue): Response =>
  Response.json(body, { status });

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
    case "ALREADY_ACKED":
    case "ALREADY_APPROVED":
    case "APPROVAL_EXPIRED":
    case "APPROVAL_MISMATCH":
    case "APPROVAL_NOT_FOUND": {
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

const matchPath = (pattern: string, pathname: string): PathParams | null => {
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
  const parsed = pathParamsSchema.safeParse(params);
  return parsed.success ? parsed.data : null;
};

export const restRoutesFromRegistry = (
  registry: SliceARegistry
): RestRouteSpec[] =>
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

const stringFieldSchema = z.string();
const booleanFieldSchema = z.boolean();

const readString = (body: RestJsonBody, key: string): string | undefined => {
  const parsed = stringFieldSchema.safeParse(body[key]);
  return parsed.success ? parsed.data : undefined;
};

const readBoolean = (body: RestJsonBody, key: string): boolean | undefined => {
  const parsed = booleanFieldSchema.safeParse(body[key]);
  return parsed.success ? parsed.data : undefined;
};

const toRestJsonBody = (
  entries: readonly (readonly [string, JsonValue | undefined])[]
): RestJsonBody => {
  const body: RestJsonBody = {};
  for (const [key, value] of entries) {
    if (value !== undefined) {
      body[key] = value;
    }
  }
  return body;
};

const readSnapshotId = (raw: RestJsonBody): string | undefined =>
  readString(raw, "id") ?? readString(raw, "snapshotId");

const normalizeRestInput = (
  capabilityId: string,
  raw: RestJsonBody
): RestJsonBody => {
  switch (capabilityId) {
    case "list_versies": {
      return toRestJsonBody([
        ["aanvraagId", readString(raw, "id") ?? readString(raw, "aanvraagId")],
      ]);
    }
    case "markeer_aanvraag": {
      return toRestJsonBody([
        ["aanvraagId", readString(raw, "id") ?? readString(raw, "aanvraagId")],
        ["reden", raw.reden ?? null],
        ["status", raw.status],
      ]);
    }
    case "get_bron":
    case "get_bron_health":
    case "start_run":
    case "start_test_import": {
      return toRestJsonBody([
        ["bronId", readString(raw, "id") ?? readString(raw, "bronId")],
      ]);
    }
    case "ack_alert": {
      return toRestJsonBody([
        ["alertId", readString(raw, "id") ?? readString(raw, "alertId")],
      ]);
    }
    case "approve_snapshot":
    case "get_snapshot_approval":
    case "validate_snapshot_approval": {
      return toRestJsonBody([
        ["id", readSnapshotId(raw)],
        ["expiresAt", readString(raw, "expiresAt")],
        ["motivatie", readString(raw, "motivatie")],
      ]);
    }
    case "commit_export": {
      return toRestJsonBody([["snapshotId", readSnapshotId(raw)]]);
    }
    case "read_raw": {
      return toRestJsonBody([
        ["full", readBoolean(raw, "full")],
        ["ref", readString(raw, "ref") ?? readString(raw, "id")],
      ]);
    }
    default: {
      return raw;
    }
  }
};

const parseRestQuery = (url: string): RestQuery => {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  if (params.full !== "true") {
    return {};
  }
  const parsed = restQuerySchema.safeParse({ full: true });
  return parsed.success ? parsed.data : {};
};

const invokeRest = (
  registry: SliceARegistry,
  route: RestRouteSpec,
  input: RestJsonBody,
  principal: InvocationPrincipal | null,
  requestId: string
): Promise<RegistryInvocationResult> =>
  registry.createInvoker({
    capabilityId: route.capabilityId,
    operation: route.operation,
    transport: "rest",
  })(input, { principal, requestId });

export const createRestCapabilityHandler =
  (registry: SliceARegistry, routes: readonly RestRouteSpec[]) =>
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
    let body: RestJsonBody = {};
    if (context.req.method === "POST" || context.req.method === "PUT") {
      try {
        const rawBody = await context.req.json();
        const parsedBody = restJsonBodySchema.safeParse(rawBody);
        body = parsedBody.success ? parsedBody.data : {};
      } catch {
        body = {};
      }
    }
    const query = parseRestQuery(context.req.url);
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
      const code =
        "requestId" in result.error ? result.error.code : result.error.code;
      const status =
        "requestId" in result.error
          ? invocationErrorStatus(code)
          : domainErrorStatus(code);
      return jsonResponse(status, serializeRegistryJson(result));
    }
    // SAFETY: The registry validated this value against the capability output schema.
    return jsonResponse(200, serializeRegistryJson(result.value as JsonValue));
  };

export const invokeMcpTool = (
  registry: SliceARegistry,
  toolName: string,
  args: RestJsonBody,
  principal: InvocationPrincipal | null,
  requestId: string
): Promise<RegistryInvocationResult> =>
  registry.createInvoker({
    capabilityId: toolName,
    operation: toolName,
    transport: "mcp",
  })(args, { principal, requestId });

export const mcpToolsFromRegistry = (registry: SliceARegistry) =>
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
