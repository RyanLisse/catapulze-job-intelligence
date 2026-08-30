"use client";

import { useMemo } from "react";

import { authClient } from "@/lib/auth-client";

import { fixtureJobDataAdapter } from "./fixtures";
import { JobSearchPage } from "./job-search-page";
import { createRestJobIntelligence } from "./rest-job-data-adapter";

const useFixtures =
  process.env.NEXT_PUBLIC_USE_FIXTURES === "true" ||
  process.env.NEXT_PUBLIC_USE_FIXTURES === "1";

export const JobSearchShell = () => {
  const { data: session } = authClient.useSession();
  const subjectId = session?.user.id ?? "web-recruiter";
  const wiring = useMemo(
    () => (useFixtures ? null : createRestJobIntelligence({ subjectId })),
    [subjectId]
  );

  if (useFixtures) {
    return <JobSearchPage adapter={fixtureJobDataAdapter} />;
  }

  if (!wiring) {
    return null;
  }

  return (
    <JobSearchPage actions={wiring.actions} adapter={wiring.adapter} liveData />
  );
};
