"use client";

import type { UIMessage } from "ai";
import { createContext, useContext } from "react";

// Shared with the worker task id (apps/worker/src/tasks/marktvragen-chat.ts).
// Lives here — not in actions.ts — because "use server" files may only export
// async functions.
export const MARKTVRAGEN_CHAT_TASK_ID = "marktvragen-chat" as const;

export interface MarktvragenScreen {
  readonly aanvraagId?: string;
  readonly bronId?: string;
  readonly bronNaam?: string;
  readonly kind: "aanvraag" | "bron" | "chat" | "dashboard" | "search";
  readonly label?: string;
  readonly savedSearchId?: string;
}

export interface MarktvragenClientData extends Record<string, unknown> {
  readonly screen?: MarktvragenScreen;
}

export interface MarktvragenChatContextValue {
  readonly chatId: string | null;
  readonly enabled: boolean;
  readonly error: Error | undefined;
  readonly isOpen: boolean;
  readonly messages: readonly UIMessage[];
  readonly sendMessage: (text: string) => Promise<void>;
  readonly sendToChat: (text: string, screen?: MarktvragenScreen) => void;
  readonly setOpen: (open: boolean) => void;
  readonly status: string;
  readonly stop: () => void;
}

export const MarktvragenChatContext =
  createContext<MarktvragenChatContextValue | null>(null);

// Components rendered outside the provider tree (e.g. JobDetail in tests or
// before hydration) get an inert context instead of a crash: chat is a
// progressive enhancement, not a mount invariant.
const DISABLED_CONTEXT: MarktvragenChatContextValue = {
  chatId: null,
  enabled: false,
  error: undefined,
  isOpen: false,
  messages: [],
  sendMessage: () => Promise.resolve(),
  sendToChat: () => null,
  setOpen: () => null,
  status: "ready",
  stop: () => null,
};

export const useMarktvragenChat = (): MarktvragenChatContextValue =>
  useContext(MarktvragenChatContext) ?? DISABLED_CONTEXT;
