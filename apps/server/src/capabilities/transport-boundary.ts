import { z } from "zod";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export const restJsonBodySchema = z.record(z.string(), jsonValueSchema);

export type RestJsonBody = z.infer<typeof restJsonBodySchema>;

export const pathParamsSchema = z.record(z.string(), z.string());

export type PathParams = z.infer<typeof pathParamsSchema>;

export const restQuerySchema = z.object({
  full: z.boolean().optional(),
});

export type RestQuery = z.infer<typeof restQuerySchema>;

export const jsonRpcRequestSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    jsonrpc: z.string().optional(),
    method: z.string(),
    params: jsonValueSchema.optional(),
  })
  .strict();

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

export const mcpToolsCallParamsSchema = z
  .object({
    arguments: restJsonBodySchema.optional(),
    name: z.string(),
  })
  .strict();

export type McpToolsCallParams = z.infer<typeof mcpToolsCallParamsSchema>;

export const jsonRpcResultSchema = z.union([
  jsonValueSchema,
  z.object({
    content: z.array(
      z.object({
        text: z.string(),
        type: z.literal("text"),
      })
    ),
    isError: z.boolean().optional(),
    structuredContent: jsonValueSchema.optional(),
    tools: z
      .array(
        z.object({
          description: z.string(),
          name: z.string(),
          readOnly: z.boolean(),
        })
      )
      .optional(),
  }),
]);

export type JsonRpcResult = z.infer<typeof jsonRpcResultSchema>;
