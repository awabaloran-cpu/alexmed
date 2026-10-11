// 🔊 The sounds of Discover, made in the browser: no audio file is
// downloaded, so there is nothing to license and nothing to fail to load.
// Short effects (a card flipped or swiped, a right or wrong answer, the
// end of a quiz) and a quiet background pad for the study modes.
//
// Nothing plays before the student has touched the page (browsers forbid
// it), the music stops when the page is hidden or left, and both switches
// are remembered on the device.

const EFFECTS_KEY = "nl-discover-sound";
const MUSIC_KEY = "nl-discover-music";
const MUSIC_GAIN = 0.035;

export type Effect = "flip" | "swipe" | "correct" | "wrong" | "finish";

function read(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "on";
  } catch {
    return fallback;
  }
}

function write(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

// One soft note: a frequency, when it starts and how long it rings.
function note(
  ctx: AudioContext,
  frequency: number,
  start: number,
  length: number,
  volume: number,
  type: OscillatorType = "sine"
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  const at = ctx.currentTime + start;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.02);
}

const SCORES: Record<Effect, (ctx: AudioContext) => void> = {
  flip: ctx => note(ctx, 520, 0, 0.09, 0.08, "triangle"),
  swipe: ctx => {
    note(ctx, 340, 0, 0.12, 0.06, "triangle");
    note(ctx, 250, 0.05, 0.12, 0.05, "triangle");
  },
  correct: ctx => {
    note(ctx, 660, 0, 0.16, 0.12);
    note(ctx, 880, 0.11, 0.24, 0.12);
  },
  wrong: ctx => {
    note(ctx, 220, 0, 0.2, 0.1, "triangle");
    note(ctx, 175, 0.12, 0.28, 0.1, "triangle");
  },
  finish: ctx => {
    [523, 659, 784, 1047].forEach((frequency, index) =>
      note(ctx, frequency, index * 0.12, 0.35, 0.11)
    );
  },
};

export function effectsOn(): boolean {
  return typeof window !== "undefined" && read(EFFECTS_KEY, true);
}

export function setEffects(on: boolean) {
  write(EFFECTS_KEY, on);
}

export function play(effect: Effect) {
  if (!effectsOn()) return;
  const ctx = audio();
  if (ctx) SCORES[effect](ctx);
}

// A light tap under the finger where the device has one (Android; an
// iPhone's browser has no such thing and simply does nothing).
export function buzz(pattern: number | number[] = 12) {
  if (!effectsOn()) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not allowed here: the answer still shows.
  }
}

// ── The background pad ────────────────────────────────────────────────────
// Four slow chords, two soft voices each, going round. Quiet by design:
// it sits under reading, it does not ask to be listened to.
const CHORDS = [
  [220.0, 329.63],
  [174.61, 261.63],
  [196.0, 293.66],
  [164.81, 246.94],
];
const CHORD_SECONDS = 6;

let music: { stop: () => void } | null = null;

export function musicOn(): boolean {
  return typeof window !== "undefined" && read(MUSIC_KEY, false);
}

export function musicPlaying(): boolean {
  return music !== null;
}

export function stopMusic() {
  music?.stop();
  music = null;
}

export function startMusic() {
  if (music) return;
  const ctx = audio();
  if (!ctx) return;
  const master = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + 2);
  filter.connect(master).connect(ctx.destination);

  let step = 0;
  let stopped = false;
  const voice = () => {
    if (stopped) return;
    const start = ctx.currentTime;
    for (const frequency of CHORDS[step % CHORDS.length]) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.5, start + 2);
      gain.gain.linearRampToValueAtTime(0, start + CHORD_SECONDS + 1.5);
      oscillator.connect(gain).connect(filter);
      oscillator.start(start);
      oscillator.stop(start + CHORD_SECONDS + 1.6);
    }
    step++;
  };
  voice();
  const timer = window.setInterval(voice, CHORD_SECONDS * 1000);
  // Leaving the page, or putting it in the background, is silence.
  const onHidden = () => {
    if (document.visibilityState === "hidden") stopMusic();
  };
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", stopMusic);
  music = {
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", stopMusic);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.4);
      window.setTimeout(() => master.disconnect(), 600);
    },
  };
}

export function setMusic(on: boolean) {
  write(MUSIC_KEY, on);
  if (on) startMusic();
  else stopMusic();
}
