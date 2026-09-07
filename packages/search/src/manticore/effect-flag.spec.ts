import { afterEach, describe, expect, it } from "bun:test";

import { isEffectSearchEnabled } from "./effect-flag";

afterEach(() => {
  delete process.env.JI_EFFECT_SEARCH;
});

describe("isEffectSearchEnabled (CTP-479)", () => {
  it("defaults OFF", () => {
    delete process.env.JI_EFFECT_SEARCH;
    expect(isEffectSearchEnabled()).toBe(false);
  });

  it("enables only for exact 1", () => {
    process.env.JI_EFFECT_SEARCH = "1";
    expect(isEffectSearchEnabled()).toBe(true);
    process.env.JI_EFFECT_SEARCH = "0";
    expect(isEffectSearchEnabled()).toBe(false);
  });
});
