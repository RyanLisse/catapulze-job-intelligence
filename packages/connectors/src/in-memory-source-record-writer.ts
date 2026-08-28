import type { SourceRecordPointer, SourceRecordWriter } from "./object-store";

export class InMemorySourceRecordWriter implements SourceRecordWriter {
  readonly records: SourceRecordPointer[] = [];

  write(record: SourceRecordPointer): Promise<void> {
    const duplicate = this.records.find(
      (existing) =>
        existing.bronId === record.bronId &&
        existing.bronReferentie === record.bronReferentie
    );

    if (!duplicate) {
      this.records.push(record);
    }

    return Promise.resolve();
  }
}
