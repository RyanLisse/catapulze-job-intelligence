import {
  permissionsForRole,
  ROLE_ADMIN,
  ROLE_APPROVER,
  ROLE_OPERATOR,
  ROLE_RECRUITER,
} from "@ji/application/registry";
import type { InvocationPrincipal, SliceARole } from "@ji/application/registry";

interface AuthenticatedSession {
  readonly session: {
    readonly expiresAt: Date | string;
  };
  readonly user: {
    readonly id: string;
    readonly role?: string | null;
  };
}

export type SessionLookup = (
  headers: Headers
) => Promise<AuthenticatedSession | null>;

export type PrincipalResolver = (
  headers: Headers
) => Promise<InvocationPrincipal | null>;

const isSliceARole = (value: string | null | undefined): value is SliceARole =>
  value === ROLE_RECRUITER ||
  value === ROLE_OPERATOR ||
  value === ROLE_ADMIN ||
  value === ROLE_APPROVER;

const resolveExpiry = (expiresAt: Date | string): number =>
  expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);

const principalFromSession = (
  session: AuthenticatedSession | null,
  kind: InvocationPrincipal["kind"],
  now: Date
): InvocationPrincipal | null => {
  if (!session) {
    return null;
  }
  const subjectId = session.user.id.trim();
  const expiresAt = resolveExpiry(session.session.expiresAt);
  if (
    !subjectId ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now.getTime() ||
    !isSliceARole(session.user.role)
  ) {
    return null;
  }

  return Object.freeze({
    kind,
    permissions: permissionsForRole(session.user.role),
    subjectId,
  });
};

/**
 * Resolve a principal only after Better Auth has validated the cookie or
 * signed bearer session. Caller-provided roles and subjects are never parsed.
 */
export const createSessionPrincipalResolver =
  (
    lookupSession: SessionLookup,
    now: () => Date = () => new Date()
  ): PrincipalResolver =>
  async (headers): Promise<InvocationPrincipal | null> => {
    try {
      const hasAuthorization = headers.has("Authorization");
      const lookupHeaders = new Headers(headers);
      if (hasAuthorization) {
        // Never allow a bad Authorization header to fall back to a valid
        // browser cookie. Better Auth must validate this bearer on its own.
        lookupHeaders.delete("Cookie");
      }
      const session = await lookupSession(lookupHeaders);
      return principalFromSession(
        session,
        hasAuthorization ? "agent" : "user",
        now()
      );
    } catch {
      return null;
    }
  };

export const createRequestId = (): string => crypto.randomUUID();
