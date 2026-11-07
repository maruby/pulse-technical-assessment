"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { GeoJSONSource, Map as MapboxMap, Marker } from "mapbox-gl";
import type { Popup } from "mapbox-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { createRoot, type Root } from "react-dom/client";
import type { PeerDot } from "@/lib/types";
import MapHud from "./MapHud";
import PawIcon from "./PawIcon";
import PeerPopover from "./PeerPopover";
import SignalPopover from "./SignalPopover";
import type { ActivityCategory } from "@/lib/types";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "pk.eyJ1IjoicHVsc2UtbWFwIiwiYSI6ImNrMDBkZW1vMDAwMDAwMDAifQ.AAAAAAAAAAAAAAAAAAAAAA";
const PEER_SOURCE = "pulse-peer-clusters";
const CLUSTER_LAYER = "pulse-peer-clusters";
const CLUSTER_CIRCLES = "pulse-peer-cluster-backgrounds";
const CONNECTION_SOURCE = "pulse-active-connection";
const CONNECTION_GLOW = "pulse-active-connection-glow";
const CONNECTION_LINE = "pulse-active-connection-line";

type PeerFeatureProperties = { id: string; busy: boolean };

export default function WorldMap({
  peers,
  me,
  onPeerClick,
  canConnect,
  activePeerId,
  myActivity,
  isLeader,
  pollStatus,
  onSignalWave,
  onReportSignal,
  onBlockPeer,
  onCreateActivity,
  onRemoveActivity,
  onLogout,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
  activePeerId: string | null;
  myActivity: { id: string; category: ActivityCategory } | null;
  isLeader: boolean;
  pollStatus: "connecting" | "connected" | "reconnecting";
  onSignalWave: (peerId: string, signalId: string) => void;
  onReportSignal: (signalId: string, reason: string) => Promise<boolean>;
  onBlockPeer: (peerId: string) => Promise<boolean>;
  onCreateActivity: () => void;
  onRemoveActivity: () => void;
  onLogout: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const popoverRef = useRef<{ popup: Popup; root: Root; peerId: string } | null>(null);
  const peersRef = useRef(peers);
  const onPeerClickRef = useRef(onPeerClick);
  const onSignalWaveRef = useRef(onSignalWave);
  const onReportSignalRef = useRef(onReportSignal);
  const onBlockPeerRef = useRef(onBlockPeer);
  const canConnectRef = useRef(canConnect);
  const isLeaderRef = useRef(isLeader);
  const selectedPeerRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    peersRef.current = peers;
    onPeerClickRef.current = onPeerClick;
    onSignalWaveRef.current = onSignalWave;
    onReportSignalRef.current = onReportSignal;
    onBlockPeerRef.current = onBlockPeer;
    canConnectRef.current = canConnect;
    isLeaderRef.current = isLeader;
    if (canConnect && !popoverRef.current) selectedPeerRef.current = null;
  }, [peers, onPeerClick, canConnect, isLeader, onSignalWave, onReportSignal, onBlockPeer]);

  useEffect(() => {
    const active = popoverRef.current;
    const peer = active && peers.find((item) => item.id === active.peerId);
    if (!active || !peer) return;
    active.root.render(renderPeerCard(peer, canConnect, isLeader, {
      onClose: () => active.popup.remove(),
      onConnect: () => {
        if (!canConnect || peer.busy) return;
        selectedPeerRef.current = peer.id;
        active.popup.remove();
        onPeerClickRef.current(peer.id);
      },
      onWave: () => {
        if (!canConnect || peer.busy || !peer.activity) return;
        active.popup.remove();
        onSignalWaveRef.current(peer.id, peer.activity.id);
      },
      onReport: (reason) => peer.activity ? onReportSignalRef.current(peer.activity.id, reason) : Promise.resolve(false),
      onBlock: () => isLeaderRef.current ? onBlockPeerRef.current(peer.id) : Promise.resolve(false),
    }));
  }, [peers, canConnect, isLeader]);

  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: me ? [me.lng, me.lat] : [0, 20],
        zoom: me ? 4 : 1.4,
        attributionControl: true,
      });
      mapRef.current = map;
      map.on("error", () => {
        if (!cancelled) setMapError(true);
      });

      map.on("load", () => {
        if (cancelled) return;
        const closePopover = (preserveSelection = false) => {
          const current = popoverRef.current;
          if (!current) return;
          popoverRef.current = null;
          current.root.unmount();
          current.popup.remove();
          if (!preserveSelection) {
            selectedPeerRef.current = null;
            for (const marker of markersRef.current.values()) {
              marker.getElement().classList.remove("is-selected");
            }
          }
        };
        const pawImage = new Image(48, 48);
        pawImage.onload = () => {
          if (cancelled || mapRef.current !== map) return;
          map.addImage("pulse-paw", pawImage);
          map.addSource(PEER_SOURCE, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            cluster: true,
            clusterRadius: 50,
            clusterMaxZoom: 14,
          });
          map.addSource(CONNECTION_SOURCE, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: CONNECTION_GLOW,
            type: "line",
            source: CONNECTION_SOURCE,
            paint: {
              "line-color": "#fce8d5",
              "line-width": 8,
              "line-opacity": 0.9,
              "line-blur": 1.5,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          map.addLayer({
            id: CONNECTION_LINE,
            type: "line",
            source: CONNECTION_SOURCE,
            paint: {
              "line-color": "#e87924",
              "line-width": 2.5,
              "line-opacity": 0.95,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          map.addLayer({
            id: CLUSTER_CIRCLES,
            type: "circle",
            source: PEER_SOURCE,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#fff9f1",
              "circle-radius": ["step", ["get", "point_count"], 22, 10, 26, 50, 30],
              "circle-stroke-color": "#f28c38",
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: CLUSTER_LAYER,
            type: "symbol",
            source: PEER_SOURCE,
            filter: ["has", "point_count"],
            layout: {
              "icon-image": "pulse-paw",
              "icon-size": ["step", ["get", "point_count"], 0.46, 10, 0.56, 50, 0.64],
              "icon-allow-overlap": true,
              "text-field": ["get", "point_count_abbreviated"],
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-size": 11,
              "text-offset": [0, 1.55],
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": "#39332e",
              "text-halo-color": "#fff9f1",
              "text-halo-width": 2,
            },
          });

          map.on("click", CLUSTER_LAYER, (event) => {
            const feature = event.features?.[0];
            const clusterId = feature?.properties?.cluster_id;
            const geometry = feature?.geometry;
            if (typeof clusterId !== "number" || geometry?.type !== "Point") return;
            const source = map.getSource(PEER_SOURCE) as GeoJSONSource;
            source.getClusterExpansionZoom(clusterId, (error, zoom) => {
              if (error || zoom === null || zoom === undefined) return;
              map.easeTo({
                center: geometry.coordinates as [number, number],
                zoom,
                duration: 500,
              });
            });
          });
          map.on("mouseenter", CLUSTER_LAYER, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", CLUSTER_LAYER, () => {
            map.getCanvas().style.cursor = "";
          });
          map.on("idle", () => {
            if (cancelled) return;
            const sourceFeatures = map.querySourceFeatures(PEER_SOURCE);
            const unclustered = new Set<string>();
            for (const feature of sourceFeatures) {
              const props = feature.properties as
                | (PeerFeatureProperties & { point_count?: number })
                | null;
              if (props?.id && props.point_count === undefined) {
                unclustered.add(props.id);
              }
            }

            const currentPeers = peersRef.current;
            if (
              popoverRef.current &&
              (!currentPeers.some((peer) => peer.id === popoverRef.current?.peerId) ||
                !unclustered.has(popoverRef.current.peerId))
            ) {
              closePopover();
            }
            for (const peer of currentPeers) {
              if (!unclustered.has(peer.id)) continue;
              let marker = markersRef.current.get(peer.id);
              if (!marker) {
                const el = document.createElement("button");
                el.type = "button";
                el.className = "paw-marker is-online";
                el.setAttribute("aria-label", "Connect with online stranger");
                el.title = "Tap to connect";
                el.innerHTML = '<img src="/paw-print.svg" alt="" /><span class="paw-marker__signal-category" aria-hidden="true"></span>';
                el.addEventListener("click", (clickEvent) => {
                  clickEvent.stopPropagation();
                  const currentPeer = peersRef.current.find((item) => item.id === peer.id);
                  if (!currentPeer) return;
                  closePopover();
                  selectedPeerRef.current = currentPeer.id;
                  for (const [id, existing] of markersRef.current) {
                    existing.getElement().classList.toggle("is-selected", id === currentPeer.id);
                  }
                  const element = document.createElement("div");
                  const root = createRoot(element);
                  const popup = new mapboxgl.Popup({
                    closeButton: false,
                    closeOnClick: true,
                    maxWidth: "300px",
                    offset: 26,
                    className: "pulse-map-popup",
                  })
                    .setLngLat([currentPeer.lng, currentPeer.lat])
                    .setDOMContent(element)
                    .addTo(map);
                  const activePopover = { popup, root, peerId: currentPeer.id };
                  popoverRef.current = activePopover;
                  popup.on("close", () => {
                    if (popoverRef.current !== activePopover) return;
                    popoverRef.current = null;
                    root.unmount();
                    selectedPeerRef.current = null;
                    for (const marker of markersRef.current.values()) {
                      marker.getElement().classList.remove("is-selected");
                    }
                    const trigger = markersRef.current.get(currentPeer.id)?.getElement();
                    if (trigger?.isConnected) trigger.focus();
                  });
                  root.render(renderPeerCard(currentPeer, canConnectRef.current, isLeaderRef.current, {
                    onClose: () => closePopover(),
                    onConnect: () => {
                      if (!canConnectRef.current || currentPeer.busy) return;
                      closePopover(true);
                      onPeerClickRef.current(currentPeer.id);
                    },
                    onWave: () => {
                      if (!canConnectRef.current || currentPeer.busy || !currentPeer.activity) return;
                      closePopover(true);
                      onSignalWaveRef.current(currentPeer.id, currentPeer.activity.id);
                    },
                    onReport: (reason) => currentPeer.activity ? onReportSignalRef.current(currentPeer.activity.id, reason) : Promise.resolve(false),
                    onBlock: () => isLeaderRef.current ? onBlockPeerRef.current(currentPeer.id) : Promise.resolve(false),
                  }));
                });
                marker = new mapboxgl.Marker({ element: el, anchor: "center" })
                  .setLngLat([peer.lng, peer.lat])
                  .addTo(map);
                markersRef.current.set(peer.id, marker);
              } else {
                marker.setLngLat([peer.lng, peer.lat]);
              }
              const element = marker.getElement();
              element.classList.toggle("is-busy", peer.busy);
              element.classList.toggle("is-selected", selectedPeerRef.current === peer.id);
              element.classList.toggle("paw-marker--signal", Boolean(peer.activity));
              const category = element.querySelector<HTMLElement>(".paw-marker__signal-category");
              if (category) category.textContent = peer.activity ? signalEmoji(peer.activity.category) : "";
              (element as HTMLButtonElement).disabled = false;
              element.setAttribute(
                "aria-label",
                peer.activity
                  ? `${peer.activity.category} Signal, ${peer.busy ? "currently chatting" : "available to wave"}`
                  : peer.busy ? "Online stranger, currently chatting" : "Connect with online stranger",
              );
            }

            for (const [id, marker] of markersRef.current) {
              if (!unclustered.has(id)) {
                marker.remove();
                markersRef.current.delete(id);
              }
            }
          });
          setReady(true);
        };
        pawImage.onerror = () => {
          if (!cancelled) setReady(true);
        };
        pawImage.src = "/paw-print.svg";
      });
    })();

    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The user's coordinates are only used for the initial camera position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !mapRef.current) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "paw-marker paw-marker--me";
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", "Your location");
        el.innerHTML = '<span class="paw-marker__you">You</span><img src="/paw-print.svg" alt="" />';
        meMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(PEER_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: peers.map((peer) => ({
        type: "Feature",
        id: peer.id,
        geometry: { type: "Point", coordinates: [peer.lng, peer.lat] },
        properties: { id: peer.id, busy: peer.busy },
      })),
    });
  }, [peers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(CONNECTION_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const connectedPeer = activePeerId
      ? peers.find((peer) => peer.id === activePeerId)
      : undefined;
    if (!me || !connectedPeer) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const points = createGeodesicPath([me.lng, me.lat], [connectedPeer.lng, connectedPeer.lat]);
    const segments = splitAtAntimeridian(points);
    const geometry: Geometry = segments.length > 1
      ? { type: "MultiLineString", coordinates: segments }
      : { type: "LineString", coordinates: segments[0] ?? points };
    const feature: Feature<Geometry> = {
      type: "Feature",
      properties: {},
      geometry,
    };
    const data: FeatureCollection<Geometry> = {
      type: "FeatureCollection",
      features: [feature],
    };
    source.setData(data);
  }, [activePeerId, me, peers, ready]);

  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const peer = peers.find((item) => item.id === id);
      if (!peer) continue;
      const element = marker.getElement() as HTMLButtonElement;
      element.disabled = false;
      element.classList.toggle("is-busy", peer.busy);
      element.classList.toggle("is-selected", selectedPeerRef.current === id);
    }
  }, [peers, canConnect]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full bg-[#fff9f1]" />

      {!ready && TOKEN && !mapError && (
        <div className="map-loading" role="status" aria-live="polite" aria-busy="true">
          <PawIcon className="map-loading__paw" />
          <span>Finding your place on the globe…</span>
        </div>
      )}

      {mapError && !ready && (
        <div className="map-loading map-loading--error" role="alert">
          <PawIcon className="map-loading__paw" />
          <span>The map couldn’t load. Check your connection and refresh to try again.</span>
        </div>
      )}

      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-md rounded-lg bg-white p-4 text-sm text-[#39332e] shadow-lg">
            Set <code className="text-[#df7624]">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> to load the map.
          </p>
        </div>
      )}

      <MapHud
        online={peers.length}
        myActivity={myActivity}
        canEditActivity={isLeader}
        pollStatus={pollStatus}
        onCreateActivity={onCreateActivity}
        onRemoveActivity={onRemoveActivity}
        onLogout={onLogout}
        onZoomIn={() => mapRef.current?.zoomIn({ duration: 240 })}
        onZoomOut={() => mapRef.current?.zoomOut({ duration: 240 })}
        onRecenter={() => {
          const map = mapRef.current;
          if (!map) return;
          map.flyTo({
            center: me ? [me.lng, me.lat] : [0, 20],
            zoom: me ? Math.max(4, map.getZoom()) : 1.4,
            duration: 650,
          });
        }}
      />

      {ready && peers.length === 0 && (
        <div className="map-empty-state" role="status">
          <PawIcon />
          <strong>It’s quiet out here</strong>
          <span>Keep the map open. New paws appear as people arrive.</span>
        </div>
      )}
    </div>
  );
}

function renderPeerCard(
  peer: PeerDot,
  canConnect: boolean,
  canBlock: boolean,
  actions: {
    onClose: () => void;
    onConnect: () => void;
    onWave: () => void;
    onReport: (reason: string) => Promise<boolean>;
    onBlock: () => Promise<boolean>;
  },
) {
  if (peer.activity) {
    return (
      <SignalPopover
        peer={peer}
        canWave={canConnect && !peer.busy}
        canBlock={canBlock}
        onWave={actions.onWave}
        onReport={actions.onReport}
        onBlock={actions.onBlock}
        onClose={actions.onClose}
      />
    );
  }
  return (
    <PeerPopover
      peer={peer}
      canConnect={canConnect && !peer.busy}
      canBlock={canBlock}
      onClose={actions.onClose}
      onConnect={actions.onConnect}
      onBlock={actions.onBlock}
    />
  );
}

function signalEmoji(category: ActivityCategory) {
  const emoji: Record<ActivityCategory, string> = {
    Exploring: "🧭",
    "Casual Chat": "☕",
    Gaming: "🎮",
    Music: "🎵",
    "Deep Conversations": "🌙",
    "Just Passing By": "👋",
    "Looking for Recommendations": "💡",
    Custom: "✨",
  };
  return emoji[category] ?? "✨";
}

function createGeodesicPath(
  start: [number, number],
  end: [number, number],
  steps = 64,
): [number, number][] {
  const toVector = ([lng, lat]: [number, number]): [number, number, number] => {
    const latitude = (lat * Math.PI) / 180;
    const longitude = (lng * Math.PI) / 180;
    return [
      Math.cos(latitude) * Math.cos(longitude),
      Math.cos(latitude) * Math.sin(longitude),
      Math.sin(latitude),
    ];
  };
  const a = toVector(start);
  const b = toVector(end);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot);
  const path: [number, number][] = [];

  if (angle > Math.PI - 1e-8) {
    let longitudeDelta = end[0] - start[0];
    if (longitudeDelta > 180) longitudeDelta -= 360;
    if (longitudeDelta < -180) longitudeDelta += 360;
    return Array.from({ length: steps + 1 }, (_, index) => {
      const t = index / steps;
      return [start[0] + longitudeDelta * t, start[1] + (end[1] - start[1]) * t];
    });
  }

  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    let vector: [number, number, number];
    if (angle < 1e-8 || Math.abs(Math.sin(angle)) < 1e-8) {
      vector = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
    } else {
      const startWeight = Math.sin((1 - t) * angle) / Math.sin(angle);
      const endWeight = Math.sin(t * angle) / Math.sin(angle);
      vector = [
        a[0] * startWeight + b[0] * endWeight,
        a[1] * startWeight + b[1] * endWeight,
        a[2] * startWeight + b[2] * endWeight,
      ];
    }
    const magnitude = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    const x = vector[0] / magnitude;
    const y = vector[1] / magnitude;
    const z = vector[2] / magnitude;
    path.push([
      (Math.atan2(y, x) * 180) / Math.PI,
      (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI,
    ]);
  }
  return path;
}

function splitAtAntimeridian(points: [number, number][]): [number, number][][] {
  if (points.length < 2) return [points];
  const segments: [number, number][][] = [[points[0]]];
  let current = segments[0];

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const next = points[index];
    const delta = next[0] - previous[0];
    if (Math.abs(delta) <= 180) {
      current.push(next);
      continue;
    }

    const unwrappedLongitude = next[0] + (delta > 180 ? -360 : 360);
    const boundary = delta > 180 ? -180 : 180;
    const ratio = (boundary - previous[0]) / (unwrappedLongitude - previous[0]);
    const boundaryLatitude = previous[1] + (next[1] - previous[1]) * ratio;
    current.push([boundary, boundaryLatitude]);
    current = [[-boundary, boundaryLatitude], next];
    segments.push(current);
  }
  return segments;
}
