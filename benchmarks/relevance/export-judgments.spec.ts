import { describe, expect, it } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  csvField,
  loadJudgmentQueries,
  sanitizeFormulaCell,
  toSnippet,
} from "./export-judgments";

describe("sanitizeFormulaCell", () => {
  it("prefixes a leading '=' with a quote so Excel treats it as text", () => {
    expect(sanitizeFormulaCell('=HYPERLINK("http://evil","click")')).toBe(
      '\'=HYPERLINK("http://evil","click")'
    );
  });

  it("prefixes leading +, -, and @ the same way", () => {
    expect(sanitizeFormulaCell("+1234")).toBe("'+1234");
    expect(sanitizeFormulaCell("-1234")).toBe("'-1234");
    expect(sanitizeFormulaCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("leaves plain text untouched", () => {
    expect(sanitizeFormulaCell("Senior Azure Operations Engineer")).toBe(
      "Senior Azure Operations Engineer"
    );
  });
});

describe("csvField", () => {
  it("leaves a plain field unescaped", () => {
    expect(csvField("azure")).toBe("azure");
  });

  it("quotes and doubles a field containing the delimiter", () => {
    expect(csvField("a;b")).toBe('"a;b"');
  });

  it("quotes and escapes a field containing a double quote", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toSnippet", () => {
  it("collapses internal whitespace and newlines to single spaces", () => {
    expect(toSnippet("hello   \n\n world")).toBe("hello world");
  });

  it("truncates to 200 chars with an ellipsis marker", () => {
    const long = "x".repeat(250);
    const result = toSnippet(long);
    expect(result.length).toBe(200);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves short text untouched", () => {
    expect(toSnippet("short text")).toBe("short text");
  });
});

describe("loadJudgmentQueries", () => {
  const queriesPath = path.join(import.meta.dirname, "queries.jsonl");

  it("parses the real queries.jsonl with the same shape run.ts requires", async () => {
    const queries = await loadJudgmentQueries(queriesPath);
    expect(queries.length).toBeGreaterThanOrEqual(35);
    const ids = new Set(queries.map((query) => query.id));
    expect(ids.size).toBe(queries.length);
    for (const query of queries) {
      expect(query.relevant.length).toBeGreaterThan(0);
      expect(query.hardNegatives.length).toBeGreaterThan(0);
    }
  });

  it("rejects a line with an unknown category via a clear error", async () => {
    const tmpPath = path.join(
      tmpdir(),
      `judg-bad-${crypto.randomUUID()}.jsonl`
    );
    await Bun.write(
      tmpPath,
      `${JSON.stringify({
        category: "not-a-real-category",
        hardNegatives: ["a"],
        id: "x",
        query: "x",
        relevant: ["a"],
      })}\n`
    );
    try {
      await expect(loadJudgmentQueries(tmpPath)).rejects.toThrow(
        /queries\.jsonl line 1/u
      );
    } finally {
      await rm(tmpPath, { force: true });
    }
  });
});

describe("export-judgments CLI (integration)", () => {
  it("writes a deterministic CSV + md pair and reruns byte-identical", async () => {
    const outA = path.join(
      tmpdir(),
      `judg-export-a-${crypto.randomUUID()}.csv`
    );
    const outB = path.join(
      tmpdir(),
      `judg-export-b-${crypto.randomUUID()}.csv`
    );
    const repoRoot = path.join(import.meta.dirname, "..", "..");
    try {
      const runOnce = (outPath: string) => {
        const proc = Bun.spawnSync(
          [
            "bun",
            "benchmarks/relevance/export-judgments.ts",
            "--out",
            outPath,
            "--pool-depth",
            "5",
          ],
          { cwd: repoRoot, stderr: "pipe", stdout: "pipe" }
        );
        expect(proc.exitCode).toBe(0);
      };
      runOnce(outA);
      runOnce(outB);

      const csvA = await readFile(outA, "utf-8");
      const csvB = await readFile(outB, "utf-8");
      expect(csvA).toBe(csvB);

      const lines = csvA.split("\n").filter((line) => line.length > 0);
      const [headerLine] = lines;
      expect(headerLine?.replace(/^﻿/u, "")).toBe(
        "query_id;category;query;filters_json;doc_id;bron;titel;snippet;current_label;grade;comment"
      );
      expect(lines.length).toBeGreaterThan(1);

      const mdA = await readFile(outA.replace(/\.csv$/u, ".md"), "utf-8");
      expect(mdA).toContain("# Relevance judgments");
    } finally {
      await rm(outA, { force: true });
      await rm(outB, { force: true });
      await rm(outA.replace(/\.csv$/u, ".md"), { force: true });
      await rm(outB.replace(/\.csv$/u, ".md"), { force: true });
    }
  });
});
