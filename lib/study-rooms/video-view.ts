// 🎬 What a member's screen is told about the room's video. Apart from
// video.ts (which needs the rooms' own checks) so that rooms.ts can put it
// in the room's state without the two importing each other.
import type { StudyRoom } from "../../drizzle/schema";

// YouTube's own thumbnail address for a video id (shown as an image only).
export const thumbnailOf = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

// What every member's screen is told about the room's video.
export function videoOf(room: StudyRoom) {
  const videoId = room.youtubeVideoId;
  return {
    contentType:
      room.contentType === "youtube" && videoId
        ? ("youtube" as const)
        : ("pdf" as const),
    videoId,
    title: room.youtubeTitle,
    thumbnail: videoId ? thumbnailOf(videoId) : null,
    state: videoId ? room.youtubeState : null,
    // The server's clock, for the page to correct its own against.
    serverNow: Date.now(),
  };
}
