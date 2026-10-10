"use client";

import { useParams } from "next/navigation";
import { SectionRooms } from "@/components/rooms/RoomsHome";
import RoomsProvider from "@/components/rooms/RoomsProvider";

// One section of the Rooms tab.
export default function RoomsSectionPage() {
  const params = useParams<{ key: string }>();
  return (
    <RoomsProvider>
      <SectionRooms sectionKey={params.key} />
    </RoomsProvider>
  );
}
