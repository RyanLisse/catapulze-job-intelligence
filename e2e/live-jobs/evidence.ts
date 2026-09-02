import type { Buffer } from "node:buffer";

import type { Page, TestInfo } from "@playwright/test";

export interface RouteExpectation {
  readonly label: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

interface NetworkEvent {
  readonly kind: "request-auth-violation" | "request-failed" | "response";
  readonly method: string;
  readonly path: string;
  readonly redirected?: boolean;
  readonly status?: number;
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
      readonly canaryId: string;
      readonly canaryScreenshot: true;
      readonly releaseSha: string;
    }
  | {
      readonly canaryScreenshot: false;
      readonly releaseSha: string;
    };

const sanitizePath = (pathname: string): string => {
  if (pathname.startsWith("/v1/raw/")) {
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
  return pathname;
};

const parseTrackedUrl = (
  value: string,
  apiOrigin: string,
  webOrigin: string
): TrackedUrl => {
  try {
    const parsed = new URL(value);
    const tracked =
      (parsed.origin === apiOrigin && parsed.pathname.startsWith("/v1/")) ||
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
  private readonly apiOrigin: string;
  private readonly browserFailures: BrowserFailure[] = [];
  private readonly networkEvents: NetworkEvent[] = [];
  private readonly webOrigin: string;

  constructor(page: Page, baseUrl: string, apiUrl: string) {
    this.apiOrigin = new URL(apiUrl).origin;
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
      const target = parseTrackedUrl(
        request.url(),
        this.apiOrigin,
        this.webOrigin
      );
      if (
        !target.tracked ||
        !hasForbiddenBrowserAuthHeader(request.headers())
      ) {
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
      const target = parseTrackedUrl(
        request.url(),
        this.apiOrigin,
        this.webOrigin
      );
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
      const target = parseTrackedUrl(
        response.url(),
        this.apiOrigin,
        this.webOrigin
      );
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

  assertNoCapabilityRequests(): void {
    const requests = this.networkEvents.filter((event) =>
      event.path.startsWith("/v1/")
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
   * Attach only after all behavior assertions passed. The screenshot masks the
   * results list and raw preview, so it can contain only the already-verified
   * canary detail. Failed runs deliberately write no harness attachment.
   */
  async attachPassed(
    testInfo: TestInfo,
    page: Page,
    options: PassedEvidenceOptions
  ): Promise<void> {
    this.assertNoBrowserFailures();
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
          traces: "see Playwright config",
          video: "off",
        },
        releaseSha: options.releaseSha,
        status: "passed",
      },
      null,
      2
    );
    let screenshot: Buffer | null = null;
    if (options.canaryScreenshot) {
      const url = new URL(page.url());
      if (
        url.pathname !== "/jobs" ||
        url.searchParams.get("job") !== options.canaryId ||
        (await page.getByLabel("Zoekresultaten").count()) !== 1 ||
        (await page.locator("pre").count()) === 0
      ) {
        throw new Error(
          "Live jobs E2E refused to create a screenshot that is not an exact canary detail."
        );
      }
      screenshot = await page.screenshot({
        fullPage: true,
        mask: [page.getByLabel("Zoekresultaten"), page.locator("pre")],
      });
    }

    await testInfo.attach("network-evidence.json", {
      body: sanitizedEvidence,
      contentType: "application/json",
    });
    if (screenshot) {
      await testInfo.attach("canary-verified.png", {
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
