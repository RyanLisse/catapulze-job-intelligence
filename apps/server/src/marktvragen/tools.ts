import type {
  CapabilityRegistry,
  InvocationPrincipal,
  SliceACapabilityCatalog,
} from "@ji/application/registry";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

/**
 * AI SDK toolset over the Slice A capability registry. Each tool execute goes
 * through `createInvoker` with `transport: "mcp"` — the same contract an
 * external MCP agent gets — so schema validation and per-call authorization
 * are identical to every other surface. A capability failure is returned as
 * structured output, not thrown: `error.message` is the feedback signal the
 * model rewrites its SQL against.
 *
 * CTP-628: the principal is re-resolved on every tool call, never cached for
 * the turn. A session revoked mid-turn makes the next tool call fail closed
 * with UNAUTHENTICATED and ends the turn through `onRevoked`.
 */

const emptyInput = z.object({});

interface ToolError {
  readonly error: { readonly code: string; readonly message: string };
}

const toToolOutput = <T>(result: {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string };
}): T | ToolError =>
  result.ok && result.value !== undefined
    ? result.value
    : {
        error: result.error ?? {
          code: "INTERNAL_ERROR",
          message: "De capability kon niet worden uitgevoerd",
        },
      };

const UNAUTHENTICATED: ToolError = {
  error: {
    code: "UNAUTHENTICATED",
    message: "De sessie is niet meer geldig; de actie is niet uitgevoerd",
  },
};

const TURN_ENDED: ToolError = {
  error: {
    code: "TURN_ENDED",
    message: "De chatbeurt is beëindigd voordat deze actie kon starten",
  },
};

export type MarktvragenRegistry = CapabilityRegistry<
  SliceACapabilityCatalog[number]["capability"][]
>;

export interface MarktvragenToolContext {
  readonly requestIdPrefix: string;
  /** Re-resolves the caller for this one tool call; null when revoked or anonymous. */
  readonly resolvePrincipal: () => Promise<InvocationPrincipal | null>;
  /** Scope-owned turn signal; an aborted signal refuses new tool actions. */
  readonly signal: AbortSignal;
  /** Called once a tool call finds the session gone, so the turn can end. */
  readonly onRevoked: () => void;
}

export const createMarktvragenTools = (
  registry: MarktvragenRegistry,
  context: MarktvragenToolContext
): ToolSet => {
  const invoker = (capabilityId: string) =>
    registry.createInvoker({
      capabilityId,
      operation: capabilityId,
      transport: "mcp",
    });

  const guarded =
    <Input>(
      invoke: (
        input: Input,
        trusted: {
          readonly principal: InvocationPrincipal;
          readonly requestId: string;
        }
      ) => Promise<{
        readonly ok: boolean;
        readonly value?: unknown;
        readonly error?: { readonly code: string; readonly message: string };
      }>
    ) =>
    async (input: Input, { toolCallId }: { toolCallId: string }) => {
      if (context.signal.aborted) {
        return TURN_ENDED;
      }
      const principal = await context.resolvePrincipal();
      if (!principal) {
        context.onRevoked();
        return UNAUTHENTICATED;
      }
      return toToolOutput(
        await invoke(input, {
          principal,
          requestId: `${context.requestIdPrefix}:${toolCallId}`,
        })
      );
    };

  const getDataDictionary = guarded(invoker("get_data_dictionary"));
  const listMartsTables = guarded(invoker("list_marts_tables"));
  const searchQueryCatalog = guarded(invoker("search_query_catalog"));
  const queryMarts = guarded(invoker("query_marts"));

  return {
    get_data_dictionary: tool({
      description:
        "Lees de statische data-dictionary van het marts-schema: tabelbeschrijvingen, kolomsemantiek, metriekdefinities en SQL-recepten. Roep dit vóór het schrijven van SQL aan; list_marts_tables is de live waarheid over welke tabellen bestaan.",
      execute: getDataDictionary,
      inputSchema: emptyInput,
    }),
    list_marts_tables: tool({
      description:
        "Introspecteer het live marts-schema: welke tabellen en kolommen echt bestaan. Gebruik dit om kolomnamen uit de data-dictionary te verifiëren vóór een query.",
      execute: listMartsTables,
      inputSchema: emptyInput,
    }),
    query_marts: tool({
      description:
        "Voer een read-only SELECT uit op het marts-schema (Postgres). Alleen SELECT/WITH/VALUES/TABLE; geen writes, geen schema-kwalificatie buiten marts, 10s timeout, max 10.000 rijen. Zet dryRun=true om eerst het EXPLAIN-plan te valideren; zonder dryRun wordt dezelfde gevalideerde query uitgevoerd. De SQL staat altijd in de output.",
      execute: queryMarts,
      inputSchema: z.object({
        dryRun: z.boolean().optional(),
        sql: z.string().min(1).max(20_000),
      }),
    }),
    search_query_catalog: tool({
      description:
        "Doorzoek opgeslagen query-recepten op onderwerp. Roep dit altijd eerst aan vóór je zelf SQL schrijft — een bestaand recept hergebruiken voorkomt gegokte kolomnamen.",
      execute: searchQueryCatalog,
      inputSchema: z.object({
        limit: z.number().int().positive().max(20).optional(),
        query: z.string().min(1),
      }),
    }),
  };
};

export type MarktvragenTools = ToolSet;
