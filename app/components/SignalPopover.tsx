"use client";

import { useEffect, useRef, useState } from "react";
import type { PeerDot } from "@/lib/types";
import Button from "./Button";
import PawIcon from "./PawIcon";

const EMOJI: Record<string, string> = {
  Exploring: "🧭", "Casual Chat": "☕", Gaming: "🎮", Music: "🎵",
  "Deep Conversations": "🌙", "Just Passing By": "👋",
  "Looking for Recommendations": "💡", Custom: "✨",
};

export default function SignalPopover({
  peer,
  canWave,
  canBlock,
  onWave,
  onReport,
  onBlock,
  onClose,
}: {
  peer: PeerDot;
  canWave: boolean;
  canBlock: boolean;
  onWave: () => void;
  onReport: (reason: string) => Promise<boolean>;
  onBlock: () => Promise<boolean>;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const [safetyAction, setSafetyAction] = useState<"report" | "block" | null>(null);
  const [reason, setReason] = useState("");
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyFeedback, setSafetyFeedback] = useState("");
  const activity = peer.activity;
  const category = activity?.category ?? "Exploring";

  async function submitReport() {
    setSafetyBusy(true);
    setSafetyFeedback("");
    try {
      if (await onReport(reason.trim())) onClose();
      else setSafetyFeedback("Couldn’t send the report. Please try again.");
    } finally {
      setSafetyBusy(false);
    }
  }

  async function confirmBlock() {
    setSafetyBusy(true);
    setSafetyFeedback("");
    try {
      if (await onBlock()) onClose();
      else setSafetyFeedback("Couldn’t block this person. Please try again.");
    } finally {
      setSafetyBusy(false);
    }
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    cardRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  return (
    <section ref={cardRef} className="signal-popover" role="dialog" aria-labelledby="signal-popover-title">
      <button type="button" className="peer-popover__close" aria-label="Close Signal details" onClick={onClose}>×</button>
      <span className="signal-popover__emoji" aria-hidden="true">{EMOJI[category]}</span>
      <div className="signal-popover__content">
        <span className="signal-popover__eyebrow">A nearby Signal</span>
        <h2 id="signal-popover-title">{category}</h2>
        {activity?.message && <p className="signal-popover__message">{activity.message}</p>}
        <p className="signal-popover__privacy"><PawIcon /> Approximate location · anonymous</p>
        {safetyAction === "report" ? (
          <div className="signal-popover__safety-form">
            <label htmlFor="signal-report-reason">What should we know? <span>Optional</span></label>
            <textarea id="signal-report-reason" rows={2} maxLength={500} value={reason} disabled={safetyBusy} onChange={(event) => setReason(event.target.value)} />
            {safetyFeedback && <p className="signal-popover__feedback" role="alert">{safetyFeedback}</p>}
            <div><Button variant="quiet" disabled={safetyBusy} onClick={() => setSafetyAction(null)}>Cancel</Button><Button variant="danger" disabled={safetyBusy} onClick={() => void submitReport()}>{safetyBusy ? "Sending…" : "Send report"}</Button></div>
          </div>
        ) : safetyAction === "block" ? (
          <div className="signal-popover__safety-form">
            <p>Block this person? Their Signals and connection requests will be hidden from you.</p>
            {safetyFeedback && <p className="signal-popover__feedback" role="alert">{safetyFeedback}</p>}
            <div><Button variant="quiet" disabled={safetyBusy} onClick={() => setSafetyAction(null)}>Cancel</Button><Button variant="danger" disabled={safetyBusy} onClick={() => void confirmBlock()}>{safetyBusy ? "Blocking…" : "Block"}</Button></div>
          </div>
        ) : (
          <>
            <Button disabled={!canWave || peer.busy} onClick={onWave}>{peer.busy ? "In a conversation" : "Wave hello"}</Button>
            <div className="signal-popover__safety-actions">
              <button type="button" onClick={() => setSafetyAction("report")}>Report Signal</button>
              <button type="button" disabled={!canBlock} onClick={() => setSafetyAction("block")}>Block</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
