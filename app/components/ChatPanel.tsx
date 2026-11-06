"use client";

import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import PawIcon from "./PawIcon";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
}

export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  onSend,
  onStartVideo,
  onEnd,
}: {
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  return (
    <section className="chat-panel" aria-label="Conversation with stranger">
      <header className="chat-panel__header">
        <div className="chat-panel__identity">
          <span className="chat-panel__avatar"><PawIcon /></span>
          <div>
            <p className="chat-panel__name">A stranger nearby</p>
            <p className="chat-panel__status">
              <span className={`chat-panel__status-dot${connected ? " is-connected" : ""}`} />
              {connected ? "Connected" : "Making a connection…"}
            </p>
          </div>
        </div>
        <div className="chat-panel__header-actions">
          <Button
            variant="secondary"
            className="chat-action"
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
          >
            Video
          </Button>
          <Button
            variant="danger"
            className="chat-action"
            onClick={onEnd}
          >
            End
          </Button>
        </div>
      </header>

      <div className="chat-panel__messages" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && (
          <div className="chat-panel__empty">
            <span className="chat-panel__empty-paw"><PawIcon /></span>
            <strong>{connected ? "Start with a hello" : "Making a connection…"}</strong>
            <span>
              {connected
                ? "Your chat is private and disappears when you leave."
                : "Your chat will open as soon as you’re connected."}
            </span>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-message${m.mine ? " is-mine" : ""}`}
          >
            <span className="chat-message__bubble">{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="chat-panel__composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          className="chat-panel__input"
          aria-label="Message"
        />
        <Button
          variant="primary"
          className="chat-action"
          type="submit"
          disabled={!connected || !draft.trim()}
        >
          Send
        </Button>
      </form>
    </section>
  );
}
