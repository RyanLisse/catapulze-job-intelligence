import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  MarktvragenComposer,
  MarktvragenMessages,
} from "@/features/marktvragen/marktvragen-panel";
import { getServerAuthClient } from "@/lib/auth-server";

export default async function ChatPage() {
  const session = await getServerAuthClient().getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Marktvragen
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Stel vragen over de marktdata; de agent schrijft en valideert SQL op het
        marts-schema.
      </p>
      <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
        <MarktvragenMessages />
        <MarktvragenComposer />
      </div>
    </main>
  );
}
