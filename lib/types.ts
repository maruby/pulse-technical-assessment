// Shared types across client + API.

// Signal mailbox message types.
export type SignalType =
  | "request" // connection request (tap a dot)
  | "accept" // recipient accepted
  | "decline" // recipient declined (or auto-declined while busy)
  | "offer" // WebRTC SDP offer
  | "answer" // WebRTC SDP answer
  | "ice" // WebRTC ICE candidate
  | "end"; // hang up / leave the connection

export const ACTIVITY_CATEGORIES = [
  "Exploring",
  "Casual Chat",
  "Gaming",
  "Music",
  "Deep Conversations",
  "Just Passing By",
  "Looking for Recommendations",
  "Custom",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export interface ActivitySignal {
  id: string;
  ownerId: string;
  category: ActivityCategory;
  message: string | null;
  lat: number;
  lng: number;
}

export interface WaveNotification {
  id: string;
  senderId: string;
  category: ActivityCategory;
  message: string | null;
  createdAt: string;
}

export interface PeerDot {
  id: string;
  lat: number;
  lng: number;
  busy: boolean;
  activity: Pick<ActivitySignal, "id" | "category" | "message"> | null;
}

export interface SignalMsg {
  id: string;
  fromId: string;
  toId: string;
  type: SignalType;
  payload: string | null;
  createdAt: string;
}

export interface PollResponse {
  peers: PeerDot[];
  signals: SignalMsg[];
  myActivity: Omit<ActivitySignal, "ownerId"> | null;
  waves: WaveNotification[];
  incomingRequest: string | null;
  isLeader: boolean;
}
