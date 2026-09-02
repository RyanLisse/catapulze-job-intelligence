import { z } from "zod";

const capabilityFailureSchema = z.object({
  error: z.object({
    code: z.string(),
    details: z.unknown().optional(),
    message: z.string(),
  }),
});

export type CapabilityFailureBody = z.output<typeof capabilityFailureSchema>;

export class CapabilityRequestError extends Error {
  readonly body: CapabilityFailureBody;
  readonly status: number;

  constructor(status: number, body: CapabilityFailureBody) {
    super(body.error.message);
    this.name = "CapabilityRequestError";
    this.status = status;
    this.body = body;
  }
}

export interface CapabilityClientOptions {
  readonly baseUrl: string;
}

export interface CapabilityJsonObject {
  readonly [key: string]: CapabilityJsonValue | undefined;
}

export type CapabilityJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | CapabilityJsonObject;

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const raw: unknown = await response.json();
  if (!response.ok) {
    const parsedFailure = capabilityFailureSchema.safeParse(raw);
    const body = parsedFailure.success
      ? parsedFailure.data
      : {
          error: {
            code: "INTERNAL_ERROR",
            message: "Onverwacht antwoord van de capability-API.",
          },
        };
    throw new CapabilityRequestError(response.status, body);
  }
  // SAFETY: Callers pass the expected REST envelope type for each capability route.
  return raw as T;
};

export const createCapabilityClient = (options: CapabilityClientOptions) => {
  const baseUrl = options.baseUrl.replace(/\/$/u, "");

  return {
    get: async <T>(path: string): Promise<T> => {
      const response = await fetch(`${baseUrl}${path}`, {
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
        method: "GET",
      });
      return parseJsonResponse<T>(response);
    },

    post: async <T>(path: string, body: CapabilityJsonObject): Promise<T> => {
      const response = await fetch(`${baseUrl}${path}`, {
        body: JSON.stringify(body),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      return parseJsonResponse<T>(response);
    },
  };
};

export type CapabilityClient = ReturnType<typeof createCapabilityClient>;
