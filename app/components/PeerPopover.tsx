import { useEffect, useRef } from "react";
import type { PeerDot } from "@/lib/types";
import Button from "./Button";
import PawIcon from "./PawIcon";

export default function PeerPopover({
  peer,
  canConnect,
  onConnect,
  onClose,
}: {
  peer: PeerDot;
  canConnect: boolean;
  onConnect: () => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    popoverRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <section ref={popoverRef} className="peer-popover" role="dialog" aria-labelledby="peer-popover-title">
      <button
        className="peer-popover__close"
        type="button"
        aria-label="Close stranger details"
        onClick={onClose}
      >
        ×
      </button>
      <span className="peer-popover__paw"><PawIcon /></span>
      <div className="peer-popover__details">
        <strong id="peer-popover-title">A stranger nearby</strong>
        <span>{peer.busy ? "In a conversation" : "Online and open to chat"}</span>
      </div>
      <Button disabled={!canConnect || peer.busy} onClick={onConnect}>
        {peer.busy ? "Busy" : "Say hello"}
      </Button>
    </section>
  );
}
