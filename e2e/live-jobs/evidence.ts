import type { Buffer } from "node:buffer";

import type { Page, TestInfo } from "@playwright/test";

import { isCanaryScreenshotAttestation } from "./canary";
import type { CanaryScreenshotAttestation } from "./canary";

export interface RouteExpectation {
  readonly label: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

interface NetworkEvent {
  readonly kind:
    | "request"
    | "request-auth-violation"
    | "request-failed"
    | "response";
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

interface TrackedUrl {
  readonly path: string;
  readonly tracked: boolean;
}

type PassedEvidenceOptions =
  | {
      readonly releaseSha: string;
      readonly screenshotAttestation: CanaryScreenshotAttestation;
    }
  | {
      readonly releaseSha: string;
      readonly screenshotAttestation?: never;
    };

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

const parseTrackedUrl = (value: string, webOrigin: string): TrackedUrl => {
  try {
    const parsed = new URL(value);
    const tracked =
      parsed.pathname.startsWith("/v1/") ||
      (parsed.origin === webOrigin && parsed.pathname === "/jobs");
    return { path: sanitizePath(parsed.pathname), tracked };
  } catch {
    return { path: "/", tracked: false };
  }
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

/**
 * The browser client must use only Better Auth cookies. The check records a
 * boolean violation, never the header name/value or any cookie.
 */
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
  private readonly browserFailures: BrowserFailure[] = [];
  private readonly networkEvents: NetworkEvent[] = [];
  private routeAllowlist: readonly RouteExpectation[] | null = null;
  private readonly webOrigin: string;

  constructor(page: Page, baseUrl: string) {
    this.webOrigin = new URL(baseUrl).origin;

    page.on("console", (message) => {
      if (message.type() === "error") {
        this.browserFailures.push({ kind: "console" });
      }
    });
    page.on("pageerror", () => {
      this.browserFailures.push({ kind: "page" });
    });
    page.on("request", (request) => {
      const target = parseTrackedUrl(request.url(), this.webOrigin);
      if (!target.tracked) {
        return;
      }
      this.networkEvents.push({
        kind: "request",
        method: request.method(),
        path: target.path,
      });
      if (!hasForbiddenBrowserAuthHeader(request.headers())) {
        return;
      }
      this.networkEvents.push({
        kind: "request-auth-violation",
        method: request.method(),
        path: target.path,
      });
      this.browserFailures.push({ kind: "auth-header", path: target.path });
    });
    page.on("requestfailed", (request) => {
      const target = parseTrackedUrl(request.url(), this.webOrigin);
      if (!target.tracked) {
        return;
      }
      this.networkEvents.push({
        kind: "request-failed",
        method: request.method(),
        path: target.path,
      });
      this.browserFailures.push({ kind: "request", path: target.path });
    });
    page.on("response", (response) => {
      const target = parseTrackedUrl(response.url(), this.webOrigin);
      if (!target.tracked) {
        return;
      }
      const redirected =
        (response.status() >= 300 && response.status() < 400) ||
        response.request().redirectedFrom() !== null;
      const event: NetworkEvent = {
        kind: "response",
        method: response.request().method(),
        path: target.path,
        redirected,
        status: response.status(),
      };
      this.networkEvents.push(event);
      if (redirected) {
        this.browserFailures.push({
          kind: "redirect",
          path: target.path,
          status: response.status(),
        });
      } else if (response.status() >= 400) {
        this.browserFailures.push({
          kind: "http",
          path: target.path,
          status: response.status(),
        });
      }
    });
  }

  assertObservedRoutes(expectations: readonly RouteExpectation[]): void {
    this.routeAllowlist = expectations;
    this.assertOnlyAllowlistedCapabilityRequests();
    const missing = expectations.filter(
      (expectation) =>
        !this.networkEvents.some(
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
              `${expectation.label} (${expectation.method} ${
                expectation.path
              } -> ${expectation.status})`
          )
          .join(", ")}.`
      );
    }
  }

  private assertOnlyAllowlistedCapabilityRequests(): void {
    if (!this.routeAllowlist) {
      throw new Error(
        "Live jobs E2E cannot attach evidence before a capability route policy is asserted."
      );
    }
    assertAllowedCapabilityRequests(
      this.networkEvents.filter(
        (event): event is NetworkEvent & CapabilityRequestObservation =>
          event.kind === "request"
      ),
      this.routeAllowlist
    );
  }

  assertNoCapabilityRequests(): void {
    this.routeAllowlist = [];
    const requests = this.networkEvents.filter(
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
    if (this.browserFailures.length === 0) {
      return;
    }
    const summary = this.browserFailures
      .map((failure) => {
        const status = failure.status ? ` ${failure.status}` : "";
        const path = failure.path ? ` ${failure.path}` : "";
        return failure.kind + status + path;
      })
      .join(", ");
    throw new Error(
      `Live jobs E2E observed browser, auth-header, redirect, CORS, or HTTP failures: ${
        summary
      }.`
    );
  }

  /**
   * Attach only after all behavior assertions passed. An authenticated
   * screenshot additionally requires the runtime attestation produced from a
   * pinned-digest server response. All application content is masked so the
   * image cannot retain an account identity or any response-derived field.
   */
  async attachPassed(
    testInfo: TestInfo,
    page: Page,
    options: PassedEvidenceOptions
  ): Promise<void> {
    this.assertNoBrowserFailures();
    this.assertOnlyAllowlistedCapabilityRequests();
    if (page.isClosed()) {
      throw new Error(
        "Live jobs E2E cannot write a pass manifest from a closed browser page."
      );
    }

    const sanitizedEvidence = JSON.stringify(
      { networkEvents: this.networkEvents },
      null,
      2
    );
    const passManifest = JSON.stringify(
      {
        artifactPolicy: {
          automatedScreenshots: "off",
          traces: "off",
          video: "off",
        },
        releaseSha: options.releaseSha,
        status: "passed",
      },
      null,
      2
    );
    let screenshot: Buffer | null = null;
    if (options.screenshotAttestation) {
      if (!isCanaryScreenshotAttestation(options.screenshotAttestation)) {
        throw new Error(
          "Live jobs E2E refused a screenshot without a server-response canary attestation."
        );
      }
      const url = new URL(page.url());
      if (
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

    await testInfo.attach("network-evidence.json", {
      body: sanitizedEvidence,
      contentType: "application/json",
    });
    if (screenshot) {
      await testInfo.attach("canary-sanitized.png", {
        body: screenshot,
        contentType: "image/png",
      });
    }
    await testInfo.attach("pass-manifest.json", {
      body: passManifest,
      contentType: "application/json",
    });
  }
}
