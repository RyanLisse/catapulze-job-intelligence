import type { Buffer } from "node:buffer";

import type {
  ConsoleMessage,
  Page,
  Request,
  Response,
  TestInfo,
} from "@playwright/test";

import { isCanaryScreenshotAttestation } from "./canary";
import type { CanaryScreenshotAttestation } from "./canary";

export interface RouteExpectation {
  readonly label: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

interface RawNetworkEvent {
  readonly kind:
    | "request"
    | "request-auth-violation"
    | "request-failed"
    | "response";
  readonly method: string;
  readonly redirected?: boolean;
  readonly status?: number;
  readonly url: string;
}

interface NetworkEvent {
  readonly kind: RawNetworkEvent["kind"];
  readonly method: string;
  readonly path: string;
  readonly redirected?: boolean;
  readonly status?: number;
}

export interface CapabilityRequestObservation {
  readonly method: string;
  readonly path: string;
}

interface BrowserFailure {
  readonly kind:
    | "auth-header"
    | "console"
    | "http"
    | "page"
    | "redirect"
    | "request";
  readonly path?: string;
  readonly status?: number;
}

export interface SanitizedCleanupReceipt {
  readonly namespace: string;
  readonly resourceKinds: readonly string[];
  readonly status: number;
}

interface EvidenceRoutePolicy {
  readonly expectations: readonly RouteExpectation[];
  readonly screenshotAttestation?: CanaryScreenshotAttestation;
}

interface PassedEvidenceOptions {
  readonly cleanupReceipt?: SanitizedCleanupReceipt;
  readonly releaseSha: string;
  readonly screenshotAttestation?: CanaryScreenshotAttestation;
}

const SAFE_CAPABILITY_PATHS = new Set([
  "/v1/aanvragen/batch",
  "/v1/aanvragen/search",
  "/v1/bronnen",
  "/v1/saved-searches",
  "/v1/snapshots",
]);

export const assertAllowedCapabilityRequests = (
  requests: readonly CapabilityRequestObservation[],
  allowlist: readonly RouteExpectation[]
): void => {
  const unexpected = requests.filter(
    (request) =>
      request.path.startsWith("/v1/") &&
      !allowlist.some(
        (allowed) =>
          allowed.method === request.method && allowed.path === request.path
      )
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Live jobs E2E observed capability requests outside its exact allowlist: ${unexpected
        .map((request) => `${request.method} ${request.path}`)
        .join(", ")}.`
    );
  }
};

const sanitizePath = (pathname: string): string => {
  if (/^\/v1\/raw\/[^/]+$/u.test(pathname)) {
    return "/v1/raw/:ref";
  }
  if (/^\/v1\/aanvragen\/[^/]+\/versies$/u.test(pathname)) {
    return "/v1/aanvragen/:id/versies";
  }
  if (/^\/v1\/aanvragen\/[^/]+\/markering$/u.test(pathname)) {
    return "/v1/aanvragen/:id/markering";
  }
  if (/^\/v1\/aanvragen\/[^/]+$/u.test(pathname)) {
    return "/v1/aanvragen/:id";
  }
  if (SAFE_CAPABILITY_PATHS.has(pathname)) {
    return pathname;
  }
  if (pathname.startsWith("/v1/")) {
    return "/v1/:unexpected";
  }
  return pathname;
};

const parseTrackedUrl = (value: string, webOrigin: string): URL | null => {
  try {
    const parsed = new URL(value);
    if (
      parsed.pathname.startsWith("/v1/") ||
      (parsed.origin === webOrigin && parsed.pathname === "/jobs")
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const assertExactDynamicIdentity = (
  url: URL,
  screenshotAttestation?: CanaryScreenshotAttestation
): void => {
  const isDynamicCanaryPath =
    /^\/v1\/aanvragen\/[^/]+(?:\/versies|\/markering)?$/u.test(url.pathname);
  const isRawPath = /^\/v1\/raw\/[^/]+$/u.test(url.pathname);
  if (!(isDynamicCanaryPath || isRawPath)) {
    return;
  }
  if (!screenshotAttestation) {
    throw new Error(
      "Live jobs E2E could not validate a dynamic capability route against its canary attestation."
    );
  }

  const canaryPath = `/v1/aanvragen/${encodeURIComponent(screenshotAttestation.canaryId)}`;
  let expectedPath = canaryPath;
  if (isRawPath) {
    expectedPath = `/v1/raw/${encodeURIComponent(screenshotAttestation.rawPayloadRef)}`;
  } else if (url.pathname.endsWith("/versies")) {
    expectedPath = `${canaryPath}/versies`;
  } else if (url.pathname.endsWith("/markering")) {
    expectedPath = `${canaryPath}/markering`;
  }
  if (url.pathname !== expectedPath) {
    throw new Error(
      "Live jobs E2E observed a dynamic capability route for a different canary identity."
    );
  }
};

const sanitizeValidatedNetworkEvents = (
  rawEvents: readonly RawNetworkEvent[],
  apiOrigin: string,
  webOrigin: string,
  policy: EvidenceRoutePolicy
): readonly NetworkEvent[] => {
  const sanitized = rawEvents.map((event): NetworkEvent => {
    const url = new URL(event.url);
    if (url.pathname.startsWith("/v1/")) {
      if (url.origin !== apiOrigin) {
        throw new Error(
          "Live jobs E2E observed a capability route outside the configured API origin."
        );
      }
      assertExactDynamicIdentity(url, policy.screenshotAttestation);
    } else if (url.origin !== webOrigin || url.pathname !== "/jobs") {
      throw new Error(
        "Live jobs E2E observed a tracked browser route outside the configured web origin."
      );
    }
    return {
      kind: event.kind,
      method: event.method,
      path: sanitizePath(url.pathname),
      redirected: event.redirected,
      status: event.status,
    };
  });

  assertAllowedCapabilityRequests(
    sanitized.filter(
      (event): event is NetworkEvent & CapabilityRequestObservation =>
        event.kind === "request"
    ),
    policy.expectations
  );
  return sanitized;
};

const isCallerRoleHeader = (name: string): boolean => {
  const normalized = name.toLowerCase();
  return (
    normalized === "role" ||
    normalized.endsWith("-role") ||
    normalized.includes("caller-role") ||
    normalized.includes("recruiter-role") ||
    normalized.includes("user-role")
  );
};

const isLegacyRoleBearer = (value: string): boolean =>
  /^Bearer\s+(?:recruiter|operator|admin|approver):/iu.test(value);

const assertNoBrowserFailureEvents = (
  browserFailures: readonly BrowserFailure[]
): void => {
  if (browserFailures.length === 0) {
    return;
  }
  const summary = browserFailures
    .map((failure) => {
      const status = failure.status ? ` ${failure.status}` : "";
      const path = failure.path ? ` ${failure.path}` : "";
      return failure.kind + status + path;
    })
    .join(", ");
  throw new Error(
    `Live jobs E2E observed browser, auth-header, redirect, CORS, or HTTP failures: ${summary}.`
  );
};

export const hasForbiddenBrowserAuthHeader = (
  headers: Readonly<Record<string, string>>
): boolean =>
  Object.entries(headers).some(
    ([name, headerValue]) =>
      isCallerRoleHeader(name) ||
      (name.toLowerCase() === "authorization" &&
        isLegacyRoleBearer(headerValue))
  );

export class LiveJobsEvidence {
  private readonly apiOrigin: string;
  private readonly browserFailures: BrowserFailure[] = [];
  private frozen = false;
  private readonly networkEvents: RawNetworkEvent[] = [];
  private readonly page: Page;
  private readonly pendingRequests = new Set<Request>();
  private routePolicy: EvidenceRoutePolicy | null = null;
  private readonly webOrigin: string;

  constructor(page: Page, baseUrl: string, apiUrl: string) {
    this.apiOrigin = new URL(apiUrl).origin;
    this.page = page;
    this.webOrigin = new URL(baseUrl).origin;

    page.on("console", this.onConsole);
    page.on("pageerror", this.onPageError);
    page.on("request", this.onRequest);
    page.on("requestfailed", this.onRequestFailed);
    page.on("requestfinished", this.onRequestFinished);
    page.on("response", this.onResponse);
  }

  private readonly onConsole = (message: ConsoleMessage): void => {
    if (message.type() === "error") {
      this.browserFailures.push({ kind: "console" });
    }
  };

  private readonly onPageError = (): void => {
    this.browserFailures.push({ kind: "page" });
  };

  private readonly onRequest = (request: Request): void => {
    this.pendingRequests.add(request);
    const target = parseTrackedUrl(request.url(), this.webOrigin);
    if (!target) {
      return;
    }
    this.networkEvents.push({
      kind: "request",
      method: request.method(),
      url: target.href,
    });
    if (!hasForbiddenBrowserAuthHeader(request.headers())) {
      return;
    }
    this.networkEvents.push({
      kind: "request-auth-violation",
      method: request.method(),
      url: target.href,
    });
    this.browserFailures.push({
      kind: "auth-header",
      path: sanitizePath(target.pathname),
    });
  };

  private readonly onRequestFailed = (request: Request): void => {
    this.pendingRequests.delete(request);
    const target = parseTrackedUrl(request.url(), this.webOrigin);
    if (!target) {
      return;
    }
    this.networkEvents.push({
      kind: "request-failed",
      method: request.method(),
      url: target.href,
    });
    this.browserFailures.push({
      kind: "request",
      path: sanitizePath(target.pathname),
    });
  };

  private readonly onRequestFinished = (request: Request): void => {
    this.pendingRequests.delete(request);
  };

  private readonly onResponse = (response: Response): void => {
    const target = parseTrackedUrl(response.url(), this.webOrigin);
    if (!target) {
      return;
    }
    const redirected =
      (response.status() >= 300 && response.status() < 400) ||
      response.request().redirectedFrom() !== null;
    this.networkEvents.push({
      kind: "response",
      method: response.request().method(),
      redirected,
      status: response.status(),
      url: target.href,
    });
    if (redirected) {
      this.browserFailures.push({
        kind: "redirect",
        path: sanitizePath(target.pathname),
        status: response.status(),
      });
    } else if (response.status() >= 400) {
      this.browserFailures.push({
        kind: "http",
        path: sanitizePath(target.pathname),
        status: response.status(),
      });
    }
  };

  private detachListeners(): void {
    this.page.off("console", this.onConsole);
    this.page.off("pageerror", this.onPageError);
    this.page.off("request", this.onRequest);
    this.page.off("requestfailed", this.onRequestFailed);
    this.page.off("requestfinished", this.onRequestFinished);
    this.page.off("response", this.onResponse);
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new Error("Live jobs E2E evidence was already finalized.");
    }
  }

  assertObservedRoutes(
    expectations: readonly RouteExpectation[],
    screenshotAttestation?: CanaryScreenshotAttestation
  ): void {
    this.assertMutable();
    this.routePolicy = {
      expectations: Object.freeze(
        expectations.map((expectation) => Object.freeze({ ...expectation }))
      ),
      screenshotAttestation,
    };
    const events = sanitizeValidatedNetworkEvents(
      this.networkEvents,
      this.apiOrigin,
      this.webOrigin,
      this.routePolicy
    );
    const missing = expectations.filter(
      (expectation) =>
        !events.some(
          (event) =>
            event.kind === "response" &&
            event.method === expectation.method &&
            event.path === expectation.path &&
            event.status === expectation.status &&
            !event.redirected
        )
    );
    if (missing.length > 0) {
      throw new Error(
        `Live jobs E2E did not observe exact successful routes: ${missing
          .map(
            (expectation) =>
              `${expectation.label} (${expectation.method} ${expectation.path} -> ${expectation.status})`
          )
          .join(", ")}.`
      );
    }
  }

  assertNoCapabilityRequests(): void {
    this.assertMutable();
    this.routePolicy = { expectations: [] };
    const events = sanitizeValidatedNetworkEvents(
      this.networkEvents,
      this.apiOrigin,
      this.webOrigin,
      this.routePolicy
    );
    const requests = events.filter(
      (event) => event.kind === "request" && event.path.startsWith("/v1/")
    );
    if (requests.length > 0) {
      throw new Error(
        `Anonymous live jobs E2E observed protected REST calls: ${requests
          .map((event) => `${event.method} ${event.path}`)
          .join(", ")}.`
      );
    }
  }

  assertNoBrowserFailures(): void {
    assertNoBrowserFailureEvents(this.browserFailures);
  }

  /**
   * Capture the fully masked screenshot first, then close the page to force
   * every request to finish or fail. Only a complete, frozen event snapshot is
   * validated and published through one final attachment operation.
   */
  async attachPassed(
    testInfo: TestInfo,
    page: Page,
    options: PassedEvidenceOptions
  ): Promise<void> {
    this.assertMutable();
    if (page !== this.page || page.isClosed()) {
      throw new Error(
        "Live jobs E2E cannot finalize evidence from a different or closed browser page."
      );
    }
    if (!this.routePolicy) {
      throw new Error(
        "Live jobs E2E cannot attach evidence before a capability route policy is asserted."
      );
    }

    let screenshot: Buffer | null = null;
    if (options.screenshotAttestation) {
      if (
        !isCanaryScreenshotAttestation(options.screenshotAttestation) ||
        this.routePolicy.screenshotAttestation !== options.screenshotAttestation
      ) {
        throw new Error(
          "Live jobs E2E refused a screenshot without its validated server-response canary attestation."
        );
      }
      const url = new URL(page.url());
      if (
        url.origin !== this.webOrigin ||
        url.pathname !== "/jobs" ||
        url.searchParams.get("job") !==
          options.screenshotAttestation.canaryId ||
        (await page.getByLabel("Zoekresultaten").count()) !== 1 ||
        (await page.locator("pre").count()) === 0
      ) {
        throw new Error(
          "Live jobs E2E refused to create a screenshot that is not an exact canary detail."
        );
      }
      screenshot = await page.screenshot({
        fullPage: true,
        mask: [page.locator("body")],
      });
    }

    await page.close({ runBeforeUnload: false });
    if (!page.isClosed() || this.pendingRequests.size > 0) {
      throw new Error(
        "Live jobs E2E could not prove a closed page with no pending network requests; no artifact was written."
      );
    }
    this.detachListeners();
    this.frozen = true;

    const frozenEvents = Object.freeze(
      this.networkEvents.map((event) => Object.freeze({ ...event }))
    );
    const frozenFailures = Object.freeze(
      this.browserFailures.map((failure) => Object.freeze({ ...failure }))
    );
    const sanitizedEvents = sanitizeValidatedNetworkEvents(
      frozenEvents,
      this.apiOrigin,
      this.webOrigin,
      this.routePolicy
    );
    assertNoBrowserFailureEvents(frozenFailures);

    const attachments: unknown[] = [
      {
        body: { networkEvents: sanitizedEvents },
        contentType: "application/json",
        name: "network-evidence.json",
      },
    ];
    if (screenshot) {
      attachments.push({
        bodyBase64: screenshot.toString("base64"),
        contentType: "image/png",
        name: "canary-sanitized.png",
      });
    }
    if (options.cleanupReceipt) {
      attachments.push({
        body: options.cleanupReceipt,
        contentType: "application/json",
        name: "cleanup-receipt.json",
      });
    }
    attachments.push({
      body: {
        artifactPolicy: {
          automatedScreenshots: "off",
          traces: "off",
          video: "off",
        },
        releaseSha: options.releaseSha,
        status: "passed",
      },
      contentType: "application/json",
      name: "pass-manifest.json",
    });

    await testInfo.attach("live-jobs-evidence-bundle.json", {
      body: JSON.stringify({ attachments }, null, 2),
      contentType: "application/json",
    });
  }
}
