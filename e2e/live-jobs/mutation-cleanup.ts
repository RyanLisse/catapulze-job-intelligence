import type { APIRequestContext, TestInfo } from "@playwright/test";

import type { MutationLiveJobsConfig } from "./config";

export interface MutationResource {
  readonly id: string;
  readonly kind: "markering" | "saved-search" | "snapshot";
}

interface CleanupLiveJobsInput {
  readonly attachReceipt: boolean;
  readonly config: MutationLiveJobsConfig;
  readonly request: APIRequestContext;
  readonly resources: readonly MutationResource[];
  readonly testInfo: TestInfo;
}

type CleanupFetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

const cleanupHeaders = (cleanupToken: string) => ({
  Authorization: `Bearer ${cleanupToken}`,
  "Content-Type": "application/json",
});

const cleanupPayload = (
  config: MutationLiveJobsConfig,
  resources: readonly MutationResource[]
) => ({
  accountId: config.testAccountId,
  namespace: config.testNamespace,
  resources,
});

/**
 * Verifies that the dedicated cleanup endpoint accepts the idempotent no-op
 * shape before Playwright can perform a browser mutation.
 */
export const preflightLiveJobsCleanup = async (
  config: MutationLiveJobsConfig,
  fetcher: CleanupFetcher = fetch
): Promise<void> => {
  let response: Response;
  try {
    response = await fetcher(config.cleanupUrl, {
      body: JSON.stringify(cleanupPayload(config, [])),
      headers: cleanupHeaders(config.cleanupToken),
      method: "POST",
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Isolated live-jobs cleanup preflight could not reach its endpoint; no browser writes were attempted."
    );
  }

  if (response.status !== 204) {
    throw new Error(
      `Isolated live-jobs cleanup preflight did not receive exact HTTP 204 (got ${response.status}); no browser writes were attempted.`
    );
  }
};

/**
 * The product intentionally has no public delete APIs for these records.
 * Mutation runs therefore require a separately provisioned, same-origin
 * isolated-environment endpoint that makes this cleanup idempotent.
 */
export const cleanupLiveJobsMutations = async ({
  attachReceipt,
  config,
  request,
  resources,
  testInfo,
}: CleanupLiveJobsInput): Promise<void> => {
  const response = await request.post(config.cleanupUrl, {
    data: cleanupPayload(config, resources),
    headers: cleanupHeaders(config.cleanupToken),
    maxRedirects: 0,
  });

  if (response.status() !== 204) {
    throw new Error(
      `Isolated live-jobs cleanup did not receive exact HTTP 204 (got ${response.status()}).`
    );
  }

  if (!attachReceipt) {
    return;
  }

  await testInfo.attach("cleanup-receipt.json", {
    body: JSON.stringify(
      {
        namespace: config.testNamespace,
        resourceKinds: resources.map((resource) => resource.kind),
        status: response.status(),
      },
      null,
      2
    ),
    contentType: "application/json",
  });
};
