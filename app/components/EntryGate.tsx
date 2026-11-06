"use client";

import { useState } from "react";
import Button from "./Button";
import PawIcon from "./PawIcon";

export default function EntryGate({
  onReady,
}: {
  onReady: (lat: number, lng: number) => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState<string>("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void onReady(pos.coords.latitude, pos.coords.longitude).catch(() => {
          setStatus("error");
          setError("Couldn't join Pulse. Please try again.");
        });
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is required to place you on the map."
            : "Couldn't get your location. Please try again.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <main className="entry-gate">
      <div className="entry-gate__brand">
        <PawIcon className="entry-gate__paw" />
        <div>
          <h1>Pulse</h1>
          <p className="entry-gate__tagline">
            A living globe of anonymous strangers. Drop onto the map and connect.
          </p>
        </div>
      </div>

      <Button
        onClick={enter}
        disabled={status === "locating"}
        className="entry-gate__enter"
        aria-busy={status === "locating"}
      >
        {status === "locating" ? "Finding your place…" : "Enter Pulse"}
      </Button>

      {status === "locating" && (
        <p className="entry-gate__progress" role="status" aria-live="polite">
          <PawIcon /> Finding a safe place on the map…
        </p>
      )}
      {status === "error" && <p className="entry-gate__error" role="alert">{error}</p>}

      <p className="entry-gate__privacy">
        No sign-up. Your dot is placed 1–3&nbsp;km from your real location.
        Nothing is stored — closing the tab ends everything.
      </p>
    </main>
  );
}
