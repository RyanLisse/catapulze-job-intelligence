import { describe, expect, it } from "bun:test";

import { readLiveJobsArtifactPolicy } from "./artifact-policy";
import {
  assertCanaryBatchResponse,
  assertCanaryDetailResponse,
  assertCanarySearchResponse,
  canonicalCanaryDigest,
  isCanaryScreenshotAttestation,
} from "./canary";
import { assertAnonymousLiveRun } from "./config";
import type { LiveJobsEnvironment } from "./config";
import {
  assertAllowedCapabilityRequests,
  hasForbiddenBrowserAuthHeader,
} from "./evidence";
import { throwSanitizedMutationFailures } from "./mutation-errors";
import { preflightReleaseIdentity } from "./release-preflight";
import { preflightLiveJobsRun } from "./run-preflight";

const canaryId = "00000000-0000-4000-8000-000000000001";
const releaseSha = "0123456789abcdef0123456789abcdef01234567";

const remoteEnvironment = {
  E2E_API_URL: "https://api.jobs.example",
  E2E_BASE_URL: "https://jobs.example",
  E2E_EXPECTED_RELEASE_SHA: releaseSha,
  E2E_LIVE: "1",
} satisfies LiveJobsEnvironment;

const mutationEnvironment = {
  E2E_ALLOW_WRITES: "1",
  E2E_API_URL: "http://localhost:3000",
  E2E_AUTH_MODE: "session",
  E2E_BASE_URL: "http://localhost:3001",
  E2E_CANARY_DIGEST:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  E2E_CANARY_ID: canaryId,
  E2E_CLEANUP_TOKEN: "test-token-from-environment",
  E2E_CLEANUP_URL: "http://localhost:3000/e2e/cleanup",
  E2E_DATA_MODE: "canary",
  E2E_EXPECTED_RELEASE_SHA: releaseSha,
  E2E_EXPECTED_SUBJECT_ID: "dedicated-test-account",
  E2E_LIVE: "1",
  E2E_LOCAL_MODE: "1",
  E2E_QUERY: "canary record",
  E2E_STORAGE_STATE: "/private/tmp/e2e-storage-state.json",
  E2E_TEST_ACCOUNT_ID: "dedicated-test-account",
  E2E_TEST_ENV: "isolated",
  E2E_TEST_NAMESPACE: "e2e-20260902-write",
} satisfies LiveJobsEnvironment;

describe("live jobs E2E canary and artifact boundaries", () => {
  it("rejects a response where a production record is listed first", () => {
    expect(() =>
      assertCanarySearchResponse(
        { ids: ["11111111-1111-4111-8111-111111111111", canaryId] },
        canaryId
      )
    ).toThrow(/exactly the configured canary/u);
  });

  it("accepts only a one-item search and batch response for the exact canary", () => {
    expect(() =>
      assertCanarySearchResponse({ ids: [canaryId] }, canaryId)
    ).not.toThrow();
    expect(() =>
      assertCanaryBatchResponse(
        { items: [{ aanvraag: { id: canaryId }, id: canaryId }] },
        canaryId
      )
    ).not.toThrow();
    expect(() =>
      assertCanaryBatchResponse(
        {
          items: [
            {
              aanvraag: { id: "11111111-1111-4111-8111-111111111111" },
              id: "11111111-1111-4111-8111-111111111111",
            },
          ],
        },
        canaryId
      )
    ).toThrow(/exactly the configured record/u);
  });

  it("issues screenshot attestation only after the pinned detail digest matches", async () => {
    const aanvraag = {
      id: canaryId,
      rawPayloadRef: "safe-canary-ref",
      titel: "Safe canary",
    };
    const digest = await canonicalCanaryDigest(aanvraag);
    const reorderedDigest = await canonicalCanaryDigest({
      id: aanvraag.id,
      rawPayloadRef: aanvraag.rawPayloadRef,
      titel: aanvraag.titel,
    });

    expect(reorderedDigest).toBe(digest);
    const attestation = await assertCanaryDetailResponse(
      { aanvraag },
      canaryId,
      digest
    );
    expect(isCanaryScreenshotAttestation(attestation)).toBe(true);
    expect(isCanaryScreenshotAttestation({ canaryId, digest })).toBe(false);
    await expect(
      assertCanaryDetailResponse(
        { aanvraag },
        canaryId,
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      )
    ).rejects.toThrow(/E2E_CANARY_DIGEST/u);
  });

  it("keeps traces off for remote and local isolated runs", () => {
    expect(readLiveJobsArtifactPolicy(remoteEnvironment)).toEqual({
      screenshot: "off",
      trace: "off",
      video: "off",
    });
    expect(
      readLiveJobsArtifactPolicy({
        E2E_LOCAL_MODE: "1",
        E2E_TEST_ENV: "isolated",
      })
    ).toEqual({
      screenshot: "off",
      trace: "off",
      video: "off",
    });
    expect(readLiveJobsArtifactPolicy({ E2E_LOCAL_MODE: "1" })).toEqual({
      screenshot: "off",
      trace: "off",
      video: "off",
    });
  });

  it("fails closed on every unexpected capability method and path", () => {
    const allowlist = [
      {
        label: "search",
        method: "POST",
        path: "/v1/aanvragen/search",
        status: 200,
      },
    ];

    expect(() =>
      assertAllowedCapabilityRequests(
        [{ method: "POST", path: "/v1/aanvragen/search" }],
        allowlist
      )
    ).not.toThrow();
    expect(() =>
      assertAllowedCapabilityRequests(
        [{ method: "DELETE", path: "/v1/aanvragen/search" }],
        allowlist
      )
    ).toThrow(/outside its exact allowlist/u);
    expect(() =>
      assertAllowedCapabilityRequests(
        [{ method: "POST", path: "/v1/:unexpected" }],
        allowlist
      )
    ).toThrow(/outside its exact allowlist/u);
    expect(() =>
      assertAllowedCapabilityRequests(
        [{ method: "POST", path: "/v1/snapshots" }],
        allowlist
      )
    ).toThrow(/outside its exact allowlist/u);
  });

  it("preserves primary and cleanup failure classes without unsafe details", () => {
    let caught: unknown;
    try {
      throwSanitizedMutationFailures({
        cleanupFailed: true,
        primaryFailed: true,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) {
      throw new Error("Expected sanitized AggregateError.");
    }
    const aggregate = caught;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.message).toBe(
      "Live jobs mutation and cleanup both failed."
    );
    expect(aggregate.errors.map((error: Error) => error.message)).toEqual([
      "Live jobs mutation assertions failed; no unsafe error detail was retained.",
      "Live jobs mutation cleanup failed; no unsafe error detail was retained.",
    ]);
  });

  it("flags legacy role-bearing browser headers without retaining values", () => {
    expect(
      hasForbiddenBrowserAuthHeader({
        Authorization: "Bearer recruiter:dedicated-test-account",
      })
    ).toBe(true);
    expect(
      hasForbiddenBrowserAuthHeader({ "X-Caller-Role": "recruiter" })
    ).toBe(true);
    expect(hasForbiddenBrowserAuthHeader({ Accept: "application/json" })).toBe(
      false
    );
  });

  it("requires exact server release identity with redirects disabled", async () => {
    const config = assertAnonymousLiveRun({
      ...remoteEnvironment,
      E2E_AUTH_MODE: "anonymous",
    });
    let requestInit: RequestInit | undefined;

    await preflightReleaseIdentity(config, {
      fetcher: (_input, init) => {
        requestInit = init;
        return Promise.resolve({
          json: () => Promise.resolve({ releaseSha }),
          status: 200,
          url: "https://api.jobs.example/version",
        });
      },
    });

    expect(requestInit?.redirect).toBe("error");
    await expect(
      preflightReleaseIdentity(config, {
        fetcher: () =>
          Promise.resolve({
            json: () => Promise.resolve({ releaseSha }),
            status: 200,
            url: "https://api.jobs.example/version/redirected",
          }),
      })
    ).rejects.toThrow(/exact 200/u);
    await expect(
      preflightReleaseIdentity(config, {
        fetcher: () =>
          Promise.resolve({
            json: () =>
              Promise.resolve({ releaseSha: releaseSha.replace("0", "f") }),
            status: 200,
            url: "https://api.jobs.example/version",
          }),
      })
    ).rejects.toThrow(/does not exactly match/u);
  });

  it("never reaches cleanup when the derived session subject mismatches", async () => {
    let cleanupCalls = 0;

    await expect(
      preflightLiveJobsRun("writes", mutationEnvironment, {
        cleanupPreflight: () => {
          cleanupCalls += 1;
          return Promise.resolve();
        },
        releasePreflight: () => Promise.resolve(),
        sessionVerifier: () =>
          Promise.resolve({ subjectId: "different-account" }),
      })
    ).rejects.toThrow(/E2E_EXPECTED_SUBJECT_ID/u);

    expect(cleanupCalls).toBe(0);
  });

  it("fails authenticated mode before a browser starts while cookie verification is unapproved", async () => {
    await expect(
      preflightLiveJobsRun("session", mutationEnvironment, {
        releasePreflight: () => Promise.resolve(),
      })
    ).rejects.toThrow(/approved Better Auth storage-state verifier/u);
  });
});
