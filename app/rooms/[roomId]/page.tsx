"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import RoomLobby from "@/components/rooms/RoomLobby";
import RoomsProvider from "@/components/rooms/RoomsProvider";

// The lobby of a room; a private room's link carries its invite (?i=…).
export default function RoomLobbyPage() {
  const params = useParams<{ roomId: string }>();
  return (
    <RoomsProvider>
      <Suspense fallback={null}>
        <RoomLobby roomId={params.roomId} />
      </Suspense>
    </RoomsProvider>
  );
}
