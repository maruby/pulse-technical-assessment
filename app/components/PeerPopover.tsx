import { useEffect, useRef, useState } from "react";
import type { PeerDot } from "@/lib/types";
import Button from "./Button";
import PawIcon from "./PawIcon";

export default function PeerPopover({
  peer,
  canConnect,
  onConnect,
  onClose,
  onBlock,
  canBlock,
}: {
  peer: PeerDot;
  canConnect: boolean;
  onConnect: () => void;
  onClose: () => void;
  onBlock: () => Promise<boolean>;
  canBlock: boolean;
}) {
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState(false);
  const popoverRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  async function confirmBlocking() {
    setBlockBusy(true);
    setBlockError(false);
    try {
      if (!(await onBlock())) setBlockError(true);
    } finally {
      setBlockBusy(false);
    }
  }

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
      <div className="peer-popover__actions">
        {confirmBlock ? (
          <>
            <Button variant="quiet" disabled={blockBusy} onClick={() => setConfirmBlock(false)}>Cancel</Button>
            <Button variant="danger" disabled={blockBusy} onClick={() => void confirmBlocking()}>{blockBusy ? "Blocking…" : "Block"}</Button>
          </>
        ) : (
          <>
            <Button disabled={!canConnect || peer.busy} onClick={onConnect}>
              {peer.busy ? "Busy" : "Say hello"}
            </Button>
            <button type="button" className="peer-popover__block" disabled={!canBlock} onClick={() => setConfirmBlock(true)}>Block</button>
          </>
        )}
        {blockError && <span className="peer-popover__feedback" role="alert">Couldn’t block this person. Try again.</span>}
      </div>
    </section>
  );
}
