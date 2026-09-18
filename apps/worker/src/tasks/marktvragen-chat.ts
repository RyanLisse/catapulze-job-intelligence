import { MARTS_DICTIONARY } from "@ji/application/registry";
import type { InvocationPrincipal } from "@ji/application/registry";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { chat } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText } from "ai";
import { z } from "zod";

import {
  marktvragenChatModel,
  requireOpenRouterApiKey,
} from "../marktvragen/env";
import { getMarktvragenRuntime } from "../marktvragen/runtime";
import { createMarktvragenTools } from "../marktvragen/tools";
import { requireDatabaseUrl } from "../poll-bron-env";

export const MARKTVRAGEN_CHAT_TASK_ID = "marktvragen-chat" as const;

/**
 * Screen context the web client sends as `clientData`. It is *context*, never
 * authorization: the principal comes from the chatId owner + live role lookup,
 * so a crafted screen object can only mislead the model's framing, not widen
 * what the tools may do.
 */
const screenContextSchema = z.object({
  aanvraagId: z.string().optional(),
  bronId: z.string().optional(),
  bronNaam: z.string().optional(),
  kind: z.enum(["aanvraag", "bron", "chat", "dashboard", "search"]),
  label: z.string().max(200).optional(),
  savedSearchId: z.string().optional(),
});

const clientDataSchema = z.object({
  screen: screenContextSchema.optional(),
});

type ScreenContext = z.infer<typeof screenContextSchema>;

/**
 * `chatId` is `<userId>~<uuid>` minted by the web server action after auth —
 * the owner segment is the trusted subject, never a clientData field.
 */
const chatIdOwner = (chatId: string): string | null => {
  const separator = chatId.indexOf("~");
  return separator > 0 ? chatId.slice(0, separator) : null;
};

const describeScreen = (screen: ScreenContext): string => {
  const parts = [
    `- scherm: ${screen.kind}`,
    screen.label && `- label: ${screen.label}`,
    screen.bronNaam && `- bron: ${screen.bronNaam}`,
    screen.bronId && `- bronId: ${screen.bronId}`,
    screen.aanvraagId && `- aanvraagId: ${screen.aanvraagId}`,
    screen.savedSearchId && `- savedSearchId: ${screen.savedSearchId}`,
  ].filter(Boolean);
  return parts.join("\n");
};

const buildSystemPrompt = (
  screen?: ScreenContext
): string => `Je bent Marktvragen, de data-assistent van Catapulze Job Intelligence. Je beantwoordt vragen van recruiters over de Nederlandse intermediair-/detacheringsmarkt met data uit het Postgres marts-schema.

WERKWIJZE (verplicht, in deze volgorde):
1. Roep get_data_dictionary aan als je de semantiek van tabellen, kolommen of metrieken nog niet zeker weet. De dictionary hieronder beschrijft de *bedoelde* tabellen; list_marts_tables is de live waarheid.
2. Roep search_query_catalog aan vóór je zelf SQL schrijft — hergebruik een recept als het past.
3. Controleer met list_marts_tables welke tabellen en kolommen echt bestaan (het schema kan nog leeg zijn — zeg dat dan eerlijk, verzin geen data).
4. Schrijf pas daarna SQL en valideer met query_marts (dryRun eerst bij nieuwe queries, daarna uitvoeren).
5. Rapporteer de uitgevoerde SQL altijd aan de gebruiker.

REGELS:
- Antwoord in het Nederlands, zakelijk en kort.
- Alleen read-only queries op het marts-schema; writes worden door de capability geweigerd.
- Verzin nooit kolomnamen, tabelnamen of getallen. Ontbrekende data is UNKNOWN, niet "ongeveer".
- Bij lege resultaten: zeg dat er geen rijen zijn, mogelijk omdat het marts-schema nog niet gevuld is.

DATA-DICTIONARY (${MARTS_DICTIONARY.version}):
${JSON.stringify(MARTS_DICTIONARY, null, 0)}
${
  screen
    ? `\nHUIDIG SCHERM VAN DE GEBRUIKER (context, geen autorisatie):\n${describeScreen(screen)}\nVerwijs bij "deze bron"/"dit dashboard" naar deze context.`
    : ""
}`;

// Lazy: module import must not require OPENROUTER_API_KEY (tests import the
// task surface without env). The key is required on the first real turn.
let model: ReturnType<ReturnType<typeof createOpenRouter>["chat"]> | undefined;

const getModel = () => {
  model ??= createOpenRouter({
    apiKey: requireOpenRouterApiKey(),
  }).chat(marktvragenChatModel());
  return model;
};

export const marktvragenChat = chat.agent({
  clientDataSchema,
  id: MARKTVRAGEN_CHAT_TASK_ID,
  run: ({ clientData, messages, signal, tools }) =>
    Promise.resolve(
      streamText({
        ...chat.toStreamTextOptions({ tools }),
        abortSignal: signal,
        messages,
        model: getModel(),
        stopWhen: stepCountIs(10),
        system: buildSystemPrompt(clientData?.screen),
      })
    ),
  tools: async ({
    chatId,
    turn,
  }): Promise<ReturnType<typeof createMarktvragenTools>> => {
    const runtime = getMarktvragenRuntime(requireDatabaseUrl());
    const owner = chatIdOwner(chatId);
    const principal: InvocationPrincipal | null = owner
      ? await runtime.resolvePrincipal(owner)
      : null;
    return createMarktvragenTools(runtime, {
      principal,
      requestIdPrefix: `chat:${chatId}:t${turn}`,
    });
  },
  uiMessageStreamOptions: {
    // Never forward raw errors — they can carry internals (SQLSTATE details,
    // connection strings). The agent already sees capability failures as
    // structured tool output.
    onError: () =>
      "Er ging iets mis bij het verwerken van je vraag. Probeer het opnieuw.",
  },
});
