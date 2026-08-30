import {
  permissionsForRole,
  ROLE_ADMIN,
  ROLE_APPROVER,
  ROLE_OPERATOR,
  ROLE_RECRUITER,
} from "@ji/application/registry";
import type { InvocationPrincipal, SliceARole } from "@ji/application/registry";

const bearerPattern = /^Bearer\s+(?<role>\w+):(?<subjectId>[^\s]+)$/u;

const isSliceARole = (value: string): value is SliceARole =>
  value === ROLE_RECRUITER ||
  value === ROLE_OPERATOR ||
  value === ROLE_ADMIN ||
  value === ROLE_APPROVER;

export const parseAuthHeader = (
  authorization: string | undefined
): InvocationPrincipal | null => {
  if (!authorization) {
    return null;
  }
  const match = bearerPattern.exec(authorization);
  const role = match?.groups?.role;
  const subjectId = match?.groups?.subjectId;
  if (!role || !subjectId || !isSliceARole(role)) {
    return null;
  }
  return Object.freeze({
    kind: "agent" as const,
    permissions: permissionsForRole(role),
    subjectId,
  });
};

export const createRequestId = (): string => crypto.randomUUID();
