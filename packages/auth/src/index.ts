import { db } from "@ji/db";
import * as schema from "@ji/db/schema/auth";
import { env } from "@ji/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";

import {
  AUTH_BEARER_OPTIONS,
  AUTH_EMAIL_PASSWORD_OPTIONS,
  AUTH_USER_ROLE_FIELD,
} from "./security-config";

export {
  AUTH_BEARER_OPTIONS,
  AUTH_EMAIL_PASSWORD_OPTIONS,
  AUTH_USER_ROLES,
  AUTH_USER_ROLE_FIELD,
  DEFAULT_AUTH_USER_ROLE,
  type AuthUserRole,
} from "./security-config";

export const createAuth = () => {
  const isProduction = env.NODE_ENV === "production";

  return betterAuth({
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax",
        secure: isProduction,
      },
    },
    appName: "Catapulze Job Intelligence",
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: AUTH_EMAIL_PASSWORD_OPTIONS,
    plugins: [bearer(AUTH_BEARER_OPTIONS)],
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.CORS_ORIGIN],
    user: {
      additionalFields: {
        role: AUTH_USER_ROLE_FIELD,
      },
    },
  });
};

export const auth = createAuth();
