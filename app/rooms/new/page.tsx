"use client";

import { Suspense } from "react";
import RoomCreate from "@/components/rooms/RoomCreate";
import RoomsProvider from "@/components/rooms/RoomsProvider";

// Opening a room.
export default function NewRoomPage() {
  return (
    <RoomsProvider>
      <Suspense fallback={null}>
        <RoomCreate />
      </Suspense>
    </RoomsProvider>
  );
}
