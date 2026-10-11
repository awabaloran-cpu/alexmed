// The official YouTube IFrame Player API, loaded once for the page, and the
// few parts of it the room's video uses — typed here because the API ships
// no types of its own. Nothing of a video passes through this app: the
// player is YouTube's, in YouTube's own frame.

export type YoutubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
};

export const PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

type PlayerOptions = {
  videoId: string;
  host?: string;
  width?: string;
  height?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: () => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;
  };
};

type YoutubeApi = {
  Player: new (element: HTMLElement, options: PlayerOptions) => YoutubePlayer;
};

declare global {
  interface Window {
    YT?: Partial<YoutubeApi>;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";
const LOAD_TIMEOUT_MS = 15_000;

let loading: Promise<YoutubeApi> | null = null;

// Resolves once `YT.Player` exists. Safe to call many times (one script,
// one promise); a failed load can be tried again. Browser only.
export function loadYoutubeApi(): Promise<YoutubeApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("no window"));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT as YoutubeApi);
  if (loading) return loading;
  loading = new Promise<YoutubeApi>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      loading = null;
      reject(error);
    };
    const done = () => {
      if (settled || !window.YT?.Player) return;
      settled = true;
      resolve(window.YT as YoutubeApi);
    };
    // The API calls this one global when it is ready; whatever was there
    // before is still called.
    const earlier = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      earlier?.();
      done();
    };
    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = API_SRC;
      script.async = true;
      script.onerror = () => {
        script.remove();
        fail(new Error("youtube api blocked"));
      };
      document.head.appendChild(script);
    }
    window.setTimeout(() => {
      done();
      fail(new Error("youtube api timeout"));
    }, LOAD_TIMEOUT_MS);
  });
  return loading;
}

// What the player's error codes mean, as the keys of the room's words.
export function playerErrorKey(
  code: number
): "video.errNoEmbed" | "video.errGone" | "video.errPlayback" {
  if (code === 101 || code === 150) return "video.errNoEmbed";
  if (code === 100 || code === 2) return "video.errGone";
  return "video.errPlayback";
}
