import path from "node:path";

import {
  CONNECTOR_FIXTURE_CONTRACT_VERSION,
  type ConnectorFixture,
} from "../contract";
import type { RawContentType } from "../object-store";

const workspaceRoot = path.resolve(import.meta.dir, "../../../..");

export const fixturePath = (...segments: string[]): string =>
  path.join(workspaceRoot, "fixtures", "connectors", ...segments);

export const loadConnectorFixture = async <Payload>(
  relativePath: string
): Promise<ConnectorFixture & { payload: Payload }> => {
  const file = Bun.file(fixturePath(relativePath));
  const parsed = (await file.json()) as ConnectorFixture;
  if (parsed.contractVersion !== CONNECTOR_FIXTURE_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported fixture contract version: ${parsed.contractVersion}`
    );
  }
  return parsed as ConnectorFixture & { payload: Payload };
};

export const createFixtureEnvelope = (
  source: string,
  contentType: RawContentType,
  payload: unknown,
  capturedAt = "2026-08-28T10:00:00.000Z"
): ConnectorFixture => ({
  capturedAt,
  contentType,
  contractVersion: CONNECTOR_FIXTURE_CONTRACT_VERSION,
  payload,
  source,
});
