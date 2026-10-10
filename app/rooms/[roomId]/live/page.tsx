"use client";

import { useParams } from "next/navigation";
import LiveRoom from "@/components/rooms/LiveRoom";
import RoomsProvider from "@/components/rooms/RoomsProvider";

// Inside a room — the night desk.
export default function LiveRoomPage() {
  const params = useParams<{ roomId: string }>();
  return (
    <RoomsProvider night>
      <LiveRoom roomId={params.roomId} />
    </RoomsProvider>
  );
}
