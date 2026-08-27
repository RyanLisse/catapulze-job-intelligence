"use client";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

const apiStatusLabel = (isLoading: boolean, isConnected: boolean): string => {
  if (isLoading) {
    return "Checking...";
  }
  if (isConnected) {
    return "Connected";
  }
  return "Disconnected";
};

const Home = () => {
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());
  const isConnected = Boolean(healthCheck.data);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8">
        <p className="text-muted-foreground text-sm">Catapulze</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Job Intelligence
        </h1>
        <p className="text-muted-foreground mt-2 max-w-xl">
          Collect vacancies from many sources, search them with Boolean logic,
          and export approved results to Spott.io.
        </p>
      </header>
      <section className="rounded-lg border p-4">
        <h2 className="mb-2 font-medium">API status</h2>
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
          />
          <span className="text-muted-foreground text-sm">
            {apiStatusLabel(healthCheck.isLoading, isConnected)}
          </span>
        </div>
      </section>
    </div>
  );
};

export default Home;
