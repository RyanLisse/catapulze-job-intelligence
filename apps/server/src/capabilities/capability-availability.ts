export const CAPABILITY_UNAVAILABLE_CODE = "CAPABILITY_DISABLED";

export type CapabilityAvailabilityPolicy = ReadonlyMap<string, string>;

export const PRODUCTION_UNAVAILABLE_CAPABILITIES: CapabilityAvailabilityPolicy =
  new Map([
    [
      "commit_export",
      "Export is unavailable until a production export provider is connected",
    ],
    [
      "complete_task",
      "Task completion is unavailable until it records durable completion",
    ],
    [
      "start_run",
      "Run dispatch is unavailable until it uses a durable dispatcher",
    ],
    [
      "start_test_import",
      "Test import dispatch is unavailable until it uses a durable dispatcher",
    ],
  ]);

export const unavailableCapabilityReason = (
  policy: CapabilityAvailabilityPolicy | undefined,
  capabilityId: string
): string | undefined => policy?.get(capabilityId);
