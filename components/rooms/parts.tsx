"use client";

import Link from "next/link";
import {
  Code,
  FlaskConical,
  GraduationCap,
  Lock,
  Pill,
  Ruler,
  Stethoscope,
  Users,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { countryName } from "@/lib/study-rooms/countries";
import type { RoomsKey } from "@/lib/study-rooms/i18n";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// The pieces every rooms page is made of: a member's picture with their
// country, a section card, a room card.

const ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  pill: Pill,
  ruler: Ruler,
  "flask-conical": FlaskConical,
  code: Code,
  "graduation-cap": GraduationCap,
};
export const sectionIcon = (name: string): LucideIcon => ICONS[name] ?? Users;

// A section's colour is one of a fixed set of tokens, never a free value.
const COLORS = new Set(["med", "pharm", "eng", "sci", "code", "hs"]);
export const sectionColor = (color: string) =>
  s[`c-${COLORS.has(color) ? color : "med"}`];

const TINTS = [
  "#5b6cff",
  "#e0567c",
  "#12a37c",
  "#d98a12",
  "#8a5bd6",
  "#2f8fd0",
];
function tintOf(id: string): string {
  let sum = 0;
  for (const char of id) sum = (sum + char.charCodeAt(0)) % 997;
  return TINTS[sum % TINTS.length];
}

export type Person = {
  userId: string;
  name: string | null;
  image: string | null;
  country: string | null;
};

export function Avatar({
  person,
  size,
}: {
  person: Person;
  size?: "sm" | "lg";
}) {
  const { language } = useRooms();
  const initial = (person.name ?? "?").trim().charAt(0) || "?";
  return (
    <span
      className={`${s.av} ${size === "sm" ? s.avSm : size === "lg" ? s.avLg : ""}`}
      style={
        person.image
          ? { backgroundImage: `url(${JSON.stringify(person.image)})` }
          : { background: tintOf(person.userId) }
      }
      title={[person.name, countryName(person.country, language)]
        .filter(Boolean)
        .join(" · ")}
    >
      {person.image ? null : initial}
      {person.country ? <span className={s.cc}>{person.country}</span> : null}
    </span>
  );
}

export function AvatarStack({ people }: { people: Person[] }) {
  return (
    <span className={s.stack}>
      {people.map(person => (
        <Avatar key={person.userId} person={person} size="sm" />
      ))}
    </span>
  );
}

export type SectionCardData = {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  icon: string;
  color: string;
  publicRooms: boolean;
  liveRooms: number;
};

export const sectionName = (
  section: { nameAr: string; nameEn: string },
  language: "ar" | "en"
) => (language === "ar" ? section.nameAr : section.nameEn);

export function SectionCard({ section }: { section: SectionCardData }) {
  const { t, language } = useRooms();
  const Icon = sectionIcon(section.icon);
  return (
    <motion.div whileTap={{ scale: 0.97 }}>
      <Link
        href={`/rooms/s/${section.key}`}
        className={`${s.sec} ${sectionColor(section.color)}`}
      >
        <Icon size={28} aria-hidden="true" />
        <span>
          <b>{sectionName(section, language)}</b>
          <span
            className={`${s.secCount} ${section.liveRooms ? "" : s.secQuiet}`}
          >
            {section.publicRooms ? (
              <>
                <i />
                {section.liveRooms
                  ? t("rooms.liveCount", { n: section.liveRooms })
                  : t("rooms.noLive")}
              </>
            ) : (
              t("rooms.privateOnly")
            )}
          </span>
        </span>
      </Link>
    </motion.div>
  );
}

export type RoomCardData = {
  id: string;
  visibility: "public" | "private";
  title: string;
  sectionId: string;
  subjectEn: string | null;
  subjectAr: string | null;
  topic: string | null;
  language: string;
  womenOnly: boolean;
  capacity: number;
  locked: boolean;
  countries: string[];
  memberCount: number;
  members: (Person & { role: string })[];
};

const LANGUAGE_KEYS: Record<string, RoomsKey> = {
  ar: "lang.ar",
  en: "lang.en",
  mixed: "lang.mixed",
};

// The subject as it is studied — in English when the room has it, left to
// right always, with the topic after it.
export function SubjectLine({
  room,
  dotColor,
}: {
  room: Pick<RoomCardData, "subjectEn" | "subjectAr" | "topic">;
  dotColor?: string;
}) {
  const subject = room.subjectEn ?? room.subjectAr;
  if (!subject && !room.topic) return null;
  return (
    <span className={s.subj} dir="auto">
      {dotColor ? (
        <span className={`${s.dot} ${sectionColor(dotColor)}`} />
      ) : null}
      {[subject, room.topic].filter(Boolean).join(" › ")}
    </span>
  );
}

export function RoomCard({
  room,
  mini = false,
  sectionColorName,
}: {
  room: RoomCardData;
  mini?: boolean;
  sectionColorName?: string;
}) {
  const { t, language } = useRooms();
  const full = room.memberCount >= room.capacity;
  return (
    <Link
      href={`/rooms/${room.id}`}
      className={`${s.card} ${mini ? s.mini : ""}`}
      aria-label={room.title}
    >
      <span className={s.row}>
        <SubjectLine room={room} dotColor={sectionColorName} />
        {mini ? null : (
          <span className={s.tag}>
            {t(LANGUAGE_KEYS[room.language] ?? "lang.ar")}
          </span>
        )}
      </span>
      <h3 dir="auto">{room.title}</h3>
      <span className={s.row}>
        <AvatarStack people={room.members} />
        <span className={s.meta}>
          {room.locked ? <Lock size={12} aria-hidden="true" /> : null}{" "}
          {full
            ? t("card.full")
            : t("card.members", { n: room.memberCount, max: room.capacity })}
        </span>
      </span>
      {mini ? null : (
        <span className={s.row}>
          <span className={s.meta}>
            {room.countries
              .map(code => countryName(code, language))
              .join(" · ")}
          </span>
          <span className={s.row} style={{ gap: 6 }}>
            {room.womenOnly ? (
              <span className={`${s.chip} ${s.chipWomen}`}>
                {t("filter.womenOnly")}
              </span>
            ) : null}
            {room.visibility === "private" ? (
              <span className={s.tag}>{t("card.private")}</span>
            ) : null}
          </span>
        </span>
      )}
    </Link>
  );
}

// A bottom sheet: the page behind is dimmed and a tap on it closes.
export function Sheet({
  title,
  onClose,
  children,
}: {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useRooms();
  return (
    <>
      <button
        type="button"
        className={s.scrim}
        aria-label={t("live.cancel")}
        onClick={onClose}
      />
      <motion.div
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
        onKeyDown={event => {
          if (event.key === "Escape") onClose();
        }}
      >
        {title ? <h2>{title}</h2> : null}
        {children}
      </motion.div>
    </>
  );
}
