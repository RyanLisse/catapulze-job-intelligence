import { describe, expect, it } from "bun:test";

import {
  MOTIAN_V1_BRON_BINDINGS,
  MOTIAN_V1_PLATFORMS,
  normalizeMotianPlatform,
  resolveMotianV1Binding,
} from "./motian-v1-bindings";

describe("Motian v1 platform bindings", () => {
  it("defines exactly seven Motian Neon platforms", () => {
    expect(MOTIAN_V1_PLATFORMS).toEqual([
      "nationalevacaturebank",
      "opdrachtoverheid",
      "mipublic",
      "flextender",
      "striive",
      "werkzoeken",
      "starapple-nl",
    ]);
    expect(MOTIAN_V1_BRON_BINDINGS).toHaveLength(7);
  });

  it("maps each platform slug to a stable bron_id", () => {
    for (const platform of MOTIAN_V1_PLATFORMS) {
      const binding = resolveMotianV1Binding(MOTIAN_V1_BRON_BINDINGS, platform);
      expect(binding?.platform).toBe(platform);
      expect(binding?.bronId).toMatch(
        /^00000000-0000-4000-8000-00000000003[0-6]$/u
      );
    }
  });

  it("normalizes legacy starapple slug to starapple-nl", () => {
    expect(normalizeMotianPlatform("starapple")).toBe("starapple-nl");
    const binding = resolveMotianV1Binding(
      MOTIAN_V1_BRON_BINDINGS,
      "starapple"
    );
    expect(binding?.platform).toBe("starapple-nl");
  });
});
