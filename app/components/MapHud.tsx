"use client";

import Button from "./Button";
import PawIcon from "./PawIcon";

export default function MapHud({
  online,
  onZoomIn,
  onZoomOut,
  onRecenter,
}: {
  online: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
}) {
  return (
    <>
      <header className="map-hud__brand" aria-label="Pulse">
        <span className="map-hud__mark"><PawIcon /></span>
        <span className="map-hud__wordmark">
          <strong>Pulse</strong>
          <small>meet nearby</small>
        </span>
        <span className="map-hud__divider" />
        <span className="map-hud__online">
          <span className="map-hud__online-dot" />
          <strong>{online}</strong> online
        </span>
      </header>

      <nav className="map-hud__controls" aria-label="Map controls">
        <Button variant="quiet" onClick={onZoomIn} aria-label="Zoom in">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Button>
        <Button variant="quiet" onClick={onZoomOut} aria-label="Zoom out">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </Button>
        <Button variant="quiet" onClick={onRecenter} aria-label="Center map on me">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="6.5" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
          </svg>
        </Button>
      </nav>

      <div className="map-hud__privacy">
        <PawIcon />
        <span>Nearby, never exact</span>
      </div>
    </>
  );
}
