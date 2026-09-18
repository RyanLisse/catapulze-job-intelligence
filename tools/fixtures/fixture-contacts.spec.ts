import { describe, expect, it } from "bun:test";
import path from "node:path";

import { CONTACT_REDACTIONS } from "./record";

/**
 * AGENTS.md, "Adding a source": "Remove PII rather than replacing it with
 * plausible fake names." The repository is public, so a recruiter's work
 * address committed in a fixture is published a second time, in a context
 * the person never chose.
 *
 * `check-secrets` scans for credentials and says nothing about personal data,
 * and `fixtures-provenance.spec.ts` only vouches for capture time, so before
 * this guard nothing enforced the rule. It had already been missed twice.
 *
 * The patterns come from the recorder itself, so a fixture recorded by
 * `tools/fixtures/record.ts` passes here by construction and the two can
 * never drift apart.
 */

/** Reserved TLDs (RFC 2606/6761) and the null number cannot reach a person. */
const REDACTED_EMAIL_HOST =
  /@(?:[A-Za-z0-9.-]+\.)?(?:invalid|example|test|localhost)$/u;
const REDACTED_PHONE = "+31000000000";

const FIXTURES_ROOT = path.resolve(import.meta.dir, "../../fixtures");

const isRedacted = (label: string, match: string): boolean =>
  label === "email"
    ? REDACTED_EMAIL_HOST.test(match)
    : match === REDACTED_PHONE;

const findContacts = (
  text: string
): { readonly label: string; readonly match: string }[] => {
  const found: { label: string; match: string }[] = [];
  for (const { label, pattern } of CONTACT_REDACTIONS) {
    for (const [match] of text.matchAll(pattern)) {
      if (!isRedacted(label, match)) {
        found.push({ label, match });
      }
    }
  }
  return found;
};

describe("fixture contact redaction", () => {
  it("flags a live address and a Dutch number, and passes the redacted forms", () => {
    expect(
      findContacts(
        "Bel Mathijs via 0183-516254 of m.vuister@gemeentealtena.nl."
      )
    ).toEqual([
      { label: "email", match: "m.vuister@gemeentealtena.nl" },
      { label: "phone", match: "0183-516254" },
    ]);
    expect(
      findContacts("Bel via +31000000000 of redacted@example.invalid.")
    ).toEqual([]);
  });

  it("leaves decimals alone", () => {
    // A dot is not a Dutch phone separator. Admitting one matched 253
    // Striive listing scores such as `05.185353`.
    expect(findContacts("score 05.185353 en 01.430431")).toEqual([]);
  });

  it("has no unredacted contact detail in any committed fixture", async () => {
    const filePaths: string[] = [];
    for await (const filePath of new Bun.Glob("**/*.json").scan({
      absolute: true,
      cwd: FIXTURES_ROOT,
    })) {
      filePaths.push(filePath);
    }
    const scanned = await Promise.all(
      filePaths.map(async (filePath) => {
        const found = findContacts(await Bun.file(filePath).text());
        if (found.length === 0) {
          return null;
        }
        const relative = path.relative(FIXTURES_ROOT, filePath);
        return `${relative}: ${found.map(({ label, match }) => `${label} ${match}`).join(", ")}`;
      })
    );
    const offenders = scanned.filter((offender) => offender !== null);

    expect(offenders, offenders.join("\n")).toEqual([]);
  }, 30_000);
});
