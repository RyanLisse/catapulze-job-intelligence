import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { resolveInternalServerUrl } from "./internal-server-url";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_SERVER_URL: z.url(),
  },
  emptyStringAsUndefined: true,
  runtimeEnv: {
    INTERNAL_SERVER_URL: process.env.INTERNAL_SERVER_URL,
    NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
  },
  server: {
    // Server-only: the API address as seen from inside the web container
    // (http://server:3000 in Compose). Optional so plain local dev, where the
    // browser and the Next.js server share one URL, keeps working unchanged.
    // http(s) only: "server:3000" is a *valid* WHATWG URL (scheme "server"),
    // so a bare z.url() would accept the classic forgotten-scheme typo.
    INTERNAL_SERVER_URL: z.url({ protocol: /^https?$/u }).optional(),
  },
});

/**
 * Base URL for every fetch the Next.js *server* makes to the API (dashboard
 * SSR session lookup, route handlers). Falls back to NEXT_PUBLIC_SERVER_URL
 * when INTERNAL_SERVER_URL is unset. Server-only: t3-env throws if this is
 * evaluated in the browser, which is the intended guard against leaking an
 * internal hostname into client code.
 */
export const getInternalServerUrl = (): string => resolveInternalServerUrl(env);
