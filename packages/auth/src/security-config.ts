export const AUTH_USER_ROLES = [
  "recruiter",
  "operator",
  "admin",
  "approver",
] as const;

export type AuthUserRole = (typeof AUTH_USER_ROLES)[number];

export const DEFAULT_AUTH_USER_ROLE = "recruiter" satisfies AuthUserRole;

/**
 * Better Auth owns this field. `input: false` prevents sign-up, profile
 * mapping, and user-update bodies from assigning or escalating a role.
 */
export const AUTH_USER_ROLE_FIELD = Object.freeze({
  defaultValue: DEFAULT_AUTH_USER_ROLE,
  input: false,
  required: true,
  returned: true,
  type: [...AUTH_USER_ROLES],
});

export const AUTH_BEARER_OPTIONS = Object.freeze({
  requireSignature: true,
});

export const AUTH_EMAIL_PASSWORD_OPTIONS = Object.freeze({
  disableSignUp: true,
  enabled: true,
});
