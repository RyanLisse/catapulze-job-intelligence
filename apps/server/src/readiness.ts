import type { DbReadinessResult } from "@ji/db/readiness";
import type { Context } from "hono";

type DbReadinessFailure = Extract<DbReadinessResult, { ready: false }>;
type CheckDbReadiness = () => Promise<DbReadinessResult>;
type ReportDbReadinessFailure = (failure: DbReadinessFailure) => void;

export const createReadinessHandler =
  (
    checkDbReadiness: CheckDbReadiness,
    reportFailure: ReportDbReadinessFailure
  ) =>
  async (context: Context): Promise<Response> => {
    const readiness = await checkDbReadiness();

    if (readiness.ready) {
      return context.text("OK");
    }

    reportFailure(readiness);
    return context.text("Service Unavailable", 503);
  };
