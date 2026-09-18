"use server";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { headers } from "next/headers";
import { z } from "zod";

import { getServerAuthClient } from "@/lib/auth-server";

import { MARKTVRAGEN_CHAT_TASK_ID } from "./marktvragen-chat-context";
import type { MarktvragenClientData } from "./marktvragen-chat-context";

/**
 * Server actions for the Marktvragen chat transport (JI-DSH-07).
 *
 * The browser never sees TRIGGER_SECRET_KEY: both helpers run here, behind
 * the same better-auth session check every other server surface uses, plus a
 * chatId-ownership gate — a session PAT scoped to `sessions:{chatId}` is only
 * minted when the chatId's owner segment equals the signed-in user's id.
 * Without that gate any logged-in user could mint a token for someone else's
 * conversation and read or write its stream.
 */

const startSessionAction = chat.createStartSessionAction(
  MARKTVRAGEN_CHAT_TASK_ID
);

const clientDataSchema = z.object({
  screen: z
    .object({
      aanvraagId: z.string().optional(),
      bronId: z.string().optional(),
      bronNaam: z.string().optional(),
      kind: z.enum(["aanvraag", "bron", "chat", "dashboard", "search"]),
      label: z.string().max(200).optional(),
      savedSearchId: z.string().optional(),
    })
    .optional(),
});

const requireSession = async () => {
  const session = await getServerAuthClient().getSession({
    fetchOptions: { headers: await headers(), throw: true },
  });
  if (!session?.user) {
    throw new Error("Niet ingelogd");
  }
  return session;
};

// Dynamic: importing @ji/env/web eagerly validates process.env, which would
// make every client module importing these actions (provider -> widgets ->
// job detail) require web env at module load.
const requireTriggerSecret = async (): Promise<string> => {
  const { env } = await import("@ji/env/web");
  const secret = env.TRIGGER_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error(
      "Marktvragen-chat is niet geconfigureerd (TRIGGER_SECRET_KEY ontbreekt)"
    );
  }
  return secret;
};

const CHAT_ID_PATTERN =
  /^(?<owner>[^~]+)~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const assertChatOwnership = (chatId: string, userId: string): void => {
  const match = CHAT_ID_PATTERN.exec(chatId);
  if (!match || match.groups?.owner !== userId) {
    throw new Error("Geen toegang tot deze chatsessie");
  }
};

export const startMarktvragenSession = async (params: {
  readonly chatId: string;
  readonly clientData?: MarktvragenClientData;
}) => {
  const session = await requireSession();
  await requireTriggerSecret();
  assertChatOwnership(params.chatId, session.user.id);
  const clientData = clientDataSchema.safeParse(params.clientData ?? {});
  if (!clientData.success) {
    throw new Error("Ongeldige chatcontext");
  }
  return startSessionAction({
    chatId: params.chatId,
    clientData: clientData.data,
  });
};

export const mintMarktvragenAccessToken = async (
  chatId: string
): Promise<string> => {
  const session = await requireSession();
  await requireTriggerSecret();
  assertChatOwnership(chatId, session.user.id);
  return auth.createPublicToken({
    expirationTime: "1h",
    scopes: { read: { sessions: chatId }, write: { sessions: chatId } },
  });
};
