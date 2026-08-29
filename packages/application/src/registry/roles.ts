export const ROLE_RECRUITER = "recruiter" as const;
export const ROLE_OPERATOR = "operator" as const;
export const ROLE_ADMIN = "admin" as const;

export const sliceARoles = [
  ROLE_RECRUITER,
  ROLE_OPERATOR,
  ROLE_ADMIN,
] as const;

export type SliceARole = (typeof sliceARoles)[number];

export const PERM_SLICE_READ = "slice-a:read" as const;

export const permissionsForRole = (role: SliceARole): ReadonlySet<string> => {
  switch (role) {
    case ROLE_ADMIN: {
      return new Set([
        PERM_SLICE_READ,
        ROLE_RECRUITER,
        ROLE_OPERATOR,
        ROLE_ADMIN,
      ]);
    }
    case ROLE_OPERATOR: {
      return new Set([PERM_SLICE_READ, ROLE_OPERATOR]);
    }
    case ROLE_RECRUITER: {
      return new Set([PERM_SLICE_READ, ROLE_RECRUITER]);
    }
    default: {
      const _exhaustive: never = role;
      throw new Error(`Unsupported role: ${String(_exhaustive)}`);
    }
  }
};

export const hasRecruiterPermission = (
  permissions: ReadonlySet<string>
): boolean => permissions.has(ROLE_RECRUITER);
