"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  ROOM_CAPACITY_DEFAULT,
  ROOM_CAPACITY_MAX,
  ROOM_CAPACITY_MIN,
  ROOM_TITLE_MAX,
  ROOM_TITLE_MIN,
} from "@/lib/study-rooms/config";
import { trpc } from "@/lib/trpc-client";
import { sectionName } from "./parts";
import { useRooms } from "./RoomsProvider";
import s from "./rooms.module.css";

// The rules of public rooms, accepted once (adults only — a minor never
// reaches a public room, so never sees this).
export function RulesScreen({ onAccepted }: { onAccepted: () => void }) {
  const { t, tError, refreshViewer } = useRooms();
  const [agreed, setAgreed] = useState(false);
  const accept = trpc.rooms.setProfile.useMutation({
    onSuccess: async () => {
      await refreshViewer();
      onAccepted();
    },
  });
  return (
    <div className={s.panel}>
      <h1>{t("rules.title")}</h1>
      <p className={s.meta}>{t("rules.intro")}</p>
      <ul className={s.rules}>
        {(["rules.1", "rules.2", "rules.3", "rules.4", "rules.5"] as const).map(
          key => (
            <li key={key}>{t(key)}</li>
          )
        )}
      </ul>
      <button
        type="button"
        className={`${s.switch} ${agreed ? s.switchOn : ""}`}
        role="switch"
        aria-checked={agreed}
        onClick={() => setAgreed(!agreed)}
      >
        <span>{t("rules.agree")}</span>
        <span className={s.tog} />
      </button>
      {accept.error ? (
        <p className={s.errorNote} role="alert">
          {tError(accept.error)}
        </p>
      ) : null}
      <button
        type="button"
        className={`${s.btn} ${s.primary} ${s.wide}`}
        disabled={!agreed || accept.isPending}
        onClick={() => accept.mutate({ acceptRules: true })}
      >
        {t("rules.accept")}
      </button>
      <p className={s.meta}>{t("rules.once")}</p>
    </div>
  );
}

export const inviteUrl = (roomId: string, code: string) =>
  `${window.location.origin}/rooms/${roomId}?i=${encodeURIComponent(code)}`;

// The invite of a private room: copy the link, or hand it to WhatsApp.
export function InviteBox({ roomId, code }: { roomId: string; code: string }) {
  const { t } = useRooms();
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(roomId, code);
  return (
    <>
      <p className={s.sub}>{t("create.inviteLink")}</p>
      <div className={s.link}>
        <span>{url.replace(/^https?:\/\//, "")}</span>
        <button
          type="button"
          className={s.chip}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              // No clipboard here: the link stays on screen to select.
            }
          }}
        >
          {copied ? t("create.copied") : t("create.copy")}
        </button>
      </div>
      <a
        className={`${s.btn} ${s.wa} ${s.wide}`}
        href={`https://wa.me/?text=${encodeURIComponent(t("create.whatsappText", { url }))}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("create.whatsapp")}
      </a>
    </>
  );
}

// Opening a room in two short steps: what kind and what about.
export default function RoomCreate() {
  const { t, tError, language, viewer } = useRooms();
  const router = useRouter();
  const wantedSection = useSearchParams().get("section");
  const adult = viewer.audience === "adult";
  const sections = trpc.rooms.sections.useQuery();

  const [step, setStep] = useState<1 | 2>(1);
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [sectionId, setSectionId] = useState("");
  const [title, setTitle] = useState("");
  const [subjectQuery, setSubjectQuery] = useState("");
  const [subject, setSubject] = useState<{ id: string; nameEn: string } | null>(
    null
  );
  const [topic, setTopic] = useState("");
  const [roomLanguage, setRoomLanguage] = useState<"ar" | "en" | "mixed">("ar");
  const [capacity, setCapacity] = useState(ROOM_CAPACITY_DEFAULT);
  const [womenOnly, setWomenOnly] = useState(false);
  const [university, setUniversity] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [needRules, setNeedRules] = useState(false);
  const [done, setDone] = useState<{
    roomId: string;
    code: string | null;
  } | null>(null);

  useEffect(() => {
    if (sectionId || !sections.data?.length) return;
    const wanted = sections.data.find(item => item.key === wantedSection);
    setSectionId((wanted ?? sections.data[0]).id);
  }, [sections.data, sectionId, wantedSection]);

  const section = sections.data?.find(item => item.id === sectionId);
  const canBePublic = adult && !!section?.publicRooms;
  useEffect(() => {
    if (!canBePublic) {
      setVisibility("private");
      setWomenOnly(false);
    }
  }, [canBePublic]);

  const deferredQuery = useDeferredValue(subjectQuery.trim());
  const suggestions = trpc.rooms.suggestSubjects.useQuery(
    { sectionId: sectionId || undefined, q: deferredQuery },
    { enabled: step === 2 && !!sectionId && !subject }
  );

  const create = trpc.rooms.create.useMutation({
    onSuccess: result =>
      setDone({ roomId: result.roomId, code: result.inviteCode }),
  });
  const titleOk =
    title.trim().length >= ROOM_TITLE_MIN &&
    title.trim().length <= ROOM_TITLE_MAX;

  function submit() {
    if (visibility === "public" && !viewer.rulesAccepted) {
      setNeedRules(true);
      return;
    }
    create.mutate({
      visibility,
      title: title.trim(),
      sectionId,
      subjectId: subject?.id ?? null,
      subjectText: subject ? null : subjectQuery.trim() || null,
      topic: topic.trim() || null,
      language: roomLanguage,
      capacity,
      womenOnly: visibility === "public" && womenOnly,
      university: university.trim() || null,
      courseCode: courseCode.trim() || null,
    });
  }

  if (needRules && !viewer.rulesAccepted) {
    return <RulesScreen onAccepted={() => setNeedRules(false)} />;
  }

  if (done) {
    return (
      <div className={s.panel}>
        <h1>{t("create.ready")} 🎉</h1>
        <p className={s.meta} dir="auto">
          {title}
        </p>
        {done.code ? <InviteBox roomId={done.roomId} code={done.code} /> : null}
        <button
          type="button"
          className={`${s.btn} ${s.primary} ${s.wide}`}
          onClick={() => router.push(`/rooms/${done.roomId}/live`)}
        >
          {t("create.enter")}
        </button>
      </div>
    );
  }

  return (
    <form
      className={s.panel}
      onSubmit={event => {
        event.preventDefault();
        if (step === 1) {
          if (titleOk && sectionId) setStep(2);
        } else if (!create.isPending) {
          submit();
        }
      }}
    >
      <div className={s.row}>
        {step === 1 ? (
          <Link href="/rooms" aria-label={t("rooms.back")} className={s.chip}>
            <X size={16} aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" className={s.chip} onClick={() => setStep(1)}>
            ‹ {t("rooms.back")}
          </button>
        )}
        <h2>{t("create.title")}</h2>
        <span />
      </div>
      <div className={s.steps} aria-hidden="true">
        <span className={s.stepOn} />
        <span className={step === 2 ? s.stepOn : ""} />
      </div>

      {step === 1 ? (
        <>
          <div className={s.two}>
            <button
              type="button"
              className={`${s.kind} ${visibility === "private" ? s.kindOn : ""}`}
              aria-pressed={visibility === "private"}
              onClick={() => setVisibility("private")}
            >
              <b>{t("create.private")}</b>
              <span>{t("create.privateHint")}</span>
            </button>
            <button
              type="button"
              className={`${s.kind} ${visibility === "public" ? s.kindOn : ""}`}
              aria-pressed={visibility === "public"}
              disabled={!canBePublic}
              style={canBePublic ? undefined : { opacity: 0.45 }}
              onClick={() => setVisibility("public")}
            >
              <b>{t("create.public")}</b>
              <span>{t("create.publicHint")}</span>
            </button>
          </div>
          <label className={s.field}>
            {t("create.section")}
            <select
              id="room-section"
              className={s.input}
              value={sectionId}
              onChange={event => {
                setSectionId(event.target.value);
                setSubject(null);
              }}
            >
              {(sections.data ?? []).map(item => (
                <option key={item.id} value={item.id}>
                  {sectionName(item, language)}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            {t("create.name")}
            <input
              id="room-title"
              className={s.input}
              dir="auto"
              value={title}
              maxLength={ROOM_TITLE_MAX}
              placeholder={t("create.namePlaceholder")}
              onChange={event => setTitle(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className={`${s.btn} ${s.primary} ${s.wide}`}
            disabled={!titleOk || !sectionId}
          >
            {t("create.next")}
          </button>
        </>
      ) : (
        <>
          <div className={s.field}>
            <label htmlFor="room-subject">{t("create.subject")}</label>
            {subject ? (
              <button
                type="button"
                className={`${s.chip} ${s.chipOn}`}
                style={{ justifySelf: "start" }}
                onClick={() => setSubject(null)}
              >
                <span className={s.ltr}>{subject.nameEn}</span> ✕
              </button>
            ) : (
              <>
                <input
                  id="room-subject"
                  className={s.input}
                  dir="auto"
                  value={subjectQuery}
                  placeholder={t("create.subjectPlaceholder")}
                  autoComplete="off"
                  onChange={event => setSubjectQuery(event.target.value)}
                />
                {suggestions.data?.length || subjectQuery.trim() ? (
                  <div className={s.suggest}>
                    {(suggestions.data ?? []).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSubject(item)}
                      >
                        <span className={s.ltr}>{item.nameEn}</span> ·{" "}
                        {item.nameAr}
                      </button>
                    ))}
                    {subjectQuery.trim() && !suggestions.data?.length ? (
                      <button type="button" disabled>
                        {t("create.otherSubject", { q: subjectQuery.trim() })}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <label className={s.field}>
            {t("create.topic")}
            <input
              id="room-topic"
              className={s.input}
              dir="auto"
              value={topic}
              maxLength={80}
              placeholder={t("create.topicPlaceholder")}
              onChange={event => setTopic(event.target.value)}
            />
          </label>
          <div className={s.two}>
            <label className={s.field}>
              {t("create.roomLanguage")}
              <select
                id="room-language"
                className={s.input}
                value={roomLanguage}
                onChange={event =>
                  setRoomLanguage(event.target.value as typeof roomLanguage)
                }
              >
                <option value="ar">{t("lang.ar")}</option>
                <option value="en">{t("lang.en")}</option>
                <option value="mixed">{t("lang.mixed")}</option>
              </select>
            </label>
            <label className={s.field}>
              {t("create.capacity", { n: capacity })}
              <input
                id="room-capacity"
                type="range"
                min={ROOM_CAPACITY_MIN}
                max={ROOM_CAPACITY_MAX}
                value={capacity}
                onChange={event => setCapacity(Number(event.target.value))}
              />
            </label>
          </div>
          {visibility === "public" && viewer.gender === "female" ? (
            <>
              <button
                type="button"
                className={`${s.switch} ${s.switchRose} ${womenOnly ? s.switchOn : ""}`}
                role="switch"
                aria-checked={womenOnly}
                onClick={() => setWomenOnly(!womenOnly)}
              >
                <span>
                  {t("create.womenOnly")}
                  <small>{t("create.womenOnlyHint")}</small>
                </span>
                <span className={s.tog} />
              </button>
              {womenOnly ? (
                <p className={s.note}>{t("create.womenOnlyTrust")}</p>
              ) : null}
            </>
          ) : null}
          {visibility === "public" ? (
            <details>
              <summary className={s.meta}>{t("create.optional")}</summary>
              <div className={s.two} style={{ marginTop: 8 }}>
                <input
                  id="room-university"
                  className={s.input}
                  dir="auto"
                  value={university}
                  maxLength={120}
                  placeholder={t("create.university")}
                  aria-label={t("create.university")}
                  onChange={event => setUniversity(event.target.value)}
                />
                <input
                  id="room-course-code"
                  className={`${s.input} ${s.ltr}`}
                  value={courseCode}
                  maxLength={24}
                  placeholder={t("create.courseCode")}
                  aria-label={t("create.courseCode")}
                  onChange={event => setCourseCode(event.target.value)}
                />
              </div>
            </details>
          ) : null}
          {create.error ? (
            <p className={s.errorNote} role="alert">
              {tError(create.error)}
            </p>
          ) : null}
          <button
            type="submit"
            className={`${s.btn} ${s.primary} ${s.wide}`}
            disabled={create.isPending}
          >
            {t("create.open")}
          </button>
        </>
      )}
    </form>
  );
}
