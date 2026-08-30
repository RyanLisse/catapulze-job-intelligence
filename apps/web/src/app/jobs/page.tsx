import type { Metadata } from "next";
import { Suspense } from "react";

import { JobSearchShell } from "@/features/job-intelligence/job-search-shell";
import { JobLoadingState } from "@/features/job-intelligence/job-search-states";

export const metadata: Metadata = {
  description:
    "Doorzoek opdrachten met Boolean-logica, filters en volledige herkomstinformatie.",
  title: "Opdrachten zoeken · Catapulze Job Intelligence",
};

const JobsPage = () => (
  <Suspense
    fallback={
      <main id="main-content" className="min-h-full bg-[var(--ji-canvas)]">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-5 h-10 w-48 animate-pulse bg-muted" />
          <JobLoadingState />
        </div>
      </main>
    }
  >
    <JobSearchShell />
  </Suspense>
);

export default JobsPage;
