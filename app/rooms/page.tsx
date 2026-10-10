"use client";

import RoomsHome from "@/components/rooms/RoomsHome";
import RoomsProvider from "@/components/rooms/RoomsProvider";

// 👥 The Rooms tab (docs/study-rooms/06-round-3.md §1).
export default function RoomsPage() {
  return (
    <RoomsProvider>
      <RoomsHome />
    </RoomsProvider>
  );
}
