/* oxlint-disable eslint/complexity, eslint/require-await, eslint/prefer-destructuring, eslint/no-plusplus, eslint/no-nested-ternary, unicorn/prefer-response-static-json, promise/avoid-new, eslint/no-promise-executor-return, anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion -- The stateful HTTP harness intentionally centralizes many protocol branches and uses an explicit clock delay for timeout coverage. */
import { describe, expect, it } from "bun:test";

import {
  DEPLOYMENT_ORDER,
  extractLatestFinishedDeploymentSha,
  extractDeploymentUuid,
  rollbackOrder,
  runCoolifyDeploy,
} from "./coolify-deploy";
import type { FetchInput } from "./coolify-deploy";

const must = <T>(value: T | undefined, reason: string): T => {
  if (value === undefined) {
    throw new Error(reason);
  }
  return value;
};

const candidateSha = "c".repeat(40);
const previousSha = "d".repeat(40);
const schemaHash = "schema-v1";
const coolifyBaseUrl = "https://coolify.test/api/v1";
const coolifyPathPrefix = new URL(coolifyBaseUrl).pathname;
const apiPublicUrl = "https://api.test";
const webPublicUrl = "https://web.test";
const applicationUuids = {
  projector: "projector-uuid",
  server: "server-uuid",
  web: "web-uuid",
} as const;

type Role = keyof typeof applicationUuids;
type FailureMode = "public" | "projector-schema" | "timeout" | "wrong-sha";

interface HarnessOptions {
  readonly failRole?: Role;
  readonly failureMode?: FailureMode;
  readonly mainMovesAfter?: number;
  readonly patchFailsAfterMutation?: boolean;
  readonly rollbackPatchFails?: boolean;
  readonly mainTransportFails?: boolean;
  readonly cancelRaceFinished?: boolean;
  readonly baselineMismatch?: boolean;
  readonly dashboardLocation?: string;
}

interface HarnessState {
  readonly calls: { method: string; url: string }[];
  readonly sha: Record<Role, string>;
  mainReads: number;
  cancelledDeployment: string | undefined;
  finishedRaceDeployment: string | undefined;
  candidateDeployments: number;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

const roleForUuid = (uuid: string): Role => {
  const entry = Object.entries(applicationUuids).find(
    ([, value]) => value === uuid
  );
  if (!entry) {
    throw new Error(`unknown uuid ${uuid}`);
  }
  return entry[0] as Role;
};

const makeHarness = (options: HarnessOptions = {}) => {
  const state: HarnessState = {
    calls: [],
    cancelledDeployment: undefined,
    candidateDeployments: 0,
    finishedRaceDeployment: undefined,
    mainReads: 0,
    sha: {
      projector: options.baselineMismatch ? candidateSha : previousSha,
      server: previousSha,
      web: options.baselineMismatch ? candidateSha : previousSha,
    },
  };

  const fetchImpl = async (
    input: FetchInput,
    init?: RequestInit
  ): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    state.calls.push({ method, url });

    if (url.includes("api.github.com/repos/test/repo/git/ref/heads/main")) {
      state.mainReads += 1;
      if (options.mainTransportFails) {
        throw new Error("simulated GitHub timeout");
      }
      const moved =
        options.mainMovesAfter !== undefined &&
        state.mainReads > options.mainMovesAfter;
      return json({ object: { sha: moved ? "m".repeat(40) : candidateSha } });
    }

    if (url.startsWith(coolifyBaseUrl)) {
      const parsed = new URL(url);
      const path = parsed.pathname.slice(coolifyPathPrefix.length);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (path === "/deployments" && method === "GET") {
        return json([]);
      }
      if (path.startsWith("/deployments/applications/") && method === "GET") {
        const uuid = must(
          path.split("/")[3],
          `harness could not read an application UUID from ${path}`
        );
        const role = roleForUuid(uuid);
        return json({
          count: 1,
          deployments: [
            {
              application_id: "1",
              commit: state.sha[role],
              created_at: "2026-09-11T12:00:00.000Z",
              deployment_uuid: `${role}-history`,
              status: "finished",
            },
          ],
        });
      }
      if (path.startsWith("/deployments/") && method === "GET") {
        const deploymentUuid = must(
          path.split("/")[2],
          `harness could not read a deployment UUID from ${path}`
        );
        if (state.cancelledDeployment === deploymentUuid) {
          return json({
            commit: previousSha,
            deployment_uuid: deploymentUuid,
            status: "failed",
          });
        }
        if (state.finishedRaceDeployment === deploymentUuid) {
          return json({
            commit: candidateSha,
            deployment_uuid: deploymentUuid,
            status: "finished",
          });
        }
        if (
          options.failureMode === "timeout" &&
          deploymentUuid.includes("server-deployment")
        ) {
          return json({
            commit: candidateSha,
            deployment_uuid: deploymentUuid,
            status: "queued",
          });
        }
        const wrongSha =
          options.failureMode === "wrong-sha" &&
          deploymentUuid.includes("server-deployment");
        const rollback = deploymentUuid.includes("rollback");
        return json({
          commit: rollback || wrongSha ? previousSha : candidateSha,
          deployment_uuid: deploymentUuid,
          status: "finished",
        });
      }
      if (path.startsWith("/applications/") && method === "GET") {
        const uuid = must(
          path.split("/")[2],
          `harness could not read an application UUID from ${path}`
        );
        const role = roleForUuid(uuid);
        return json({
          git_commit_sha: state.sha[role],
          status: "healthy",
          uuid,
        });
      }
      if (path.startsWith("/applications/") && method === "PATCH") {
        const uuid = must(
          path.split("/")[2],
          `harness could not read an application UUID from ${path}`
        );
        const role = roleForUuid(uuid);
        const requestedSha = body?.git_commit_sha;
        if (requestedSha === previousSha && options.rollbackPatchFails) {
          return json({ uuid: "wrong-rollback-uuid" });
        }
        state.sha[role] = requestedSha;
        if (options.patchFailsAfterMutation && requestedSha === candidateSha) {
          throw new Error("simulated uncertain PATCH");
        }
        return json({ uuid });
      }
      if (path === "/deploy" && method === "POST") {
        const uuid = parsed.searchParams.get("uuid");
        if (!uuid) {
          throw new Error("missing deploy uuid");
        }
        const role = roleForUuid(uuid);
        const rollback = state.sha[role] === previousSha;
        const deploymentUuid = rollback
          ? `${role}-rollback`
          : `${role}-deployment-${++state.candidateDeployments}`;
        return json({
          deployments: [
            { deployment_uuid: deploymentUuid, resource_uuid: uuid },
          ],
        });
      }
      if (path.startsWith("/deployments/") && path.endsWith("/cancel")) {
        const deploymentUuid = path.split("/")[2];
        if (options.cancelRaceFinished) {
          state.finishedRaceDeployment = deploymentUuid;
          return json({ error: "deployment already finished" }, 400);
        }
        state.cancelledDeployment = deploymentUuid;
        return json({ deployment_uuid: deploymentUuid, status: "cancelled" });
      }
      throw new Error(`unhandled Coolify route ${method} ${path}`);
    }

    if (url.startsWith(apiPublicUrl)) {
      const path = new URL(url).pathname;
      if (path === "/version") {
        return json({
          releaseSha:
            options.failRole === "server" && state.sha.server === candidateSha
              ? previousSha
              : state.sha.server,
        });
      }
      if (path === "/livez") {
        return new Response("ok", {
          status:
            options.failRole === "server" && state.sha.server === candidateSha
              ? 503
              : 200,
        });
      }
      if (path === "/projector/runtime") {
        return json({
          active: true,
          containerId: "0123456789ab",
          cycle: 3,
          heartbeatFresh: true,
          releaseSha: state.sha.projector,
        });
      }
      if (path === "/readyz") {
        return json({
          components: {
            searchProjection: {
              schemaHash:
                options.failRole === "projector" &&
                state.sha.projector === candidateSha &&
                options.failureMode === "projector-schema"
                  ? "wrong-schema"
                  : schemaHash,
              status: "ok",
            },
          },
          status: "ready",
        });
      }
    }

    if (url.startsWith(webPublicUrl)) {
      const path = new URL(url).pathname;
      if (path === "/version") {
        return json({ releaseSha: state.sha.web });
      }
      if (path === "/") {
        return new Response("ok", {
          status:
            options.failRole === "web" && state.sha.web === candidateSha
              ? 503
              : 200,
        });
      }
      if (path === "/dashboard") {
        return new Response(null, {
          headers: { location: options.dashboardLocation ?? "/login" },
          status: 307,
        });
      }
    }

    throw new Error(`unhandled route ${method} ${url}`);
  };

  return {
    config: {
      apiBaseUrl: coolifyBaseUrl,
      apiPublicUrl,
      apiToken: "coolify-token",
      applicationUuids,
      candidateSha,
      enabled: true,
      fetchImpl,
      githubToken: "github-token",
      pollIntervalMs: 100,
      projectorRuntimeUrl: `${apiPublicUrl}/projector/runtime`,
      projectorSchemaHash: schemaHash,
      repository: "test/repo",
      sleepImpl: async (milliseconds: number) => {
        if (milliseconds > 0) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, milliseconds)
          );
        }
      },
      timeoutMs: 1000,
      webPublicUrl,
      webVersionUrl: "/version",
    } as const,
    fetchImpl,
    state,
  };
};

describe("production Coolify deployment contract", () => {
  it("deploys all roles from full Coolify envelopes and reads each pin back", async () => {
    const harness = makeHarness();
    const evidence = await runCoolifyDeploy(harness.config);

    expect(evidence.map((item) => item.role)).toEqual([
      "server",
      "web",
      "projector",
    ]);
    expect(evidence.every((item) => item.previousSha === previousSha)).toBe(
      true
    );
    const candidatePatches = harness.state.calls.filter(
      ({ method, url }) => method === "PATCH" && url.includes("/applications/")
    );
    expect(candidatePatches).toHaveLength(3);
  });

  it.each(["server", "web", "projector"] as const)(
    "rolls back a failure in the %s role",
    async (failRole) => {
      const harness = makeHarness({
        failRole,
        failureMode: failRole === "projector" ? "projector-schema" : "public",
      });

      await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
        failRole === "server"
          ? "version_sha_mismatch"
          : failRole === "web"
            ? "web_readback_failed"
            : "projector_schema_mismatch"
      );
      expect(harness.state.sha).toEqual({
        projector: previousSha,
        server: previousSha,
        web: previousSha,
      });
      expect(
        harness.state.calls.some(
          ({ method, url }) =>
            method === "GET" && url.includes("/deployments/server-rollback")
        )
      ).toBe(true);
    }
  );

  it("rolls back after main moves because rollback does not depend on main", async () => {
    const harness = makeHarness({ mainMovesAfter: 4 });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "main_moved"
    );
    expect(harness.state.sha.server).toBe(previousSha);
    expect(
      harness.state.calls.some(
        ({ method, url }) =>
          method === "GET" && url.includes("/deployments/server-rollback")
      )
    ).toBe(true);
  });

  it("rolls back an uncertain PATCH after Coolify mutates then drops the connection", async () => {
    const harness = makeHarness({ patchFailsAfterMutation: true });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "coolify_transport_error"
    );
    expect(harness.state.sha.server).toBe(previousSha);
    expect(
      harness.state.calls.filter(
        ({ method, url }) => method === "PATCH" && url.includes("server-uuid")
      )
    ).toHaveLength(2);
  });

  it("cancels a pending deployment before rolling back", async () => {
    const harness = makeHarness({ failureMode: "timeout" });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "deployment_timeout"
    );
    expect(harness.state.cancelledDeployment).toBe("server-deployment-1");
    expect(harness.state.sha.server).toBe(previousSha);
  });

  it("accepts a cancellation race when the deployment finished before the cancel request", async () => {
    const harness = makeHarness({
      cancelRaceFinished: true,
      failureMode: "timeout",
    });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "deployment_timeout"
    );
    expect(harness.state.sha.server).toBe(previousSha);
  });

  it("reports incomplete rollback when exact rollback identity cannot be acknowledged", async () => {
    const harness = makeHarness({
      failRole: "web",
      failureMode: "public",
      rollbackPatchFails: true,
    });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "rollback_incomplete"
    );
  });

  it("fails closed on an unreachable GitHub main readback", async () => {
    const harness = makeHarness({ mainTransportFails: true });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "main_readback_failed"
    );
  });

  it("fails closed when deployment detail reports the wrong SHA", async () => {
    const harness = makeHarness({ failureMode: "wrong-sha" });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "deployment_sha_mismatch"
    );
    expect(harness.state.cancelledDeployment).toBe("server-deployment-1");
    expect(harness.state.sha.server).toBe(previousSha);
  });

  it("requires one trusted baseline across configured and finished identities", async () => {
    const harness = makeHarness({ baselineMismatch: true });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "baseline_mismatch"
    );
    expect(harness.state.calls.some(({ method }) => method === "PATCH")).toBe(
      false
    );
  });

  it("rejects a cross-origin dashboard login redirect", async () => {
    const harness = makeHarness({
      dashboardLocation: "https://evil.test/login",
    });

    await expect(runCoolifyDeploy(harness.config)).rejects.toThrow(
      "web_readback_failed"
    );
    expect(harness.state.sha.server).toBe(previousSha);
  });

  it("fails closed when the absolute deadline cannot preserve rollback time", async () => {
    const harness = makeHarness();
    let clock = 0;
    const config = {
      ...harness.config,
      deadlineMs: 3000,
      nowImpl: () => {
        clock += 500;
        return clock;
      },
      rollbackReserveMs: 1000,
    } as const;

    await expect(runCoolifyDeploy(config)).rejects.toThrow(
      "deployment_deadline_exhausted"
    );
    expect(harness.state.calls.some(({ method }) => method === "PATCH")).toBe(
      true
    );
    expect(harness.state.sha.server).toBe(candidateSha);
  });
});

describe("production Coolify rollback", () => {
  it("uses the newest finished runtime identity while ignoring older deployments", () => {
    expect(
      extractLatestFinishedDeploymentSha(
        [
          {
            commit: previousSha,
            created_at: "2026-09-10T12:00:00.000Z",
            status: "finished",
          },
          {
            commit: candidateSha,
            created_at: "2026-09-11T12:00:00.000Z",
            status: "finished",
          },
        ],
        "server"
      )
    ).toBe(candidateSha);
  });

  it("rolls back every mutated role in reverse sequence", () => {
    expect(DEPLOYMENT_ORDER).toEqual(["server", "web", "projector"]);
    expect(rollbackOrder(DEPLOYMENT_ORDER)).toEqual([
      "projector",
      "web",
      "server",
    ]);
  });

  it("selects exactly one deployment UUID for the mutated resource", () => {
    expect(
      extractDeploymentUuid(
        {
          deployments: [
            {
              deployment_uuid: "deployment-1234",
              resource_uuid: "server-uuid",
            },
          ],
        },
        "server-uuid"
      )
    ).toBe("deployment-1234");
    expect(() =>
      extractDeploymentUuid(
        {
          deployments: [
            { deployment_uuid: "deployment-1234", resource_uuid: "other-uuid" },
          ],
        },
        "server-uuid"
      )
    ).toThrow("deployment_identity_missing");
    expect(() =>
      extractDeploymentUuid(
        {
          deployments: [
            { deployment_uuid: "deployment-1", resource_uuid: "server-uuid" },
            { deployment_uuid: "deployment-2", resource_uuid: "server-uuid" },
          ],
        },
        "server-uuid"
      )
    ).toThrow("deployment_identity_missing");
  });
});
