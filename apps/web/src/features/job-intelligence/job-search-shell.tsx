"use client";

import { Button } from "@ji/ui/components/button";
import Link from "next/link";
import { useMemo } from "react";

import { authClient } from "@/lib/auth-client";

import { fixtureJobDataAdapter } from "./fixtures";
import { JobSearchPage } from "./job-search-page";
import { createRestJobIntelligence } from "./rest-job-data-adapter";

const fixturesEnabled =
  process.env.NEXT_PUBLIC_USE_FIXTURES === "true" ||
  process.env.NEXT_PUBLIC_USE_FIXTURES === "1";

export const JobSearchShell = () => {
  const { data: session, isPending } = authClient.useSession();
  const isAuthenticated = Boolean(session?.user.id);
  const wiring = useMemo(
    () =>
      fixturesEnabled || !isAuthenticated ? null : createRestJobIntelligence(),
    [isAuthenticated]
  );

  if (fixturesEnabled) {
    return <JobSearchPage adapter={fixtureJobDataAdapter} />;
  }

  if (isPending) {
    return null;
  }

  if (!session) {
    return (
      <main
        id="main-content"
        className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-12"
      >
        <section className="space-y-4 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">
            Log in om opdrachten te bekijken
          </h1>
          <p className="text-muted-foreground">
            De zoekresultaten en acties zijn alleen beschikbaar met een geldig
            Catapulze-account.
          </p>
          <Button render={<Link href="/login" />} nativeButton={false}>
            Inloggen
          </Button>
        </section>
      </main>
    );
  }

  if (!wiring) {
    return null;
  }

  return (
    <JobSearchPage actions={wiring.actions} adapter={wiring.adapter} liveData />
  );
};
