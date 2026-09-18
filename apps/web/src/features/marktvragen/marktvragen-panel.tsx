"use client";

import { Button } from "@ji/ui/components/button";
import { isToolUIPart } from "ai";
import { MessageSquare, SendHorizonal, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useMarktvragenChat } from "./marktvragen-chat-context";
import { MarktvragenToolPart } from "./tool-widgets";

export const MarktvragenMessages = () => {
  const { error, messages, status } = useMarktvragenChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      behavior: "smooth",
      top: scrollRef.current.scrollHeight,
    });
  }, [messages, status]);

  return (
    <div
      aria-live="polite"
      className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-4"
      ref={scrollRef}
    >
      {messages.length === 0 ? (
        <div className="space-y-2 px-1 pt-6 text-center">
          <p className="text-sm font-medium">Stel een vraag over de markt</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Bijvoorbeeld: “Hoeveel open aanvragen staan er per bron?” of “Wat is
            de mediana van het uurtarief?”. De agent schrijft en valideert SQL
            op het marts-schema; elke query blijft zichtbaar.
          </p>
        </div>
      ) : null}
      {messages.map((message) => (
        <div
          className={
            message.role === "user" ? "flex justify-end" : "flex justify-start"
          }
          key={message.id}
        >
          <div
            className={
              message.role === "user"
                ? "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                : "w-full max-w-full space-y-1 text-sm"
            }
          >
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return (
                  <p
                    className="leading-relaxed whitespace-pre-wrap"
                    key={index}
                  >
                    {part.text}
                  </p>
                );
              }
              if (isToolUIPart(part)) {
                return <MarktvragenToolPart key={index} part={part} />;
              }
              return null;
            })}
          </div>
        </div>
      ))}
      {status === "submitted" || status === "streaming" ? (
        <p className="text-xs text-muted-foreground">Agent denkt na…</p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          {error.message}
        </p>
      ) : null}
    </div>
  );
};

export const MarktvragenComposer = () => {
  const { enabled, sendMessage, status, stop } = useMarktvragenChat();
  const [draft, setDraft] = useState("");
  const busy = status === "submitted" || status === "streaming";

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      return;
    }
    setDraft("");
    void sendMessage(text);
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-border px-3 py-3"
      onSubmit={onSubmit}
    >
      <label className="sr-only" htmlFor="marktvragen-input">
        Vraag aan de Marktvragen-agent
      </label>
      <textarea
        aria-label="Vraag aan de Marktvragen-agent"
        className="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        disabled={!enabled}
        id="marktvragen-input"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit(event);
          }
        }}
        placeholder="Stel een marktvraag…"
        rows={1}
        value={draft}
      />
      {busy ? (
        <Button
          aria-label="Stop genereren"
          onClick={stop}
          size="icon"
          type="button"
          variant="outline"
        >
          <Square aria-hidden="true" />
        </Button>
      ) : (
        <Button
          aria-label="Verstuur vraag"
          disabled={!enabled || !draft.trim()}
          size="icon"
          type="submit"
        >
          <SendHorizonal aria-hidden="true" />
        </Button>
      )}
    </form>
  );
};

/** Collapsible sidebar panel — the AgentSidebar pattern from the analysis. */
export const MarktvragenPanel = () => {
  const { isOpen, setOpen } = useMarktvragenChat();

  if (!isOpen) {
    return null;
  }

  return (
    <aside
      aria-label="Marktvragen chat"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl sm:w-96"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <MessageSquare aria-hidden="true" className="size-4 text-primary" />
        <h2 className="flex-1 text-sm font-semibold">Marktvragen</h2>
        <button
          aria-label="Marktvragen-paneel sluiten"
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen(false)}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <MarktvragenMessages />
      <MarktvragenComposer />
    </aside>
  );
};

/** Floating open button — visible on every screen, bottom right. */
export const MarktvragenFab = () => {
  const { enabled, isOpen, setOpen } = useMarktvragenChat();

  if (!enabled || isOpen) {
    return null;
  }

  return (
    <button
      aria-label="Marktvragen-chat openen"
      className="fixed right-4 bottom-4 z-40 grid size-11 place-items-center rounded-full border border-border bg-primary text-primary-foreground shadow-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setOpen(true)}
      type="button"
    >
      <MessageSquare aria-hidden="true" className="size-5" />
    </button>
  );
};
