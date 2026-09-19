"use client";

import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, X, Send, Trash2, User as UserIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  response?: string;
  sources?: Array<{ title: string; source: string }>;
  sessionId?: string;
  model?: string;
  timestamp?: string;
  latencyMs?: number;
  error?: string;
  code?: string;
  retryAfter?: number;
}

const GREETING: Message = {
  role: "assistant",
  content:
    "Hi! I'm Cirkle Assistant 🤖. Ask me anything about identity verification, document security, KYC, MRZ parsing, liveness detection, face matching, or the Cirkle platform.",
};

const INITIAL_STATE: Message[] = [GREETING];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(INITIAL_STATE);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading, open]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          sessionId,
        }),
      });

      const data: ChatResponse = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg =
          data?.error ||
          (res.status === 429
            ? "Rate limit exceeded. Please wait a moment and try again."
            : `Request failed (HTTP ${res.status})`);
        toast.error(errMsg);
        // Remove the user message we optimistically appended so the user can retry cleanly.
        setMessages(messages);
        return;
      }

      if (!data.response) {
        toast.error("Assistant returned an empty response. Please try again.");
        setMessages(messages);
        return;
      }

      if (data.sessionId) setSessionId(data.sessionId);
      setMessages([...newMessages, { role: "assistant", content: data.response }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Network error: ${msg}`);
      // Roll back optimistic append
      setMessages(messages);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleClear = useCallback(() => {
    setMessages(INITIAL_STATE);
    setSessionId(undefined);
    toast.success("Conversation cleared");
  }, []);

  return (
    <>
      {/* Floating button */}
      <motion.button
        type="button"
        aria-label={open ? "Close Cirkle Assistant" : "Open Cirkle Assistant"}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full",
          "shadow-lg border border-border",
          "bg-primary text-primary-foreground hover:bg-primary/90",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
        initial={false}
        whileTap={{ scale: 0.92 }}
        data-testid="chat-widget-toggle"
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="x"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <X className="h-6 w-6" />
            </motion.span>
          ) : (
            <motion.span
              key="bot"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Bot className="h-6 w-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "fixed z-50 flex flex-col bg-background border border-border rounded-2xl shadow-2xl overflow-hidden",
              // Mobile: full-screen-ish; Desktop: fixed-size floating panel
              "inset-2 bottom-2 top-2 sm:inset-auto sm:bottom-20 sm:right-4 sm:top-auto",
              "sm:w-[400px] sm:h-[600px] sm:max-h-[80vh]",
            )}
            role="dialog"
            aria-label="Cirkle Assistant chat"
            aria-modal="false"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-primary/10 via-background to-background px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <Avatar className="h-8 w-8 bg-primary text-primary-foreground">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">Cirkle Assistant</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    Identity verification · KYC · MRZ · liveness
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClear}
                  aria-label="Clear conversation"
                  className="h-8 w-8"
                  title="Clear conversation"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  aria-label="Close chat"
                  className="h-8 w-8"
                  title="Close chat"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-3 py-4 space-y-4 bg-muted/30 scroll-smooth"
              style={{
                scrollbarWidth: "thin",
              }}
            >
              {messages.map((m, i) => (
                <MessageBubble key={`${i}-${m.role}`} message={m} />
              ))}
              {loading && <TypingIndicator />}
            </div>

            {/* Input row */}
            <div className="border-t border-border bg-background px-3 py-2 flex items-center gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about KYC, MRZ, liveness…"
                disabled={loading}
                aria-label="Message input"
                className="flex-1"
                maxLength={1000}
              />
              <Button
                onClick={() => void handleSend()}
                disabled={loading || !input.trim()}
                size="icon"
                aria-label="Send message"
                className="h-9 w-9"
                title="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex gap-2 items-start",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <Avatar
        className={cn(
          "h-7 w-7 shrink-0",
          isUser
            ? "bg-muted text-foreground border border-border"
            : "bg-primary text-primary-foreground",
        )}
      >
        <AvatarFallback
          className={cn(
            "text-[10px] font-bold",
            isUser
              ? "bg-muted text-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[320px] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-background border border-border rounded-tl-sm",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_pre]:my-2 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre_code]:bg-transparent [&_pre_code]:p-0">
            <ReactMarkdown
              components={{
                // Open external links in a new tab; strip the react-markdown
                // `node` prop so it isn't passed through to the DOM.
                a: ({ node: _node, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2 items-start">
      <Avatar className="h-7 w-7 bg-primary text-primary-foreground shrink-0">
        <AvatarFallback className="bg-primary text-primary-foreground">
          <Bot className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="rounded-2xl rounded-tl-sm bg-background border border-border px-3 py-3">
        <div className="flex items-center gap-1">
          <Dot delay="0ms" />
          <Dot delay="200ms" />
          <Dot delay="400ms" />
        </div>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-muted-foreground/70 animate-bounce"
      style={{ animationDelay: delay, animationDuration: "1s" }}
    />
  );
}
