/**
 * Per-key mutation-version ownership for in-memory stores.
 *
 * A later mutation bumps the version so an earlier overlapping mutation cannot
 * commit or roll back after it has been superseded. Failed rollbacks must restore
 * the last committed baseline (not another mutation's provisional write).
 */
export interface MutationOwnership {
  readonly key: string;
  readonly version: number;
}

export class MutationVersionGate {
  private readonly versions = new Map<string, number>();

  begin(key: string): MutationOwnership {
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    return { key, version };
  }

  owns(ownership: MutationOwnership): boolean {
    return this.versions.get(ownership.key) === ownership.version;
  }
}
