"use client";

import Button from "./Button";
import PawIcon from "./PawIcon";
import type { ActivityCategory } from "@/lib/types";

export default function MapHud({
  online,
  onZoomIn,
  onZoomOut,
  onRecenter,
  myActivity,
  canEditActivity,
  onCreateActivity,
  onRemoveActivity,
  onLogout,
}: {
  online: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
  myActivity: { category: ActivityCategory } | null;
  canEditActivity: boolean;
  onCreateActivity: () => void;
  onRemoveActivity: () => void;
  onLogout: () => void;
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
        <button type="button" className="map-hud__logout" onClick={onLogout} aria-label="Leave Pulse and end this session">
          Leave
        </button>
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

      <div className="map-hud__signal-actions">
        <Button className="map-hud__create-signal" disabled={!canEditActivity} onClick={onCreateActivity}>
          <PawIcon /> {myActivity ? "Edit your Signal" : "Create a Signal"}
        </Button>
        {myActivity && (
          <div className="map-hud__active-signal" role="status">
            <span aria-hidden="true">●</span> Your Signal is active · {myActivity.category}
            <button type="button" disabled={!canEditActivity} onClick={onRemoveActivity}>Remove</button>
          </div>
        )}
        {!canEditActivity && <span className="map-hud__tab-note">Pulse is active in another tab</span>}
      </div>

      <div className="map-hud__privacy">
        <PawIcon />
        <span>Nearby, never exact</span>
      </div>
    </>
  );
}
