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
 */

const emptyInput = z.object({});

const toToolOutput = <T>(result: {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string };
}):
  | T
  | { readonly error: { readonly code: string; readonly message: string } } =>
  result.ok && result.value !== undefined
    ? result.value
    : {
        error: result.error ?? {
          code: "INTERNAL_ERROR",
          message: "De capability kon niet worden uitgevoerd",
        },
      };

export type MarktvragenRegistry = CapabilityRegistry<
  SliceACapabilityCatalog[number]["capability"][]
>;

export interface MarktvragenToolContext {
  readonly principal: InvocationPrincipal | null;
  readonly requestIdPrefix: string;
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
  const trusted = (toolCallId: string) => ({
    principal: context.principal,
    requestId: `${context.requestIdPrefix}:${toolCallId}`,
  });

  const getDataDictionary = invoker("get_data_dictionary");
  const listMartsTables = invoker("list_marts_tables");
  const searchQueryCatalog = invoker("search_query_catalog");
  const queryMarts = invoker("query_marts");

  return {
    get_data_dictionary: tool({
      description:
        "Lees de statische data-dictionary van het marts-schema: tabelbeschrijvingen, kolomsemantiek, metriekdefinities en SQL-recepten. Roep dit vóór het schrijven van SQL aan; list_marts_tables is de live waarheid over welke tabellen bestaan.",
      execute: async (_input, { toolCallId }) =>
        toToolOutput(await getDataDictionary({}, trusted(toolCallId))),
      inputSchema: emptyInput,
    }),
    list_marts_tables: tool({
      description:
        "Introspecteer het live marts-schema: welke tabellen en kolommen echt bestaan. Gebruik dit om kolomnamen uit de data-dictionary te verifiëren vóór een query.",
      execute: async (_input, { toolCallId }) =>
        toToolOutput(await listMartsTables({}, trusted(toolCallId))),
      inputSchema: emptyInput,
    }),
    query_marts: tool({
      description:
        "Voer een read-only SELECT uit op het marts-schema (Postgres). Alleen SELECT/WITH/VALUES/TABLE; geen writes, geen schema-kwalificatie buiten marts, 10s timeout, max 10.000 rijen. Zet dryRun=true om eerst het EXPLAIN-plan te valideren; zonder dryRun wordt dezelfde gevalideerde query uitgevoerd. De SQL staat altijd in de output.",
      execute: async (input, { toolCallId }) =>
        toToolOutput(await queryMarts(input, trusted(toolCallId))),
      inputSchema: z.object({
        dryRun: z.boolean().optional(),
        sql: z.string().min(1).max(20_000),
      }),
    }),
    search_query_catalog: tool({
      description:
        "Doorzoek opgeslagen query-recepten op onderwerp. Roep dit altijd eerst aan vóór je zelf SQL schrijft — een bestaand recept hergebruiken voorkomt gegokte kolomnamen.",
      execute: async (input, { toolCallId }) =>
        toToolOutput(await searchQueryCatalog(input, trusted(toolCallId))),
      inputSchema: z.object({
        limit: z.number().int().positive().max(20).optional(),
        query: z.string().min(1),
      }),
    }),
  };
};

export type MarktvragenTools = ToolSet;
