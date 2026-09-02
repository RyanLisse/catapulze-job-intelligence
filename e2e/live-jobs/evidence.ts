import type { Page, TestInfo } from "@playwright/test";

export interface RouteExpectation {
  readonly label: string;
  readonly method: string;
  readonly path: string;
}

interface NetworkEvent {
  readonly kind: "request-failed" | "response";
  readonly method: string;
  readonly path: string;
  readonly status?: number;
}

interface BrowserFailure {
  readonly kind: "console" | "http" | "page" | "request";
  readonly path?: string;
  readonly status?: number;
}

interface TrackedUrl {
  readonly path: string;
  readonly tracked: boolean;
}

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
      const event: NetworkEvent = {
        kind: "response",
        method: response.request().method(),
        path: target.path,
        status: response.status(),
      };
      this.networkEvents.push(event);
      if (response.status() >= 400) {
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
            event.status !== undefined &&
            event.status < 400
        )
    );
    if (missing.length > 0) {
      throw new Error(
        `Live jobs E2E did not observe: ${missing
          .map(
            (expectation) =>
              `${expectation.label} (${expectation.method} ${expectation.path})`
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
        return `${failure.kind}${status}${path}`;
      })
      .join(", ");
    throw new Error(
      `Live jobs E2E observed browser, CORS, or HTTP failures: ${summary}.`
    );
  }

  async attach(testInfo: TestInfo, page: Page): Promise<void> {
    await testInfo.attach("network-evidence.json", {
      body: JSON.stringify(
        {
          apiOrigin: this.apiOrigin,
          browserFailures: this.browserFailures,
          networkEvents: this.networkEvents,
          webOrigin: this.webOrigin,
        },
        null,
        2
      ),
      contentType: "application/json",
    });
    if (!page.isClosed()) {
      await testInfo.attach("jobs-live.png", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  }
}
