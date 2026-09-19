import { describe, expect, it } from "bun:test";

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { InvocationPrincipal } from "@ji/application/registry";
import {
  createTestSliceARegistry,
  permissionsForRole,
  TEST_DEPLOYMENT_SCOPE_ID,
} from "@ji/application/registry";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { Hono } from "hono";

import type { PrincipalResolution } from "../capabilities/auth";
import { createMarktvragenChatHandler } from "./chat";
import type { ScreenContext } from "./prompt";
import { createTurnRateLimiter } from "./rate-limit";

const principal: InvocationPrincipal = {
  kind: "user",
  permissions: permissionsForRole("recruiter"),
  subjectId: "user-1",
};

const okResolution: PrincipalResolution = { ok: true, principal };
const anonResolution: PrincipalResolution = { ok: true, principal: null };
const unavailableResolution: PrincipalResolution = {
  error: {
    code: "AUTH_SESSION_UNAVAILABLE",
    message: "Authentication service unavailable",
    requestId: "req-1",
  },
  ok: false,
};

const STREAM_CHUNKS: LanguageModelV4StreamPart[] = [
  { type: "stream-start", warnings: [] },
  { id: "t1", type: "text-start" },
  { delta: "Hoi", id: "t1", type: "text-delta" },
  { id: "t1", type: "text-end" },
  {
    finishReason: { raw: "stop", unified: "stop" },
    type: "finish",
    usage: {
      inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
      outputTokens: { reasoning: 0, text: 1, total: 1 },
    },
  },
];

const mockModel = () =>
  new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: convertArrayToReadableStream(STREAM_CHUNKS),
      }),
  });

const VALID_BODY = {
  messages: [
    {
      id: "m1",
      parts: [{ text: "Hoeveel aanvragen staan er open?", type: "text" }],
      role: "user",
    },
  ],
};

const buildApp = ({
  model,
  resolution = okResolution,
  turns = 30,
}: {
  readonly model?: () => ReturnType<typeof mockModel>;
  readonly resolution?: PrincipalResolution;
  readonly turns?: number;
} = {}) => {
  const { registry } = createTestSliceARegistry(TEST_DEPLOYMENT_SCOPE_ID);
  return new Hono().post(
    "/marktvragen/chat",
    createMarktvragenChatHandler({
      model: model ?? mockModel,
      rateLimiter: createTurnRateLimiter({ maxPerWindow: turns }),
      registry,
      resolvePrincipal: () => Promise.resolve(resolution),
    })
  );
};

interface ChatRequestBody {
  readonly messages: readonly unknown[];
  readonly screen?: ScreenContext;
}

const postChat = (app: Hono, body: ChatRequestBody = VALID_BODY) =>
  app.request("/marktvragen/chat", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

describe("marktvragen chat route", () => {
  it("returns 401 when the session resolves to no principal", async () => {
    const res = await postChat(buildApp({ resolution: anonResolution }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("returns 503 when the session lookup fails", async () => {
    const res = await postChat(buildApp({ resolution: unavailableResolution }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: { code: "AUTH_SESSION_UNAVAILABLE" },
    });
  });

  it("returns 429 once the per-user turn budget is spent", async () => {
    const app = buildApp({ turns: 1 });
    const first = await postChat(app);
    expect(first.status).toBe(200);
    const res = await postChat(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
  });

  it("returns 400 on a non-JSON body", async () => {
    const res = await buildApp().request("/marktvragen/chat", {
      body: "not-json",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages fail UIMessage validation", async () => {
    const res = await postChat(buildApp(), {
      messages: [{ parts: "not-an-array", role: "user" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "INVALID_MESSAGES" },
    });
  });

  it("returns 503 when the chat model is not configured", async () => {
    const res = await postChat(
      buildApp({
        model: () => {
          throw new Error("OPENROUTER_API_KEY is required");
        },
      })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: { code: "CHAT_NOT_CONFIGURED" },
    });
  });

  it("streams a UI message response on a valid request", async () => {
    const res = await postChat(buildApp());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toContain('"delta":"Hoi"');
  });
});

describe("createTurnRateLimiter", () => {
  it("admits up to the window budget and rejects beyond it", () => {
    let now = 1000;
    const limiter = createTurnRateLimiter({
      maxPerWindow: 2,
      now: () => now,
    });
    expect(limiter.check("u")).toBe(true);
    expect(limiter.check("u")).toBe(true);
    expect(limiter.check("u")).toBe(false);
    now += 3_600_001;
    expect(limiter.check("u")).toBe(true);
  });

  it("tracks subjects independently", () => {
    const limiter = createTurnRateLimiter({ maxPerWindow: 1 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(true);
  });
});
