"use client";

import Button from "./Button";
import PawIcon from "./PawIcon";
import { useEffect, useRef } from "react";

// Reusable centered prompt for "someone wants to connect" and
// "someone wants to start video".
export default function ConnectionPrompt({
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  title: string;
  subtitle?: string;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const onDeclineRef = useRef(onDecline);

  useEffect(() => {
    onDeclineRef.current = onDecline;
  }, [onDecline]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const card = cardRef.current;
    const firstButton = card?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    firstButton?.focus();

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDeclineRef.current();
        return;
      }
      if (event.key !== "Tab" || !card) return;
      const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      if (buttons.length === 0) {
        event.preventDefault();
        card.focus();
        return;
      }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", keepFocusInside);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className="connection-prompt">
      <section ref={cardRef} className="connection-prompt__card" role="dialog" aria-modal="true" aria-labelledby="connection-prompt-title" tabIndex={-1}>
        <PawIcon className="connection-prompt__icon" />
        <h2 id="connection-prompt-title">{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        <div className="connection-prompt__actions">
          <Button
            variant="secondary"
            onClick={onDecline}
          >
            {declineLabel}
          </Button>
          <Button
            onClick={onAccept}
          >
            {acceptLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
