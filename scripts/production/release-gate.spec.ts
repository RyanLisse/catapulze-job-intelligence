/* oxlint-disable eslint/complexity, eslint/require-await, eslint/no-nested-ternary, unicorn/no-nested-ternary, anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion -- These stateful protocol fixtures intentionally centralize REST and GraphQL response branches to exercise fail-closed release behavior. */
import { describe, expect, it } from "bun:test";

import {
  assertCleanReview,
  assertMainCandidate,
  assertStrictReleaseAncestry,
  assertTrustedCheck,
  blockedReleasePath,
  runReleaseGate,
  selectLatestExactWorkflowRun,
} from "./release-gate";
import type { FetchInput, FetchLike } from "./release-gate";

const sha = "a".repeat(40);

describe("production release gate rejection paths", () => {
  it("rejects a stale main SHA before release work", () => {
    expect(() => assertMainCandidate(sha, "b".repeat(40))).toThrow(
      "main_moved"
    );
  });

  it("rejects unresolved review threads and active change requests", () => {
    expect(() => assertCleanReview(null, 1)).toThrow(
      "unresolved_review_threads"
    );
    expect(() => assertCleanReview("CHANGES_REQUESTED", 0)).toThrow(
      "changes_requested"
    );
  });

  it("rejects an untrusted or unsuccessful CI check", () => {
    expect(() =>
      assertTrustedCheck(
        {
          app: { id: 1_210_556, slug: "cursor" },
          conclusion: "success",
          head_sha: sha,
          name: "verify",
          status: "completed",
          workflow_name: "CI",
        },
        sha,
        "CI",
        "verify"
      )
    ).toThrow("untrusted_check");
  });

  it("rejects a bad or stale release ancestry comparison", () => {
    expect(() => assertStrictReleaseAncestry("behind", 0, 1)).toThrow(
      "invalid_release_ancestry"
    );
    expect(() => assertStrictReleaseAncestry("ahead", 0, 0)).toThrow(
      "invalid_release_ancestry"
    );
  });

  it("routes migrations, index schema, backfills, and worker changes away from the automatic lane", () => {
    expect(blockedReleasePath("packages/db/src/migrations/0001.sql")).toBe(
      true
    );
    expect(blockedReleasePath("packages/search/src/schema/index.ts")).toBe(
      true
    );
    expect(blockedReleasePath("scripts/backfill-neon-v1.ts")).toBe(true);
    expect(blockedReleasePath("packages/application/src/backfill/run.ts")).toBe(
      true
    );
    expect(blockedReleasePath("packages/connectors/src/source.ts")).toBe(true);
    expect(blockedReleasePath("apps/worker/src/tasks/poll.ts")).toBe(true);
  });
});

const releaseCandidateSha = "c".repeat(40);
const releasePreviousSha = "d".repeat(40);
const secondCommitSha = "e".repeat(40);
const firstHeadSha = "f".repeat(40);
const secondHeadSha = "a".repeat(40);

interface GateHarnessOptions {
  readonly blockedFile?: string;
  readonly latestCiFailed?: boolean;
  readonly unresolvedPullRequest?: number;
  readonly missingFormalReview?: boolean;
  readonly truncatedReviews?: boolean;
  readonly untrustedReviewer?: boolean;
  readonly trustedReviewerAfterUntrusted?: boolean;
  readonly reviewerRevokedApproval?: boolean;
  readonly unreviewedCommit?: boolean;
}

interface GraphqlReviewPayload {
  readonly nodes: readonly {
    readonly author: { readonly login: string };
    readonly commit: { readonly oid: string };
    readonly state: string;
    readonly submittedAt: string;
  }[];
  pageInfo?: {
    readonly endCursor: string | null;
    readonly hasNextPage: boolean;
  };
}

const gateJson = (body: unknown, init?: ResponseInit): Response =>
  Response.json(body, init);

const makeGateHarness = (options: GateHarnessOptions = {}) => {
  const calls: string[] = [];
  const workflowPath = ".github/workflows/ci.yml";
  const fetchImpl = async (
    input: FetchInput,
    init?: RequestInit
  ): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/git/ref/heads/main")) {
      return gateJson({ object: { sha: releaseCandidateSha } });
    }
    if (
      url.includes(`/compare/${releasePreviousSha}...${releaseCandidateSha}`)
    ) {
      return gateJson({
        ahead_by: 2,
        behind_by: 0,
        commits: [{ sha: releaseCandidateSha }, { sha: secondCommitSha }],
        files: [options.blockedFile ?? "packages/domain/src/value.ts"].map(
          (filename) => ({ filename })
        ),
        status: "ahead",
      });
    }
    if (url.includes(`/commits/${releaseCandidateSha}/pulls`)) {
      return gateJson([
        {
          head: { sha: firstHeadSha },
          merge_commit_sha: releaseCandidateSha,
          merged_at: "2026-09-11T10:00:00Z",
          number: 1,
          user: { login: "author-one" },
        },
      ]);
    }
    if (url.includes(`/commits/${secondCommitSha}/pulls`)) {
      if (options.unreviewedCommit) {
        return gateJson([]);
      }
      return gateJson([
        {
          head: { sha: secondHeadSha },
          merge_commit_sha: secondCommitSha,
          merged_at: "2026-09-11T11:00:00Z",
          number: 2,
          user: { login: "author-two" },
        },
      ]);
    }
    if (url.includes("/pulls/1/files")) {
      return gateJson([{ filename: "packages/domain/src/value.ts" }]);
    }
    if (url.includes("/pulls/2/files")) {
      return gateJson([{ filename: "packages/application/src/use-case.ts" }]);
    }
    if (url.includes("/collaborators/reviewer/permission")) {
      return gateJson({
        permission: options.untrustedReviewer ? "pull" : "push",
      });
    }
    if (url.includes("/collaborators/trusted-reviewer/permission")) {
      return gateJson({ permission: "push" });
    }
    if (url.includes("/commits/") && url.includes("/check-runs")) {
      if (options.missingFormalReview) {
        return gateJson([
          {
            app: { id: 15_368, slug: "github-actions" },
            conclusion: "success",
            details_url: "https://github.com/test/repo/actions/runs/99",
            head_sha: url.includes(firstHeadSha) ? firstHeadSha : secondHeadSha,
            name: "claude-review",
            status: "completed",
          },
        ]);
      }
      return gateJson([]);
    }
    if (url.includes("/actions/workflows/") && url.includes("/runs")) {
      const { latestCiFailed } = options;
      return gateJson(
        latestCiFailed
          ? [
              {
                check_suite_id: 122,
                conclusion: "success",
                event: "push",
                head_branch: "main",
                head_sha: releaseCandidateSha,
                id: 11,
                path: workflowPath,
                status: "completed",
              },
              {
                check_suite_id: 122,
                conclusion: "failure",
                event: "push",
                head_branch: "main",
                head_sha: releaseCandidateSha,
                id: 22,
                path: workflowPath,
                status: "completed",
              },
            ]
          : [
              {
                check_suite_id: 122,
                conclusion: "success",
                event: "push",
                head_branch: "main",
                head_sha: releaseCandidateSha,
                id: 22,
                path: workflowPath,
                status: "completed",
              },
            ]
      );
    }
    if (url.includes("/actions/runs/22/jobs")) {
      return gateJson(
        [
          "changes",
          "verify",
          "build",
          "application-image-smoke",
          "mcp-edge-smoke",
          "postgres-restore-drill",
        ].map((name) => ({
          conclusion: "success",
          head_sha: releaseCandidateSha,
          name,
          status: "completed",
        }))
      );
    }
    if (url.includes("/check-suites/122/check-runs")) {
      return gateJson(
        [
          "changes",
          "verify",
          "build",
          "application-image-smoke",
          "mcp-edge-smoke",
          "postgres-restore-drill",
        ].map((name) => ({
          app: { id: 15_368, slug: "github-actions" },
          conclusion: "success",
          head_sha: releaseCandidateSha,
          name,
          status: "completed",
          workflow_name: "CI",
        }))
      );
    }
    if (url.includes("/actions/runs/99")) {
      return gateJson({
        conclusion: "success",
        head_sha: firstHeadSha,
        path: ".github/workflows/claude-code-review.yml",
        status: "completed",
      });
    }
    if (url.includes("/issues?state=open&labels=release-blocker")) {
      return gateJson([]);
    }
    throw new Error(`unhandled gate route ${init?.method ?? "GET"} ${url}`);
  };

  const graphqlFetchImpl = async (
    _input: FetchInput,
    init?: RequestInit
  ): Promise<Response> => {
    const body = JSON.parse(String(init?.body));
    const pullRequestNumber = body.variables.number as number;
    const threadCursor = body.variables.threadCursor as string | null;
    const unresolved =
      options.unresolvedPullRequest === pullRequestNumber &&
      threadCursor === "page-2";
    const hasNextThreadPage =
      options.unresolvedPullRequest === pullRequestNumber &&
      threadCursor === null;
    const reviewNodes = options.missingFormalReview
      ? []
      : options.trustedReviewerAfterUntrusted
        ? [
            {
              author: { login: "reviewer" },
              commit: {
                oid: pullRequestNumber === 1 ? firstHeadSha : secondHeadSha,
              },
              state: "APPROVED",
              submittedAt: "2026-09-11T12:00:00Z",
            },
            {
              author: { login: "trusted-reviewer" },
              commit: {
                oid: pullRequestNumber === 1 ? firstHeadSha : secondHeadSha,
              },
              state: "APPROVED",
              submittedAt: "2026-09-11T13:00:00Z",
            },
          ]
        : options.reviewerRevokedApproval
          ? [
              {
                author: { login: "reviewer" },
                commit: {
                  oid: pullRequestNumber === 1 ? firstHeadSha : secondHeadSha,
                },
                state: "APPROVED",
                submittedAt: "2026-09-11T12:00:00Z",
              },
              {
                author: { login: "reviewer" },
                commit: {
                  oid: pullRequestNumber === 1 ? firstHeadSha : secondHeadSha,
                },
                state: "CHANGES_REQUESTED",
                submittedAt: "2026-09-11T13:00:00Z",
              },
            ]
          : [
              {
                author: { login: "reviewer" },
                commit: {
                  oid: pullRequestNumber === 1 ? firstHeadSha : secondHeadSha,
                },
                state: "APPROVED",
                submittedAt: "2026-09-11T12:00:00Z",
              },
            ];
    const reviews: GraphqlReviewPayload = {
      nodes: reviewNodes,
    };
    if (!options.truncatedReviews) {
      reviews.pageInfo = { endCursor: null, hasNextPage: false };
    }
    return gateJson({
      data: {
        repository: {
          pullRequest: {
            reviewDecision: options.missingFormalReview ? null : "APPROVED",
            reviewThreads: {
              nodes: unresolved ? [{ isResolved: false }] : [],
              pageInfo: {
                endCursor: hasNextThreadPage ? "page-2" : null,
                hasNextPage: hasNextThreadPage,
              },
            },
            reviews,
          },
        },
      },
    });
  };

  return {
    calls,
    fetchImpl: async (input: FetchInput, init?: RequestInit) =>
      String(input) === "https://api.github.com/graphql"
        ? graphqlFetchImpl(input, init)
        : fetchImpl(input, init),
  };
};

const gateConfig = (fetchImpl: FetchLike) => ({
  candidateSha: releaseCandidateSha,
  fetchImpl,
  lastDeployedSha: releasePreviousSha,
  repository: "test/repo",
  token: "github-token",
});

describe("production release gate integrations", () => {
  it("rejects a stale green CI attempt when the latest exact-SHA attempt failed", async () => {
    const harness = makeGateHarness({ latestCiFailed: true });

    await expect(runReleaseGate(gateConfig(harness.fetchImpl))).rejects.toThrow(
      "required_workflow_failed"
    );
  });

  it("walks every comparison PR and every review-thread page", async () => {
    const harness = makeGateHarness({ unresolvedPullRequest: 2 });

    await expect(runReleaseGate(gateConfig(harness.fetchImpl))).rejects.toThrow(
      "unresolved_review_threads"
    );
    expect(harness.calls.some((url) => url.includes("/pulls/2/files"))).toBe(
      true
    );
  });

  it("rejects a PR without an exact-head formal approval", async () => {
    const harness = makeGateHarness({ missingFormalReview: true });

    await expect(runReleaseGate(gateConfig(harness.fetchImpl))).rejects.toThrow(
      "review_evidence_missing"
    );
  });

  it("rejects an exact-head approval from an untrusted repository reviewer", async () => {
    const harness = makeGateHarness({ untrustedReviewer: true });

    await expect(runReleaseGate(gateConfig(harness.fetchImpl))).rejects.toThrow(
      "review_evidence_untrusted"
    );
  });

  it("accepts a trusted exact-head approval after an untrusted approval", async () => {
    const harness = makeGateHarness({ trustedReviewerAfterUntrusted: true });

    await expect(
      runReleaseGate(gateConfig(harness.fetchImpl))
    ).resolves.toMatchObject({
      pullRequestNumbers: [1, 2],
    });
  });

  it("ignores an approval revoked by the same reviewer later", async () => {
    const harness = makeGateHarness({ reviewerRevokedApproval: true });

    await expect(runReleaseGate(gateConfig(harness.fetchImpl))).rejects.toThrow(
      "review_evidence_missing"
    );
  });

  it("fails closed when review pagination metadata is truncated", async () => {
    const harness = makeGateHarness({ truncatedReviews: true });

    await expect(runReleaseGate(gateConfig(harness.fetchImpl))).rejects.toThrow(
      "malformed_response"
    );
  });

  it("blocks search schema changes in the full comparison before deployment evidence", async () => {
    const harness = makeGateHarness({
      blockedFile: "packages/search/src/schema/index.ts",
    });

    await expect(runReleaseGate(gateConfig(harness.fetchImpl))).rejects.toThrow(
      "migration_or_backfill_required"
    );
  });

  it("rejects a comparison commit without merged pull request evidence", async () => {
    const harness = makeGateHarness({ unreviewedCommit: true });

    await expect(runReleaseGate(gateConfig(harness.fetchImpl))).rejects.toThrow(
      "unreviewed_release_commit"
    );
  });

  it("selects only the newest exact push attempt", () => {
    expect(
      selectLatestExactWorkflowRun(
        [
          {
            conclusion: "success",
            event: "push",
            head_branch: "main",
            head_sha: releaseCandidateSha,
            id: 1,
            path: ".github/workflows/ci.yml",
            status: "completed",
          },
          {
            conclusion: "failure",
            event: "push",
            head_branch: "main",
            head_sha: releaseCandidateSha,
            id: 2,
            path: ".github/workflows/ci.yml",
            status: "completed",
          },
        ],
        releaseCandidateSha,
        ".github/workflows/ci.yml"
      ).map((run) => run.id)
    ).toEqual([2]);
  });
});
