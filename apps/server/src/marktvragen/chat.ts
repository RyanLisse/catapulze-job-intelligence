import { convertToModelMessages, stepCountIs, streamText } from "ai";
import type { LanguageModel, UIMessage } from "ai";
import type { Context } from "hono";
import { z } from "zod";

import type { PrincipalResolver } from "../capabilities/auth";
import { screenContextSchema, buildSystemPrompt } from "./prompt";
import type { TurnRateLimiter } from "./rate-limit";
import type { MarktvragenRegistry } from "./tools";
import { createMarktvragenTools } from "./tools";

/**
 * On-box Marktvragen chat (JI-DSH-07) — the agent-native replacement for the
 * Trigger.dev `chat.agent` task. Each turn is a plain streamText call inside
 * this process: no cloud runs, no per-turn cost, tools execute through the
 * same Slice A registry invokers every other surface uses.
 *
 * Authorization is unchanged: the better-auth session resolves to an
 * InvocationPrincipal (role lookup per request) and every tool call goes
 * through capability-level authorization. The optional `screen` body field is
 * framing context only, never authority.
 */
const requestSchema = z.object({
  messages: z.array(z.unknown()).min(1),
  screen: screenContextSchema.optional(),
});

export interface MarktvragenChatDeps {
  readonly model: () => LanguageModel;
  readonly rateLimiter: TurnRateLimiter;
  readonly registry: MarktvragenRegistry;
  readonly resolvePrincipal: PrincipalResolver;
}

const jsonError = (
  c: Context,
  status: 400 | 401 | 429 | 503,
  code: string,
  message: string
) => c.json({ error: { code, message } }, status);

export const createMarktvragenChatHandler =
  (deps: MarktvragenChatDeps) =>
  async (c: Context): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const resolved = await deps.resolvePrincipal(c.req.raw.headers, requestId);
    if (!resolved.ok) {
      return jsonError(
        c,
        503,
        resolved.error.code,
        "De authenticatiedienst is niet bereikbaar"
      );
    }
    if (!resolved.principal) {
      return jsonError(c, 401, "UNAUTHENTICATED", "Niet ingelogd");
    }
    if (!deps.rateLimiter.check(resolved.principal.subjectId)) {
      return jsonError(
        c,
        429,
        "RATE_LIMITED",
        "Te veel vragen in korte tijd — probeer het later opnieuw"
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, 400, "INVALID_BODY", "Request body is geen JSON");
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_BODY", "Request body voldoet niet");
    }

    let modelMessages;
    try {
      // SAFETY: the zod check above proves `messages` is a non-empty array;
      // convertToModelMessages validates each element's UIMessage structure
      // and throws on anything else, which the catch turns into a 400.
      modelMessages = await convertToModelMessages(
        parsed.data.messages as UIMessage[]
      );
    } catch {
      return jsonError(c, 400, "INVALID_MESSAGES", "Ongeldige berichten");
    }

    let model: LanguageModel;
    try {
      model = deps.model();
    } catch {
      return jsonError(
        c,
        503,
        "CHAT_NOT_CONFIGURED",
        "Marktvragen-chat is niet geconfigureerd"
      );
    }

    const result = streamText({
      abortSignal: c.req.raw.signal,
      messages: modelMessages,
      model,
      stopWhen: stepCountIs(10),
      system: buildSystemPrompt(parsed.data.screen),
      tools: createMarktvragenTools(deps.registry, {
        principal: resolved.principal,
        requestIdPrefix: `chat:${requestId}`,
      }),
    });

    // Never forward raw errors — they can carry internals (SQLSTATE details,
    // connection strings). The agent already sees capability failures as
    // structured tool output.
    return result.toUIMessageStreamResponse({
      onError: () =>
        "Er ging iets mis bij het verwerken van je vraag. Probeer het opnieuw.",
    });
  };
