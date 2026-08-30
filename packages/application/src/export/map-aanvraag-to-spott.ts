import type { AanvraagRecord } from "../registry/stores/types";
import type { SpottCreateVacancyRequest } from "./spott/types";

const SPOTT_FIXTURE_COMPANY_ID = "company-fixture-001";
const SPOTT_FIXTURE_STAGE_ID = "stage-fixture-001";

export const mapAanvraagToSpottCreateRequest = (
  aanvraag: AanvraagRecord
): SpottCreateVacancyRequest => ({
  clientContactIds: [],
  companyId: SPOTT_FIXTURE_COMPANY_ID,
  description: aanvraag.beschrijving,
  employmentType: "contract",
  endAt: null,
  location: null,
  locationType: "remote",
  name: aanvraag.titel,
  salaryRange: null,
  stageId: SPOTT_FIXTURE_STAGE_ID,
  startAt: null,
  targetCompanyId: null,
  teamUserIds: [],
});
