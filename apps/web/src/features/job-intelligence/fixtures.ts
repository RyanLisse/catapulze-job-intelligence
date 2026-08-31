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
  firstSeenAt,
  id: `${name}-${reference.toLowerCase()}`,
  lastSeenAt: "2026-08-30T08:00:00.000Z",
  name,
  normalizationVersion: "preview-v1",
  reference,
  scrapeRunId: `run-preview-${firstSeenAt.slice(0, 10)}`,
  url: `https://example.invalid/${name}/${reference.toLowerCase()}`,
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
