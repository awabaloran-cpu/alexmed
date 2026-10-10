// The rooms' screens, rendered to markup with the server's answers stubbed:
// what each kind of student is shown, in both languages, and the states a
// page must not get wrong (feature off, the one-time questions, a full
// room, the host's controls).
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  answers: {} as Record<string, unknown>,
  errors: {} as Record<string, { message: string }>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/trpc-client", () => {
  const procedure = (path: string) => ({
    useQuery: (_input?: unknown, options?: { enabled?: boolean }) => {
      const off = options?.enabled === false;
      return {
        data: off ? undefined : h.answers[path],
        error: off ? null : (h.errors[path] ?? null),
        isLoading: false,
        isRefetchError: false,
        refetch: async () => ({}),
      };
    },
    useMutation: () => ({
      mutate: () => {},
      isPending: false,
      isSuccess: false,
      error: null,
    }),
  });
  const utils: unknown = new Proxy(
    {},
    {
      get: () => new Proxy({}, { get: () => ({ invalidate: async () => {} }) }),
    }
  );
  return {
    trpc: new Proxy(
      { useUtils: () => utils },
      {
        get: (target: Record<string, unknown>, router: string) =>
          router in target
            ? target[router]
            : new Proxy(
                {},
                { get: (_t, name: string) => procedure(`${router}.${name}`) }
              ),
      }
    ),
  };
});

import LiveRoom from "./LiveRoom";
import RoomLobby from "./RoomLobby";
import RoomsHome, { SectionRooms } from "./RoomsHome";
import RoomsProvider from "./RoomsProvider";

const viewer = (overrides: Record<string, unknown> = {}) => ({
  userId: "u1",
  audience: "adult",
  gender: "female",
  country: "EG",
  birthDateSet: true,
  rulesAccepted: true,
  uiLanguage: "ar",
  banned: false,
  ...overrides,
});
const sections = [
  {
    id: "s1",
    key: "medicine",
    nameAr: "طب",
    nameEn: "Medicine",
    icon: "stethoscope",
    color: "med",
    publicRooms: true,
    liveRooms: 12,
  },
  {
    id: "s2",
    key: "science",
    nameAr: "علوم",
    nameEn: "Science",
    icon: "flask-conical",
    color: "sci",
    publicRooms: true,
    liveRooms: 0,
  },
];
const room = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  visibility: "public",
  title: "أدوية الكلى قبل الميدتيرم",
  sectionId: "s1",
  subjectEn: "Pharmacology",
  subjectAr: "علم الأدوية",
  topic: "Renal drugs",
  university: null,
  language: "mixed",
  womenOnly: true,
  capacity: 8,
  locked: false,
  countries: ["EG", "JO"],
  hasBook: false,
  sharedPage: 1,
  memberCount: 2,
  members: [
    { userId: "u2", name: "أحمد", image: null, country: "EG", role: "host" },
    { userId: "u3", name: "سارة", image: null, country: "JO", role: "member" },
  ],
  ...overrides,
});

function page(node: ReactNode, night = false) {
  return renderToStaticMarkup(createElement(RoomsProvider, { night }, node));
}

beforeEach(() => {
  h.errors = {};
  h.answers = {
    "rooms.enabled": { enabled: true },
    "rooms.me": viewer(),
    "rooms.sections": sections,
    "rooms.mine": [],
    "rooms.explore": [room()],
  };
});

describe("the Rooms tab", () => {
  it("an adult: sections with their live counts, then what is live now", () => {
    const html = page(createElement(RoomsHome));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("طب");
    expect(html).toContain("12 غرفة الآن");
    expect(html).toContain("لا غرف الآن");
    expect(html).toContain('href="/rooms/s/medicine"');
    expect(html).toContain("مباشر الآن");
    expect(html).toContain("أدوية الكلى قبل الميدتيرم");
    // The subject stays as it is studied, and each member carries a country.
    expect(html).toContain("Pharmacology › Renal drugs");
    expect(html).toContain(">JO<");
    expect(html).toContain('href="/rooms/r1"');
    // A woman is offered the women-only filter.
    expect(html).toContain("طالبات فقط");
  });

  it("the same page in English turns left-to-right and keeps Arabic titles", () => {
    h.answers["rooms.me"] = viewer({ uiLanguage: "en", gender: "male" });
    const html = page(createElement(RoomsHome));
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('lang="en"');
    expect(html).toContain("Rooms");
    expect(html).toContain("Medicine");
    expect(html).toContain("12 live");
    expect(html).toContain("Live now");
    expect(html).toContain("أدوية الكلى قبل الميدتيرم");
    // No women-only filter for a man.
    expect(html).not.toContain("Women only");
  });

  it("a minor: no discovery at all — their section and their own rooms", () => {
    h.answers["rooms.me"] = viewer({ audience: "minor" });
    h.answers["rooms.sections"] = [
      {
        id: "s9",
        key: "high_school",
        nameAr: "ثانوية عامة",
        nameEn: "High school",
        icon: "graduation-cap",
        color: "hs",
        publicRooms: false,
        liveRooms: 0,
      },
    ];
    const html = page(createElement(RoomsHome));
    expect(html).toContain("ثانوية عامة");
    expect(html).toContain("غرف خاصة بالدعوة");
    expect(html).toContain("غرفك خاصة بالدعوة فقط");
    expect(html).not.toContain("مباشر الآن");
    expect(html).not.toContain("أدوية الكلى");
    expect(html).not.toContain('type="search"');
  });

  it("an empty section invites the first room", () => {
    h.answers["rooms.explore"] = [];
    const html = page(createElement(SectionRooms, { sectionKey: "science" }));
    expect(html).toContain("علوم");
    expect(html).toContain("كن أول من يفتح غرفة هنا");
    expect(html).toContain('href="/rooms/new?section=science"');
  });
});

describe("before any room", () => {
  it("the feature switched off shows nothing of it", () => {
    h.answers["rooms.enabled"] = { enabled: false };
    const html = page(createElement(RoomsHome));
    expect(html).toContain("هذه الغرفة غير متاحة");
    expect(html).not.toContain("الأقسام");
  });

  it("an account with no date of birth meets the one-time questions first", () => {
    h.answers["rooms.me"] = viewer({ birthDateSet: false, gender: null });
    const html = page(createElement(RoomsHome));
    expect(html).toContain("تاريخ ميلادك");
    expect(html).toContain("مرحلتك الدراسية");
    // Nothing says what an answer unlocks.
    expect(html).not.toContain("18");
    expect(html).not.toContain("١٨");
    expect(html).not.toContain("الأقسام");
  });

  it("a banned account is told so and shown nothing else", () => {
    h.answers["rooms.me"] = viewer({ banned: true });
    const html = page(createElement(RoomsHome));
    expect(html).toContain("حسابك موقوف عن غرف المذاكرة");
    expect(html).not.toContain("الأقسام");
  });
});

describe("the lobby", () => {
  const preview = (overrides: Record<string, unknown> = {}) => ({
    ...room(),
    status: "active",
    full: false,
    banned: false,
    joined: false,
    needsRules: false,
    ...overrides,
  });

  it("shows who is inside and lets the student in", () => {
    h.answers["rooms.preview"] = preview();
    const html = page(createElement(RoomLobby, { roomId: "r1" }));
    expect(html).toContain("أحمد");
    expect(html).toContain("قائد");
    expect(html).toContain("2 من 8");
    expect(html).toMatch(/<button[^>]*>ادخل<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>ادخل<\/button>/);
  });

  it("a full, a locked or a banned room cannot be entered, and says why", () => {
    for (const [state, sentence] of [
      [{ full: true }, "الغرفة ممتلئة الآن"],
      [{ locked: true }, "القائد أقفل الغرفة"],
      [{ banned: true }, "لا يمكنك دخول هذه الغرفة"],
    ] as const) {
      h.answers["rooms.preview"] = preview(state);
      const html = page(createElement(RoomLobby, { roomId: "r1" }));
      expect(html).toContain(sentence);
      expect(html).toMatch(/<button[^>]*disabled[^>]*>ادخل<\/button>/);
    }
  });

  it("a room that is not the student's to see says only that", () => {
    h.answers["rooms.preview"] = undefined;
    h.errors["rooms.preview"] = { message: "not_available" };
    const html = page(createElement(RoomLobby, { roomId: "r1" }));
    expect(html).toContain("هذه الغرفة غير متاحة");
    expect(html).not.toContain("ادخل</button>");
  });
});

describe("inside a room", () => {
  const state = (role: "host" | "member") => {
    const host = role === "host";
    return {
      room: {
        id: "r1",
        visibility: "private",
        title: "مذاكرة مع الشلّة",
        subjectEn: null,
        subjectAr: null,
        topic: null,
        language: "ar",
        womenOnly: false,
        capacity: 8,
        locked: false,
        bookId: null,
        sharedPage: 1,
        hostId: host ? "u1" : "u2",
        pageLeaderId: host ? "u1" : "u2",
        settings: {
          freeNav: true,
          marks: true,
          chat: true,
          speak: "open",
          quizStart: "cohost",
          invite: "host",
        },
        seq: 3,
      },
      me: {
        userId: "u1",
        role,
        can: {
          edit_room: host,
          end_room: host,
          invite: host,
          mute_member: host,
          kick_member: host,
          ban_member: host,
          manage_roles: host,
        },
      },
      members: [
        {
          userId: "u1",
          name: "منى",
          image: null,
          country: "EG",
          role,
          mutedByHost: false,
        },
        {
          userId: "u2",
          name: "أحمد",
          image: null,
          country: "JO",
          role: host ? "member" : "host",
          mutedByHost: true,
        },
      ],
    };
  };

  it("the host sees the room's controls", () => {
    h.answers["rooms.state"] = state("host");
    const html = page(createElement(LiveRoom, { roomId: "r1" }), true);
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("2 حاضرون");
    expect(html).toContain("أنت");
    expect(html).toContain("الإعدادات");
    expect(html).toContain("دعوة");
    expect(html).toContain("خروج");
    expect(html).toContain("🔇");
  });

  it("a member sees none of them — only the way out and the report", () => {
    h.answers["rooms.state"] = state("member");
    const html = page(createElement(LiveRoom, { roomId: "r1" }), true);
    expect(html).not.toContain("الإعدادات");
    expect(html).not.toContain("دعوة");
    expect(html).toContain("إبلاغ");
    expect(html).toContain("خروج");
    expect(html).toContain("القائد لم يختر ملفًا بعد");
  });

  it("a student taken out of the room is told, with the way back", () => {
    h.answers["rooms.state"] = undefined;
    h.errors["rooms.state"] = { message: "not_available" };
    const html = page(createElement(LiveRoom, { roomId: "r1" }), true);
    expect(html).toContain("أُخرجت من هذه الغرفة");
    expect(html).toContain('href="/rooms"');
  });
});
