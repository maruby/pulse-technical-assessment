"use client";

import Button from "./Button";
import PawIcon from "./PawIcon";
import type { WaveNotification } from "@/lib/types";
import { useEffect, useRef } from "react";

export default function IncomingWavePrompt({
  wave,
  busy,
  onAccept,
  onDecline,
  onIgnore,
}: {
  wave: WaveNotification;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onIgnore: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onIgnoreRef = useRef(onIgnore);

  useEffect(() => {
    onIgnoreRef.current = onIgnore;
  }, [onIgnore]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onIgnoreRef.current();
      } else if (event.key === "Tab" && dialog) {
        const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
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
    <div className="connection-prompt">
      <section ref={dialogRef} className="connection-prompt__card wave-prompt" role="dialog" aria-modal="true" aria-labelledby="wave-prompt-title" tabIndex={-1}>
        <PawIcon className="connection-prompt__icon" />
        <span className="wave-prompt__category">{wave.category}</span>
        <h2 id="wave-prompt-title">Someone waved hello</h2>
        <p>{wave.message || "They’d like to connect with you."}</p>
        <div className="connection-prompt__actions wave-prompt__actions">
          <Button variant="quiet" disabled={busy} onClick={onIgnore}>Ignore</Button>
          <Button variant="secondary" disabled={busy} onClick={onDecline}>Decline</Button>
          <Button disabled={busy} onClick={onAccept}>{busy ? "Connecting…" : "Accept"}</Button>
        </div>
      </section>
    </div>
  );
}
