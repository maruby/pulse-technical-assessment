"use client";

import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import PawIcon from "./PawIcon";
import { ACTIVITY_CATEGORIES, type ActivityCategory } from "@/lib/types";

const CATEGORY_EMOJI: Record<ActivityCategory, string> = {
  Exploring: "🧭",
  "Casual Chat": "☕",
  Gaming: "🎮",
  Music: "🎵",
  "Deep Conversations": "🌙",
  "Just Passing By": "👋",
  "Looking for Recommendations": "💡",
  Custom: "✨",
};

export default function SignalComposer({
  currentCategory,
  currentMessage,
  busy,
  onPublish,
  onRemove,
  onClose,
}: {
  currentCategory?: ActivityCategory;
  currentMessage?: string | null;
  busy: boolean;
  onPublish: (category: ActivityCategory, message: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const [category, setCategory] = useState<ActivityCategory>(currentCategory ?? "Exploring");
  const [message, setMessage] = useState(currentMessage ?? "");

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>("button:not(:disabled), textarea:not(:disabled)")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === "Tab" && sheet) {
        const items = Array.from(sheet.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)"));
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <div className="signal-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={sheetRef} className="signal-sheet" role="dialog" aria-modal="true" aria-labelledby="signal-sheet-title" tabIndex={-1}>
        <div className="signal-sheet__handle" aria-hidden="true" />
        <header className="signal-sheet__header">
          <span className="signal-sheet__paw"><PawIcon /></span>
          <div>
            <h2 id="signal-sheet-title">What are you in the mood for?</h2>
            <p>Let nearby people know what kind of connection sounds good.</p>
          </div>
          <button type="button" className="signal-sheet__close" onClick={onClose} aria-label="Close Signal editor">×</button>
        </header>

        <fieldset className="signal-sheet__categories" disabled={busy}>
          <legend>Choose an activity</legend>
          {ACTIVITY_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              className={`signal-category${category === item ? " is-selected" : ""}`}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              <span aria-hidden="true">{CATEGORY_EMOJI[item]}</span>
              {item}
            </button>
          ))}
        </fieldset>

        <label className="signal-sheet__message-label" htmlFor="signal-message">Optional note</label>
        <textarea
          id="signal-message"
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, 120))}
          maxLength={120}
          rows={3}
          placeholder="Add a little context…"
          disabled={busy}
        />
        <span className="signal-sheet__counter" aria-live="polite">{message.length}/120</span>

        <div className="signal-preview" aria-label="Signal preview">
          <span className="signal-preview__emoji" aria-hidden="true">{CATEGORY_EMOJI[category]}</span>
          <span><strong>{category}</strong><small>{message.trim() || "Your optional note will appear here."}</small></span>
        </div>
        <div className="signal-sheet__actions">
          {currentCategory && <Button variant="danger" disabled={busy} onClick={onRemove}>Remove Signal</Button>}
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => onPublish(category, message.trim())}>
            {busy ? "Saving…" : currentCategory ? "Update Signal" : "Publish Signal"}
          </Button>
        </div>
      </section>
    </div>
  );
}
