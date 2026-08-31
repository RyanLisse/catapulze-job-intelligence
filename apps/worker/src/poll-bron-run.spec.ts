import { describe, expect, it } from "bun:test";

import {
  requireDatabaseUrl,
  requireManticoreUrl,
  resolveTenderNedTestImportDays,
} from "./poll-bron-env";

describe("poll-bron runtime guards", () => {
  it("requires DATABASE_URL", () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(() => requireDatabaseUrl()).toThrow("DATABASE_URL is required");
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
  });

  it("requires MANTICORE_URL for outbox drain", () => {
    const previous = process.env.MANTICORE_URL;
    delete process.env.MANTICORE_URL;
    expect(() => requireManticoreUrl()).toThrow("MANTICORE_URL is required");
    if (previous === undefined) {
      delete process.env.MANTICORE_URL;
    } else {
      process.env.MANTICORE_URL = previous;
    }
  });
});

describe("TenderNed test-import window", () => {
  it("defaults to 14 days when unset", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
    try {
      expect(resolveTenderNedTestImportDays()).toBe(14);
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("defaults to 14 days when empty", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "";
    try {
      expect(resolveTenderNedTestImportDays()).toBe(14);
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("returns a configured integer", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "7";
    try {
      expect(resolveTenderNedTestImportDays()).toBe(7);
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("rejects zero", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "0";
    try {
      expect(() => resolveTenderNedTestImportDays()).toThrow("1-90");
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("rejects values above 90", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "91";
    try {
      expect(() => resolveTenderNedTestImportDays()).toThrow("1-90");
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("rejects non-numeric values", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "abc";
    try {
      expect(() => resolveTenderNedTestImportDays()).toThrow('received "abc"');
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("rejects fractional values", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "1.5";
    try {
      expect(() => resolveTenderNedTestImportDays()).toThrow('received "1.5"');
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });
});
