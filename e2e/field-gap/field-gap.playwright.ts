import path from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * CTP-514 visual proof: one test per bron opens the real detail dialog on
 * /jobs?job=<id> and asserts the commercial fields the lanes fixed. Every id
 * below is a row that travelled the real pipeline (fixture -> connector ->
 * normalise -> curate -> Postgres -> REST -> web); nothing is stubbed.
 */

const SHOTS = path.resolve(
  import.meta.dirname,
  "../../.artifacts/e2e/field-gap-shots"
);

interface FieldClaim {
  readonly label: string;
  readonly value: string;
}

interface Case {
  readonly bron: string;
  readonly claims: readonly FieldClaim[];
  /** Aanvraag id from the seeded field-gap run. Absent for rows whose source
   * record was re-recorded on 2026-09-16 and has not been seeded yet: those
   * ids must be read from the re-seeded database before this suite runs
   * again -- inventing one would prove nothing. */
  readonly id?: string;
  readonly reference: string;
  /** Literal skill chips, in source order, when the source publishes a list. */
  readonly skills?: readonly string[];
  readonly title: string;
}

const CASES: readonly Case[] = [
  {
    bron: "bluetrail",
    claims: [
      { label: "Provincie", value: "Gelderland" },
      { label: "Uren per week", value: "32" },
    ],
    id: "d8a93a9f-0c13-4523-809a-e7dde338ca1e",
    reference: "opdrachten/Interim/ciam-tester",
    title: "CIAM Tester",
  },
  {
    bron: "bluetrail-adviseur-privacy-ibd",
    claims: [
      { label: "Provincie", value: "Zuid-Holland" },
      { label: "Uren per week", value: "32" },
    ],
    id: "b0039ab2-af2d-4c99-8c98-a0a9fa8f8bf7",
    reference: "opdrachten/Interim/adviseur-privacy-ibd",
    skills: [
      "Analytisch & conceptueel sterk",
      "Communicatief en verbindend",
      "Organisatiesensitief",
      "Overtuigingskracht",
      "Zelfstandig, maar teamgericht",
      "Sterke schrijfvaardigheid",
    ],
    title: "Adviseur Privacy IBD",
  },
  {
    bron: "hero",
    claims: [{ label: "Uren per week", value: "36" }],
    id: "0fe8ccb3-a2ee-429f-9444-7224065d050b",
    reference: "interim-opdrachten/devops-engineer-1f2fde9f",
    title: "DevOps Engineer",
  },
  {
    bron: "pro-act",
    claims: [
      { label: "Uren per week", value: "36" },
      { label: "Werkvorm", value: "Hybride" },
      { label: "Startdatum", value: "1 okt 2026" },
    ],
    id: "63e6594d-e6c6-4827-920d-7171d42b657d",
    reference: "vacatures/senior-azure-operations-engineer-8793",
    title: "Senior Azure Operations Engineer",
  },
  {
    bron: "onefellow-920",
    claims: [
      { label: "Startdatum", value: "1 okt 2026" },
      { label: "Looptijd", value: "5 jaar met optie tot verlenging" },
    ],
    id: "90653a1b-1739-404c-9d33-6bc8cb956ecb",
    reference: "920",
    title:
      "#920 Constructiemanager Bouwteam & Ontwerpfase – Waterstofnetwerk Zuidwest Nederland",
  },
  {
    bron: "onefellow-944",
    claims: [
      { label: "Einddatum", value: "30 sep 2029" },
      { label: "Uren per week", value: "36" },
    ],
    id: "5738e761-e4c1-453a-afd2-c77879213870",
    reference: "944",
    title: "#944 Productmanager/adviseur i-Sociaal Domein",
  },
  {
    // 15520 left the live listing; 15574 is the equivalent row in the
    // 2026-09-16 recording (uren + looptijd, no werkvorm/skills published).
    bron: "needstaffing-15574",
    claims: [
      { label: "Uren per week", value: "36" },
      { label: "Looptijd", value: "3 maanden (met optie tot verlenging)" },
    ],
    reference: "15574",
    title: "Senior ontwikkelaar .NET 2026-GV-0465",
  },
  {
    bron: "needstaffing-15599",
    claims: [
      { label: "Werkvorm", value: "Hybride" },
      { label: "Uren per week", value: "36" },
      { label: "Looptijd", value: "12 maanden" },
    ],
    reference: "15599",
    skills: [
      "Eigenaarschap",
      "Overtuigingskracht",
      "Inhoudelijke scherpte",
      "Analytisch sterk",
      "Hands-on en praktisch ingesteld",
      "Een echte doener",
      "Goede teamspeler",
      "Communicatief vaardig",
      "Proactief",
      "Zelfstandig",
      "Nuchter en no-nonsense",
      "Snel kunnen schakelen",
      "In staat om een organisatie snel te doorgronden",
    ],
    title: "Business Analist 202606A432 (vervanging)",
  },
  {
    bron: "harveynash",
    claims: [
      { label: "Provincie", value: "Utrecht" },
      { label: "Werkvorm", value: "Hybride" },
      { label: "Uren per week", value: "36" },
      { label: "Looptijd", value: "24 maanden" },
    ],
    id: "4d6c6f5a-2ed3-4cf8-af9a-2266ceca31a2",
    reference: "452d25a3-ae7d-4ee6-9ceb-3c696332799f",
    title: "Endpoints specialist",
  },
  {
    bron: "inhuurdesk",
    claims: [
      { label: "Werkvorm", value: "Hybride" },
      { label: "Uren per week", value: "32" },
    ],
    id: "e63a1d2b-d33f-4cac-b829-5c2b509adb92",
    reference: "92c6acf6-2f34-4342-8dc0-80e23b0a5d48",
    title: "Communicatieadviseur",
  },
  {
    bron: "striive",
    claims: [
      { label: "Provincie", value: "Drenthe" },
      { label: "Werkvorm", value: "Remote" },
    ],
    id: "51892e4e-47f8-47ce-ba19-864b00101f49",
    reference: "d0ab03db-13d1-42d4-a55d-3d238f02b3c0",
    title: "Functioneel Beheerder Youforce",
  },
  {
    bron: "tenderned",
    claims: [{ label: "Provincie", value: "Noord-Holland" }],
    id: "2237625a-9edd-40b2-a55a-7e6773a7c1e2",
    reference: "TN563214",
    title: "Platform engineer Azure DAS",
  },
  {
    // 1457 is absent from the 2026-09-16 snapshot; 1544 is the equivalent
    // row (province + 36 uur, nothing else published).
    bron: "opdrachtoverheid-1544",
    claims: [
      { label: "Provincie", value: "Noord-Holland" },
      { label: "Uren per week", value: "36" },
    ],
    reference: "amstelveenhuurtin_1544",
    title: "686 - Schuldhulpverlener",
  },
  {
    bron: "opdrachtoverheid-2177",
    claims: [
      { label: "Provincie", value: "Noord-Holland" },
      { label: "Uren per week", value: "32" },
      { label: "Contract", value: "Detachering" },
      { label: "Opleiding", value: "MBO" },
    ],
    id: "dc361c1d-6669-4e58-84d5-6a179b97a599",
    reference: "amstelveenhuurtin_2177",
    skills: [
      "Nauwkeurig",
      "Communicatief vaardig",
      "Bestuurlijk sensitief",
      "Plannen en organiseren",
      "Zelfstandig",
    ],
    title: "Junior projectleider energietransitie (SO26-1658)",
  },
  {
    bron: "opdrachtoverheid-2123",
    claims: [
      { label: "Provincie", value: "Noord-Holland" },
      { label: "Uren per week", value: "16\u201324" },
      { label: "Contract", value: "Interim" },
    ],
    id: "d0b9765c-3eea-42ae-af1f-5147b8e9223f",
    reference: "amstelveenhuurtin_2123",
    skills: [
      "Klantgerichtheid",
      "Resultaatgerichtheid",
      "Onderhandelen",
      "Analytisch vermogen",
      "Bestuurlijke sensitiviteit",
      "Organisatiegericht",
      "Besluitvaardigheid",
    ],
    title: "Senior juridisch adviseur Grondzaken (Nieuw Legmeer) - SO26-1614",
  },
  {
    bron: "motian-flextender",
    claims: [{ label: "Provincie", value: "Utrecht" }],
    id: "d1d161a5-d742-4ff3-9b20-5e4aefa427e3",
    reference: "ext-000003",
    title: "Platform engineer 3",
  },
  {
    bron: "motian-mipublic",
    claims: [{ label: "Provincie", value: "Utrecht" }],
    id: "75fb6b59-101f-4e17-8dce-2da53b6a2974",
    reference: "ext-000002",
    title: "Platform engineer 2",
  },
  {
    bron: "motian-nationalevacaturebank",
    claims: [{ label: "Provincie", value: "Utrecht" }],
    id: "0920bd69-a5aa-4592-b91d-5a69ef212fe3",
    reference: "ext-000001",
    title: "Platform engineer 1",
  },
  {
    bron: "motian-starapple",
    claims: [{ label: "Provincie", value: "Utrecht" }],
    id: "3e13b832-57d3-4e3c-8533-53ec47c85a34",
    reference: "ext-000005",
    title: "Platform engineer 5",
  },
  {
    bron: "motian-werkzoeken",
    claims: [{ label: "Provincie", value: "Utrecht" }],
    id: "85e39382-92ab-4ffc-b63c-23675d54996a",
    reference: "ext-000102",
    title: "Platform engineer 102",
  },
];

const openDetail = async (page: Page, testCase: Case) => {
  if (!testCase.id) {
    throw new Error(
      `${testCase.bron} has no seeded aanvraag id yet: read it from the re-seeded field-gap database for bron_referentie ${testCase.reference} and fill it in`
    );
  }
  await page.goto(`/jobs?job=${testCase.id}`, {
    waitUntil: "domcontentloaded",
  });
  const dialog = page.getByRole("dialog", { name: testCase.title });
  await expect(dialog).toBeVisible();
  return dialog;
};

for (const testCase of CASES) {
  test(`${testCase.bron} detail dialog shows the fixed fields`, async ({
    page,
  }) => {
    const dialog = await openDetail(page, testCase);

    await Promise.all(
      testCase.claims.map((claim) =>
        expect(
          dialog.locator(
            `div:has(> dt:text-is("${claim.label}")) > dd:visible`
          ),
          `${testCase.bron} ${claim.label} must read "${claim.value}"`
        ).toHaveText(claim.value)
      )
    );

    if (testCase.skills) {
      const chips = dialog.locator(
        'div:has(> h3:text-is("Skills")) span:visible'
      );
      await expect(
        chips,
        `${testCase.bron} must render its published skill chips`
      ).toHaveText([...testCase.skills]);
    }

    await dialog.screenshot({
      path: path.join(SHOTS, `${testCase.bron}.png`),
    });
  });
}
