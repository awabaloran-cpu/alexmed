"use client";

import { useParams } from "next/navigation";
import RoomSummary from "@/components/rooms/RoomSummary";
import RoomsProvider from "@/components/rooms/RoomsProvider";

// What a sitting in this room came to.
export default function RoomSummaryPage() {
  const params = useParams<{ roomId: string }>();
  return (
    <RoomsProvider>
      <RoomSummary roomId={params.roomId} />
    </RoomsProvider>
  );
}
