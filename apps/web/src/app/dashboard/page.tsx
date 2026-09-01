import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-[1600px] space-y-2 px-4 py-6 sm:px-6 lg:px-8"
    >
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Dashboard
      </h1>
      <p className="text-sm text-muted-foreground">
        Welcome {session.user.name}
      </p>
      <Dashboard />
    </main>
  );
}
