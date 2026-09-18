import { sourceLabel } from "./presentation";
import { searchJobs } from "./search-state";
import type {
  JobDataAdapter,
  JobListing,
  JobSourceOption,
  JobSourceRecord,
} from "./types";

const sourceRecord = (
  name: JobSourceRecord["name"],
  reference: string,
  firstSeenAt: string
): JobSourceRecord => ({
  displayName: sourceLabel(name),
  firstSeenAt,
  id: `${name}-${reference.toLowerCase()}`,
  lastSeenAt: "2026-08-30T08:00:00.000Z",
  name,
  normalizationVersion: "preview-v1",
  reference,
  scrapeRunId: `run-preview-${firstSeenAt.slice(0, 10)}`,
  // example.com resolves (IANA reserved) so Herkomst clicks prove the bron
  // link works in live-verify; example.invalid never resolves and only shows
  // a browser error page.
  url: `https://example.com/${name}/${reference.toLowerCase()}`,
});

export const JOB_FIXTURES: readonly JobListing[] = [
  {
    closingAt: "2026-09-05T15:00:00.000Z",
    contractType: "interim",
    country: "NL",
    description:
      "Je ontwerpt en onderhoudt datapijplijnen in Azure en Databricks. Ervaring met Python, SQL en datakwaliteit is vereist.",
    id: "job-001",
    location: "Amsterdam",
    organization: "Gemeente Amsterdam",
    publishedAt: "2026-08-30T06:00:00.000Z",
    rate: { currency: "EUR", max: 115, min: 95, period: "hour" },
    remote: true,
    skills: ["Python", "Databricks", "Azure", "SQL"],
    sourceRecords: [
      sourceRecord("inhuurdesk", "AMS-2026-184", "2026-08-30T06:20:00.000Z"),
    ],
    status: "open",
    summary: "Bouw betrouwbare datapijplijnen voor stedelijke mobiliteitsdata.",
    title: "Senior Data Engineer",
  },
  {
    closingAt: "2026-09-03T10:00:00.000Z",
    contractType: "detachering",
    country: "NL",
    description:
      "Je verbindt beleid, uitvoering en data binnen het sociaal domein en werkt processen uit in BPMN.",
    id: "job-002",
    location: "Utrecht",
    organization: "Gemeente Utrecht",
    publishedAt: "2026-08-29T11:45:00.000Z",
    rate: { currency: "EUR", max: 98, min: 80, period: "hour" },
    remote: true,
    skills: ["BPMN", "SQL", "Stakeholdermanagement"],
    sourceRecords: [
      sourceRecord("werkenvoor", "UTR-IA-442", "2026-08-29T12:10:00.000Z"),
    ],
    status: "closing-soon",
    summary: "Vertaal beleidsvragen naar heldere informatieproducten.",
    title: "Informatieanalist Sociaal Domein",
  },
  {
    closingAt: "2026-09-10T12:00:00.000Z",
    contractType: "freelance",
    country: "NL",
    description:
      "Je automatiseert Kubernetes-platformen met Terraform en GitOps en helpt teams veilig naar de cloud.",
    id: "job-003",
    location: "Den Haag",
    organization: "Ministerie van Infrastructuur en Waterstaat",
    publishedAt: "2026-08-28T09:00:00.000Z",
    rate: { currency: "EUR", max: 125, min: 105, period: "hour" },
    remote: true,
    skills: ["Kubernetes", "Terraform", "Azure", "GitOps"],
    sourceRecords: [
      sourceRecord("tenderned", "TN-883021", "2026-08-28T09:30:00.000Z"),
    ],
    status: "open",
    summary: "Versterk het cloudplatform voor kritieke infrastructuur.",
    title: "Cloud Platform Engineer",
  },
  {
    closingAt: "2026-09-08T09:00:00.000Z",
    contractType: "interim",
    country: "NL",
    description:
      "Je bepaalt de productkoers, prioriteert de backlog en borgt toegankelijke digitale dienstverlening.",
    id: "job-004",
    location: "Amsterdam",
    organization: "UWV",
    publishedAt: "2026-08-27T14:20:00.000Z",
    rate: { currency: "EUR", max: 108, min: 90, period: "hour" },
    remote: false,
    skills: ["Productstrategie", "Agile", "Dienstverlening"],
    sourceRecords: [
      sourceRecord("inhuurdesk", "UWV-PO-019", "2026-08-27T15:00:00.000Z"),
    ],
    status: "open",
    summary: "Stuur een multidisciplinair team rond digitale dienstverlening.",
    title: "Product Owner Digitale Dienstverlening",
  },
  {
    closingAt: "2026-09-02T16:00:00.000Z",
    contractType: "detachering",
    country: "NL",
    description:
      "Je vertaalt Zero Trust en NORA naar toepasbare architectuurprincipes en begeleidt technische teams.",
    id: "job-005",
    location: "Driebergen-Rijsenburg",
    organization: "Politie Nederland",
    publishedAt: "2026-08-25T09:30:00.000Z",
    rate: { currency: "EUR", max: 120, min: 100, period: "hour" },
    remote: true,
    skills: ["Zero Trust", "NORA", "Security", "Architectuur"],
    sourceRecords: [
      sourceRecord("werkenvoor", "POL-SA-771", "2026-08-25T10:00:00.000Z"),
    ],
    status: "closing-soon",
    summary: "Ontwerp veilige kaders voor landelijke politieplatformen.",
    title: "Security Architect",
  },
  {
    closingAt: "2026-09-07T12:00:00.000Z",
    contractType: "freelance",
    country: "NL",
    description:
      "Je bouwt Power BI-producten, verbetert datamodellen en helpt gebruikers zelfstandig met data werken.",
    id: "job-006",
    location: "Haarlem",
    organization: "Provincie Noord-Holland",
    publishedAt: "2026-08-24T08:00:00.000Z",
    rate: { currency: "EUR", max: 94, min: 78, period: "hour" },
    remote: true,
    skills: ["Power BI", "DAX", "SQL", "Datamodellering"],
    sourceRecords: [
      sourceRecord("tenderned", "PNH-BI-206", "2026-08-24T08:10:00.000Z"),
    ],
    status: "open",
    summary: "Maak provinciale sturingsinformatie sneller en betrouwbaarder.",
    title: "Business Intelligence Specialist",
  },
  {
    closingAt: "2026-09-12T09:00:00.000Z",
    contractType: "interim",
    country: "NL",
    description:
      "Je ontwikkelt componenten in React en Next.js en bewaakt performance, toegankelijkheid en kwaliteit.",
    id: "job-007",
    location: "Apeldoorn",
    organization: "Kadaster",
    publishedAt: "2026-08-22T12:30:00.000Z",
    rate: { currency: "EUR", max: 105, min: 85, period: "hour" },
    remote: true,
    skills: ["TypeScript", "React", "Next.js", "Accessibility"],
    sourceRecords: [
      sourceRecord("indeed", "KAD-FE-118", "2026-08-22T13:00:00.000Z"),
    ],
    status: "open",
    summary: "Werk aan snelle en toegankelijke geo-informatieproducten.",
    title: "Senior Frontend Developer",
  },
  {
    closingAt: "2026-09-15T12:00:00.000Z",
    contractType: "vast",
    country: "NL",
    description:
      "Je ontwikkelt het governance-model, verbetert metadata en maakt eigenaarschap praktisch uitvoerbaar.",
    id: "job-008",
    location: "Delft",
    organization: "Rijkswaterstaat",
    publishedAt: "2026-08-19T07:00:00.000Z",
    rate: { currency: "EUR", max: 102_000, min: 82_000, period: "year" },
    remote: false,
    skills: ["Data Governance", "Metadata", "DAMA-DMBOK"],
    sourceRecords: [
      sourceRecord("werkenvoor", "RWS-DG-553", "2026-08-19T07:30:00.000Z"),
    ],
    status: "open",
    summary:
      "Zet de standaard voor verantwoord datagebruik binnen Rijkswaterstaat.",
    title: "Data Governance Lead",
  },
  {
    closingAt: "2026-09-01T09:00:00.000Z",
    contractType: "interim",
    country: "NL",
    description:
      "Je leidt de implementatie, stuurt afhankelijkheden en zorgt voor heldere bestuurlijke besluitvorming.",
    id: "job-009",
    location: "Rotterdam",
    organization: "Gemeente Rotterdam",
    publishedAt: "2026-08-15T10:30:00.000Z",
    rate: { currency: "EUR", max: 103, min: 88, period: "hour" },
    remote: false,
    skills: ["Omgevingswet", "Projectmanagement", "Bestuur"],
    sourceRecords: [
      sourceRecord("inhuurdesk", "RTD-OMG-090", "2026-08-15T11:00:00.000Z"),
    ],
    status: "closing-soon",
    summary: "Breng uitvoering en bestuur samen rond de Omgevingswet.",
    title: "Projectleider Omgevingswet",
  },
  {
    closingAt: "2026-09-18T12:00:00.000Z",
    contractType: "vast",
    country: "NL",
    description:
      "Je ontwikkelt machine-learningmodellen en bouwt een robuust MLOps-platform met Python en Kubernetes.",
    id: "job-010",
    location: "Utrecht",
    organization: "Nederlandse Spoorwegen",
    publishedAt: "2026-08-12T07:30:00.000Z",
    rate: { currency: "EUR", max: 96_000, min: 75_000, period: "year" },
    remote: true,
    skills: ["Python", "MLOps", "Kubernetes", "Machine Learning"],
    sourceRecords: [
      sourceRecord("indeed", "NS-MLE-064", "2026-08-12T08:00:00.000Z"),
    ],
    status: "open",
    summary: "Breng voorspellende modellen betrouwbaar naar productie.",
    title: "Machine Learning Engineer",
  },
  {
    closingAt: "2026-09-04T10:00:00.000Z",
    contractType: "freelance",
    country: "NL",
    description:
      "Je voert risicoanalyses uit, adviseert over BIO en ISO 27001 en ondersteunt verbetermaatregelen.",
    id: "job-011",
    location: "Tiel",
    organization: "Waterschap Rivierenland",
    publishedAt: "2026-08-08T08:45:00.000Z",
    rate: null,
    remote: true,
    skills: ["BIO", "ISO 27001", "Risicomanagement"],
    sourceRecords: [
      sourceRecord("tenderned", "WSRL-IB-330", "2026-08-08T09:00:00.000Z"),
    ],
    status: "open",
    summary: "Maak informatiebeveiliging aantoonbaar en werkbaar.",
    title: "Adviseur Informatiebeveiliging",
  },
  {
    closingAt: "2026-08-28T12:00:00.000Z",
    contractType: "detachering",
    country: "NL",
    description:
      "Je bouwt services met Java, Spring Boot en Kafka en verbetert de betrouwbaarheid van gegevensstromen.",
    id: "job-012",
    location: "Apeldoorn",
    organization: "Belastingdienst",
    publishedAt: "2026-07-29T09:40:00.000Z",
    rate: { currency: "EUR", max: 99, min: 82, period: "hour" },
    remote: true,
    skills: ["Java", "Spring Boot", "Kafka", "PostgreSQL"],
    sourceRecords: [
      sourceRecord("werkenvoor", "BD-JAVA-919", "2026-07-29T10:00:00.000Z"),
    ],
    status: "closed",
    summary: "Vernieuw een hoogvolume berichtenplatform.",
    title: "Backend Developer Java",
  },
  {
    closingAt: "2026-09-12T12:00:00.000Z",
    contractType: "vast",
    country: "NL",
    description:
      "<p>Wij zoeken een <b>TypeScript</b> engineer.</p><ul><li>React</li><li>Node.js</li></ul>",
    id: "job-html-nvb",
    location: "Rotterdam",
    organization: "Nationale Vacaturebank Fixture",
    publishedAt: "2026-08-27T09:00:00.000Z",
    rate: { currency: "EUR", max: 90, min: 70, period: "hour" },
    rawPreview:
      '{\n  "platform": "nationalevacaturebank",\n  "description": "<p>Wij zoeken een <b>TypeScript</b> engineer.</p>"\n}',
    remote: false,
    skills: ["TypeScript", "React"],
    sourceRecords: [
      sourceRecord(
        "nationale-vacaturebank",
        "NVB-HTML-1",
        "2026-08-27T09:15:00.000Z"
      ),
    ],
    status: "open",
    summary: "Wij zoeken een TypeScript engineer. React Node.js",
    title: "TypeScript Engineer (HTML body fixture)",
  },
  // Arena stress fixtures: long real-world values that made the fixed-width
  // results table overlap in production (month rates, long titles, long
  // platform names, UUID references, absent fields). Kept at the end so the
  // regular fixtures keep their positions under default sort.
  {
    closingAt: null,
    contractType: "interim",
    country: "NL",
    description:
      "Je adviseert over vergunningverlening binnen de Omgevingswet en begeleidt complexe aanvragen voor de gemeente.",
    hoursPerWeek: "32–40",
    id: "job-stress-001",
    location: "Eindhoven",
    organization: "Teamspoor Aannemerscombinatie Regio Eindhoven",
    publishedAt: "2026-08-11T08:00:00.000Z",
    rate: { currency: "EUR", max: 6500, min: 3150, period: "month" },
    remote: null,
    skills: ["Omgevingswet", "Vergunningverlening"],
    sourceRecords: [
      sourceRecord(
        "nationale-vacaturebank",
        "cebc352f2-4191-483b-8f01-7c2a9b4d5e6f",
        "2026-08-11T08:15:00.000Z"
      ),
    ],
    status: "open",
    summary: "Begeleid vergunningaanvragen voor de Omgevingswet.",
    title: "Adviseur Vergunningverlening Omgevingswet en Ruimtelijke Ordening",
  },
  {
    closingAt: null,
    contractType: null,
    country: "NL",
    description:
      "Je coördineert de energietransitie over meerdere gemeentelijke projecten heen.",
    hoursPerWeek: null,
    id: "job-stress-002",
    location: null,
    organization:
      "Emmert Groep Vastgoedontwikkeling en Duurzame Energieprojecten",
    publishedAt: "2026-08-09T07:00:00.000Z",
    rate: null,
    remote: null,
    skills: [],
    sourceRecords: [
      sourceRecord(
        "nationale-vacaturebank",
        "ce021ff2-97b3-4c98-8f7d-aa2f1b8c3301",
        "2026-08-09T07:20:00.000Z"
      ),
    ],
    status: "open",
    summary: "Coördineer energietransitieprojecten.",
    title: "Senior Projectcoördinator Energietransitie Zuid-Nederland",
  },
  {
    closingAt: "2026-09-19T17:00:00.000Z",
    contractType: "freelance",
    country: "NL",
    description:
      "Je bent commercieel intercedent voor de regio Venlo en omstreken.",
    hoursPerWeek: "24–40",
    id: "job-stress-003",
    location: "Venlo-Blerick",
    organization: "Timing Uitzendbureau",
    publishedAt: "2026-08-10T09:00:00.000Z",
    rate: { currency: "EUR", max: 3510, min: 2600, period: "month" },
    remote: false,
    skills: ["Sales", "Recruitment"],
    sourceRecords: [
      sourceRecord(
        "nationale-vacaturebank",
        "95acf1b6-eb77-4a89-87c2-6f41e9d0a2b3",
        "2026-08-10T09:10:00.000Z"
      ),
    ],
    status: "closing-soon",
    summary: "Commercieel intercedent voor de regio Venlo.",
    title: "Commercieel Intercedent Venlo",
    workArrangement: "Op locatie",
  },
  {
    closingAt: "2026-10-01T12:00:00.000Z",
    contractType: "vast",
    country: "NL",
    description:
      "Je begeleidt bewoners in beschermd wonen trajecten in Dordrecht.",
    hoursPerWeek: "36",
    id: "job-stress-004",
    location: "Dordrecht",
    organization: "CGNet Zorg en Welzijn",
    publishedAt: "2026-08-08T10:00:00.000Z",
    rate: { currency: "EUR", max: 4148, min: 3088, period: "month" },
    remote: false,
    skills: ["Beschermd wonen"],
    sourceRecords: [
      sourceRecord(
        "werkenvoor",
        "4b3d536e-96f8-49ee-a2c1-9e5f6d7a8b9c",
        "2026-08-08T10:30:00.000Z"
      ),
    ],
    status: "open",
    summary: "Begeleid bewoners in beschermd wonen trajecten.",
    title: "Woonbegeleider Beschermd Wonen",
    workArrangement: "Hybride",
  },
  {
    closingAt: "2026-11-30T12:00:00.000Z",
    contractType: "interim",
    country: "NL",
    description:
      "Je treedt op als corporate recruiter met een dagtarief voor een half jaar.",
    hoursPerWeek: "40",
    id: "job-stress-005",
    location: "'s-Hertogenbosch",
    organization: "Raak Personeel Detachering Noord-Nederland",
    publishedAt: "2026-08-07T12:00:00.000Z",
    rate: { currency: "EUR", max: 760, min: 540, period: "day" },
    remote: true,
    skills: ["Recruitment", "Sourcing"],
    sourceRecords: [
      sourceRecord(
        "inhuurdesk",
        "d4f7b30c-4b4e-4c1a-a1f2-3e5d6c7b8a90",
        "2026-08-07T12:45:00.000Z"
      ),
    ],
    status: "open",
    summary: "Corporate recruiter op dagtarief.",
    title: "Corporate Recruiter",
  },
  {
    closingAt: "2026-09-25T12:00:00.000Z",
    contractType: "interim",
    country: "NL",
    description:
      "Als elektromonteur dagdienst werk je aan utiliteitsprojecten in Drachten.",
    hoursPerWeek: "1–40",
    id: "job-stress-006",
    location: "Drachten",
    organization: "Start People",
    publishedAt: "2026-08-06T06:00:00.000Z",
    rate: { currency: "EUR", max: 88, min: null, period: "hour" },
    remote: null,
    skills: [],
    sourceRecords: [
      sourceRecord(
        "indeed",
        "3c1c3f92-9b8b-4d4b-8c3d-2e1f0a9b8c7d",
        "2026-08-06T06:20:00.000Z"
      ),
    ],
    status: "open",
    summary: "Elektromonteur dagdienst voor utiliteitsprojecten.",
    title: "Elektromonteur dagdienst",
  },
] as const;

// RJC-368: mirrors the live adapter's contract — derived from the fixture
// data instead of a separately maintained hardcoded list, so it can't drift.
const fixtureSourceOptions = (): readonly JobSourceOption[] => {
  const seen = new Set<string>();
  const options: JobSourceOption[] = [];
  for (const job of JOB_FIXTURES) {
    for (const record of job.sourceRecords) {
      if (!seen.has(record.name)) {
        seen.add(record.name);
        options.push({ label: sourceLabel(record.name), value: record.name });
      }
    }
  }
  return options.toSorted((left, right) =>
    left.label.localeCompare(right.label, "nl-NL")
  );
};

export const fixtureJobDataAdapter: JobDataAdapter = {
  getById: (id) =>
    Promise.resolve(JOB_FIXTURES.find((job) => job.id === id) ?? null),
  listSources: () => Promise.resolve(fixtureSourceOptions()),
  search: (request) => Promise.resolve(searchJobs(JOB_FIXTURES, request)),
};
