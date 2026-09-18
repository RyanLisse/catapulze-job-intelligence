"use client";

import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import { usePathname } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { authClient } from "@/lib/auth-client";

import { mintMarktvragenAccessToken, startMarktvragenSession } from "./actions";
import {
  MARKTVRAGEN_CHAT_TASK_ID,
  MarktvragenChatContext,
} from "./marktvragen-chat-context";
import type {
  MarktvragenChatContextValue,
  MarktvragenClientData,
  MarktvragenScreen,
} from "./marktvragen-chat-context";

export { useMarktvragenChat } from "./marktvragen-chat-context";

const screenForPath = (pathname: string): MarktvragenScreen => {
  if (pathname.startsWith("/jobs")) {
    return { kind: "search", label: "Zoekresultaten" };
  }
  if (pathname.startsWith("/bronnen")) {
    return { kind: "dashboard", label: "Bronnenoverzicht" };
  }
  if (pathname.startsWith("/chat")) {
    return { kind: "chat" };
  }
  return { kind: "dashboard", label: "Overzicht" };
};

/**
 * Holds the single Marktvragen conversation for the whole app shell — the
 * sidebar and /chat render the same `useChat` state, so client-side
 * navigation keeps the thread. A full page reload starts a fresh chatId
 * (history restore is a documented follow-up).
 */
export const MarktvragenChatProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const [isOpen, setOpen] = useState(false);
  const [screenOverride, setScreenOverride] =
    useState<MarktvragenScreen | null>(null);

  // Lazy state init mints the id once per mount — randomUUID() inside useMemo
  // is impure, which blocks the React Compiler from memoizing this component.
  const [chatIdSuffix] = useState(() => crypto.randomUUID());
  const chatId = session?.user?.id
    ? `${session.user.id}~${chatIdSuffix}`
    : null;

  const clientData = useMemo<MarktvragenClientData>(
    () => ({ screen: screenOverride ?? screenForPath(pathname) }),
    [pathname, screenOverride]
  );

  const transport = useTriggerChatTransport({
    accessToken: ({ chatId: id }) => mintMarktvragenAccessToken(id),
    clientData,
    startSession: ({ chatId: id, clientData: data }) =>
      startMarktvragenSession({ chatId: id, clientData: data }),
    task: MARKTVRAGEN_CHAT_TASK_ID,
  });

  const { error, messages, sendMessage, status, stop } = useChat({
    id: chatId ?? "marktvragen-anonymous",
    transport,
  });

  const enabled = chatId !== null;

  const send = useCallback(
    async (text: string) => {
      if (!(enabled && text.trim())) {
        return;
      }
      await sendMessage({ text: text.trim() });
    },
    [enabled, sendMessage]
  );

  const sendToChat = useCallback(
    (text: string, screen?: MarktvragenScreen) => {
      if (screen) {
        setScreenOverride(screen);
      }
      setOpen(true);
      void send(text);
    },
    [send]
  );

  const value = useMemo<MarktvragenChatContextValue>(
    () => ({
      chatId,
      enabled,
      error,
      isOpen,
      messages,
      sendMessage: send,
      sendToChat,
      setOpen,
      status,
      stop,
    }),
    [chatId, enabled, error, isOpen, messages, send, sendToChat, status, stop]
  );

  return (
    <MarktvragenChatContext.Provider value={value}>
      {children}
    </MarktvragenChatContext.Provider>
  );
};
