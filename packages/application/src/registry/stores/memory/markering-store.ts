import type { AanvraagMarkering, MarkeringStore } from "../types";

const markeringKey = (aanvraagId: string, userId: string): string =>
  `${userId}:${aanvraagId}`;

export class MemoryMarkeringStore implements MarkeringStore {
  private readonly records = new Map<string, AanvraagMarkering>();

  get(aanvraagId: string, userId: string): Promise<AanvraagMarkering | null> {
    return Promise.resolve(
      structuredClone(
        this.records.get(markeringKey(aanvraagId, userId)) ?? null
      )
    );
  }

  set(
    markering: Omit<AanvraagMarkering, "createdAt">
  ): Promise<AanvraagMarkering> {
    const saved: AanvraagMarkering = {
      ...markering,
      createdAt: new Date(),
    };
    this.records.set(
      markeringKey(markering.aanvraagId, markering.userId),
      saved
    );
    return Promise.resolve(structuredClone(saved));
  }
}
