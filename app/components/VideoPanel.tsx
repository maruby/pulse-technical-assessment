"use client";

import { useEffect, useRef } from "react";
import Button from "./Button";
import PawIcon from "./PawIcon";

export default function VideoPanel({
  localStream,
  remoteStream,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <section className="video-panel" aria-label="Video call">
      <header className="video-panel__header">
        <span className="video-panel__call-mark"><PawIcon /></span>
        <div>
          <strong>Private video call</strong>
          <span>Only you and your stranger</span>
        </div>
      </header>
      <div className="video-panel__stage" aria-busy={!remoteStream}>
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="video-panel__remote"
          aria-label="Stranger’s video"
        />
        {!remoteStream && (
          <div className="video-panel__waiting" role="status" aria-live="polite">
            <span className="video-panel__waiting-paw"><PawIcon /></span>
            <strong>Waiting for their video</strong>
            <span>Just a moment while the connection settles.</span>
          </div>
        )}
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="video-panel__local"
          aria-label="Your camera preview"
        />
        <span className="video-panel__local-label">You</span>
      </div>
      <div className="video-panel__controls">
        <Button
          variant="danger"
          className="video-panel__end"
          onClick={onEnd}
        >
          End call
        </Button>
      </div>
    </section>
  );
}
