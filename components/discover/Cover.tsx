"use client";

// 🎨 A quiz's cover, drawn — no picture is downloaded. Each `art` is a
// large line drawing over the cover's own colour, with a second, faint
// one behind it for depth. When a row has a real `image` it is shown
// instead, and the drawing comes back if that image fails to load.
import { useState } from "react";
import {
  Atom,
  Bird,
  Brain,
  Compass,
  Fish,
  FlaskConical,
  Globe,
  Hash,
  HeartPulse,
  Hourglass,
  Landmark,
  Languages,
  Lightbulb,
  Map as MapIcon,
  Medal,
  Mountain,
  PawPrint,
  Rocket,
  ScrollText,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import s from "./discover.module.css";

const ART: Record<string, [LucideIcon, LucideIcon]> = {
  general: [Brain, Sparkles],
  numbers: [Hash, Sparkles],
  language: [Languages, ScrollText],
  invention: [Lightbulb, Atom],
  capitals: [Landmark, MapIcon],
  globe: [Globe, Compass],
  mountain: [Mountain, Compass],
  map: [MapIcon, Globe],
  ancient: [Landmark, Hourglass],
  scholar: [ScrollText, Compass],
  century: [Hourglass, Globe],
  explorer: [Compass, MapIcon],
  body: [HeartPulse, Atom],
  space: [Rocket, Sparkles],
  chemistry: [FlaskConical, Atom],
  physics: [Atom, Sparkles],
  animal: [PawPrint, Mountain],
  ocean: [Fish, Sparkles],
  bird: [Bird, Mountain],
  football: [Trophy, Medal],
  olympics: [Medal, Trophy],
};

export function Cover({
  art,
  color,
  image,
  className,
  children,
}: {
  art: string;
  color: string;
  image?: string | null;
  className?: string;
  children?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const [Main, Behind] = ART[art] ?? ART.general;
  return (
    <span
      className={`${s.cover} ${className ?? ""}`}
      style={{ "--cover": color } as React.CSSProperties}
    >
      {image && !broken ? (
        // A cover from the catalogue: its size is the card's, set in CSS.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <>
          <Behind className={s.coverBehind} aria-hidden="true" />
          <Main className={s.coverMain} aria-hidden="true" />
        </>
      )}
      {children}
    </span>
  );
}
