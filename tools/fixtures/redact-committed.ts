/**
 * Applies the recorder's contact redaction to fixtures that are already
 * committed, for recordings made before redaction was a default.
 *
 * Re-recording is the better fix when it is available, because it produces a
 * fresh capture with honest provenance. It is not always available: the raw
 * response lives in a temp dir that is long gone, and a new capture returns
 * different vacancies, which moves every count a spec asserts. This tool is
 * the alternative that keeps `capturedAt`, the vacancies and the assertions
 * intact while removing the contact details.
 *
 * It reuses `redactContacts` rather than restating the patterns, so a fixture
 * repaired here is byte-identical to one the recorder would have produced.
 *
 * Usage:
 *   bun tools/fixtures/redact-committed.ts <fixture.json>...
 */
import { redactContactsInJson } from "./record";

const formatCounts = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}×${count}`)
    .join(", ");

const redactFixture = async (file: string): Promise<string> => {
  const fixture = JSON.parse(await Bun.file(file).text());
  const { counts, value } = redactContactsInJson(fixture.payload);
  const summary = formatCounts(counts);
  if (!summary) {
    return `${file}: nothing to redact`;
  }

  const note = `Contact details redacted mechanically by tools/fixtures/redact-committed.ts using the tools/fixtures/record.ts patterns (${summary}).`;
  await Bun.write(
    file,
    `${JSON.stringify(
      {
        ...fixture,
        captureNote: fixture.captureNote
          ? `${fixture.captureNote} ${note}`
          : note,
        payload: value,
      },
      null,
      2
    )}\n`
  );
  return `${file}: ${summary}`;
};

if (import.meta.main) {
  const files = Bun.argv.slice(2);
  if (files.length === 0) {
    throw new Error("pass one or more fixture JSON paths");
  }
  for (const line of await Promise.all(files.map(redactFixture))) {
    console.log(line);
  }
}

export { redactFixture };
