import {
  PERM_SLICE_READ,
  permissionsForRole,
  ROLE_ADMIN,
  ROLE_OPERATOR,
  ROLE_RECRUITER,
  type InvocationPrincipal,
  type SliceARole,
} from "@ji/application/registry";

const bearerPattern = /^Bearer\s+(\w+):([^\s]+)$/u;

export const parseAuthHeader = (
  authorization: string | undefined
): InvocationPrincipal | null => {
  if (!authorization) {
    return null;
  }
  const match = bearerPattern.exec(authorization);
  if (!match) {
    return null;
  }
  const [, rawRole, subjectId] = match;
  if (
    rawRole !== ROLE_RECRUITER &&
    rawRole !== ROLE_OPERATOR &&
    rawRole !== ROLE_ADMIN
  ) {
    return null;
  }
  const role = rawRole as SliceARole;
  return Object.freeze({
    kind: "agent" as const,
    permissions: permissionsForRole(role),
    subjectId,
  });
};

export const createRequestId = (): string => crypto.randomUUID();
