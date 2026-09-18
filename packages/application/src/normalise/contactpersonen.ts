import type { SourceContact } from "@ji/connectors";
import type { Contactpersoon } from "@ji/domain";

import { contactpersoonBeleidVoor } from "../sources/contactpersoon-beleid";
import { field } from "./types";
import type { NormalisedField } from "./types";

/** CTP-610: maps one source-published contact (a `SourceContact`, or a
 * schema.org `ContactPoint`-shaped node) to the canonical domain shape. The
 * pipeline-owned art. 14 fields start null — a source can never set them.
 * Returns null when the contact carries no reachable channel at all. */
export const toContactpersoon = (contact: {
  email?: string | null;
  naam?: string | null;
  rol?: string | null;
  telefoon?: string | null;
}): Contactpersoon | null => {
  const naam = contact.naam?.trim() || null;
  const email = contact.email?.trim() || null;
  const telefoon = contact.telefoon?.trim() || null;
  if (!(naam || email || telefoon)) {
    return null;
  }
  return {
    email,
    geinformeerdOp: null,
    naam,
    notificatieKanaal: null,
    rol: contact.rol?.trim() || null,
    telefoon,
  };
};

const contactKey = (contact: Contactpersoon): string =>
  `${contact.naam ?? ""}|${contact.email ?? ""}`;

/** CTP-610: pushes one mapped contact onto the list unless (naam, email)
 * already appears — the shared dedupe rule for every merge path. */
export const pushUniqueContactpersoon = (
  list: Contactpersoon[],
  contact: Contactpersoon | null
): void => {
  if (
    contact &&
    !list.some((entry) => contactKey(entry) === contactKey(contact))
  ) {
    list.push(contact);
  }
};

/** CTP-610: resolves a connector's `contactpersonen` list into a draft field.
 * Applies the bron's `contactpersoon_beleid.extractie`, maps to
 * `Contactpersoon`, drops empty entries and dedupes on (naam, email).
 * Returns null when the bron may not store contacts or nothing remains —
 * callers then simply omit the draft field. */
export const toDraftContactpersonen = (
  slug: string,
  contacts: readonly SourceContact[] | null | undefined,
  parserVersion: string,
  sourcePath: string
): NormalisedField<Contactpersoon[]> | null => {
  if (!contactpersoonBeleidVoor(slug).extractie || !contacts?.length) {
    return null;
  }
  const contactpersonen: Contactpersoon[] = [];
  for (const contact of contacts) {
    pushUniqueContactpersoon(contactpersonen, toContactpersoon(contact));
  }
  return contactpersonen.length > 0
    ? field(contactpersonen, parserVersion, sourcePath)
    : null;
};
