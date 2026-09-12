"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { BookOpen, FolderKanban, Loader2, Send, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { ChatTarget } from "@/lib/db-chat";

const EXAMPLE_PROMPTS = [
  "اشرح لي هذا الموضوع",
  "ما أهم النقاط للامتحان؟",
  "اختبرني في هذا",
  "اربط لي هذه المعلومات",
];

// Real chat UI over the existing RAG pipeline (lib/rag.ts, lib/db-chat.ts,
// chatRouter.ts) — PR17 builds no new retrieval/AI logic, only this surface.
// Context (chapter/book/subject) arrives automatically via BottomNav's
// resolveAssistantHref when the student was already inside one; with no
// context, the student picks a real folder/book below.
export default function AssistantPage() {
  const searchParams = useSearchParams();
  const urlScope = searchParams.get("scope");
  const urlId =
    searchParams.get("bookId") ||
    searchParams.get("subjectId") ||
    searchParams.get("chapterId");

  const [target, setTarget] = useState<ChatTarget | null>(() =>
    toTarget(urlScope, searchParams)
  );
  useEffect(() => {
    setTarget(toTarget(urlScope, searchParams));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlScope, urlId]);

  const subjectsQuery = trpc.subjects.list.useQuery(undefined, {
    enabled: !target,
  });
  const booksQuery = trpc.books.list.useQuery(undefined, { enabled: !target });

  if (!target) {
    return (
      <section className="upload-view">
        <div className="cards-header">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-dot" /> مساعد AI
            </div>
            <h1>
              كيف <em>أساعدك في الدراسة؟</em>
            </h1>
            <p>اختر مجلدًا أو ملفًا لتبدأ محادثة حوله.</p>
          </div>
        </div>

        {!!subjectsQuery.data?.length && (
          <>
            <span
              className="section-kicker"
              style={{ display: "block", marginBottom: 8 }}
            >
              مجلداتي
            </span>
            <div className="library-grid" style={{ marginBottom: 22 }}>
              {subjectsQuery.data.map(subject => (
                <button
                  key={subject.id}
                  type="button"
                  className="library-item"
                  style={{
                    cursor: "pointer",
                    textAlign: "right",
                    width: "100%",
                  }}
                  onClick={() =>
                    setTarget({ scope: "subject", subjectId: subject.id })
                  }
                >
                  <div className="library-item-icon">
                    <FolderKanban size={18} />
                  </div>
                  <div className="library-item-meta">
                    <strong>{subject.name}</strong>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {!!booksQuery.data?.length && (
          <>
            <span
              className="section-kicker"
              style={{ display: "block", marginBottom: 8 }}
            >
              ملفاتي
            </span>
            <div className="library-grid">
              {booksQuery.data.map(book => (
                <button
                  key={book.id}
                  type="button"
                  className="library-item"
                  style={{
                    cursor: "pointer",
                    textAlign: "right",
                    width: "100%",
                  }}
                  onClick={() => setTarget({ scope: "book", bookId: book.id })}
                >
                  <div className="library-item-icon">
                    <BookOpen size={18} />
                  </div>
                  <div className="library-item-meta">
                    <strong>{book.fileName}</strong>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {!subjectsQuery.data?.length &&
          !booksQuery.data?.length &&
          !subjectsQuery.isLoading && (
            <div className="empty-state">
              <Sparkles size={28} />
              <h3>ارفع ملفًا أولًا</h3>
              <p>سيظهر هنا حتى تسأل المساعد عنه.</p>
              <Link
                href="/books/upload"
                className="primary-button"
                style={{ marginTop: 14, width: "auto", padding: "0 22px" }}
              >
                رفع ملف
              </Link>
            </div>
          )}
      </section>
    );
  }

  return (
    <AssistantChat target={target} onChangeTarget={() => setTarget(null)} />
  );
}

function toTarget(
  scope: string | null,
  searchParams: URLSearchParams
): ChatTarget | null {
  if (scope === "book") {
    const bookId = searchParams.get("bookId");
    return bookId ? { scope: "book", bookId } : null;
  }
  if (scope === "subject") {
    const subjectId = searchParams.get("subjectId");
    return subjectId ? { scope: "subject", subjectId } : null;
  }
  if (scope === "chapter") {
    const chapterId = searchParams.get("chapterId");
    return chapterId ? { scope: "chapter", chapterId } : null;
  }
  return null;
}

function AssistantChat({
  target,
  onChangeTarget,
}: {
  target: ChatTarget;
  onChangeTarget: () => void;
}) {
  const utils = trpc.useUtils();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const getOrCreateSession = trpc.chat.getOrCreateSession.useMutation({
    onSuccess: session => setSessionId(session.id),
  });
  useEffect(() => {
    setSessionId(null);
    getOrCreateSession.mutate(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(target)]);

  const messagesQuery = trpc.chat.listMessages.useQuery(
    { sessionId: sessionId ?? "" },
    { enabled: !!sessionId }
  );
  const askChat = trpc.chat.ask.useMutation({
    onSuccess: () => {
      setInput("");
      messagesQuery.refetch();
    },
  });
  const createNoteFromMessage = trpc.chat.createNoteFromMessage.useMutation();
  const createCardFromMessage = trpc.chat.createCardFromMessage.useMutation();

  const contextLabel = useContextLabel(target);

  function send(question: string) {
    if (!sessionId || !question.trim() || askChat.isPending) return;
    askChat.mutate({ sessionId, question: question.trim() });
  }

  return (
    <section className="cards-view">
      <div className="cards-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> مساعد AI
          </div>
          <h1>
            {contextLabel ? (
              <>
                تسأل عن <em>{contextLabel}</em>
              </>
            ) : (
              <em>جاري التحميل...</em>
            )}
          </h1>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onChangeTarget}
          >
            تغيير السياق
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxHeight: 440,
          overflowY: "auto",
          marginBottom: 14,
        }}
      >
        {!sessionId || messagesQuery.isLoading ? (
          <p style={{ fontSize: 12, color: "#8d9895" }}>جاري التحضير...</p>
        ) : !messagesQuery.data?.length ? (
          <p style={{ fontSize: 12, color: "#8d9895" }}>
            اسأل عن {contextLabel || "هذا"} أي سؤال يخطر ببالك.
          </p>
        ) : (
          messagesQuery.data.map(message => (
            <div
              key={message.id}
              className="panel-card"
              style={{
                background: message.role === "user" ? "#eef3f2" : "#fff",
                alignSelf: message.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "90%",
              }}
            >
              <p style={{ whiteSpace: "pre-line" }}>{message.content}</p>
              {!!message.citedPages?.length && (
                <p style={{ fontSize: 11, color: "#8a9493", marginTop: 6 }}>
                  المصدر:{" "}
                  {message.citedPages
                    .map(cite => `صفحة ${cite.pageNumber}`)
                    .join("، ")}
                </p>
              )}
              {message.role === "assistant" && !!message.citedPages?.length && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={createNoteFromMessage.isPending}
                    onClick={() =>
                      createNoteFromMessage.mutate({ messageId: message.id })
                    }
                  >
                    حوّل لملاحظة
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={createCardFromMessage.isPending}
                    onClick={() =>
                      createCardFromMessage.mutate({ messageId: message.id })
                    }
                  >
                    أنشئ بطاقة
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        {askChat.isPending && (
          <p style={{ fontSize: 12, color: "#8d9895" }}>
            <Loader2 size={12} className="spin" /> جاري التفكير...
          </p>
        )}
        {askChat.isError && (
          <div className="inline-alert error">
            تعذر الحصول على إجابة الآن. حاول مرة أخرى بعد قليل.
          </div>
        )}
      </div>

      {!messagesQuery.data?.length && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          {EXAMPLE_PROMPTS.map(prompt => (
            <button
              key={prompt}
              type="button"
              className="filter-button"
              onClick={() => send(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      <form
        style={{ display: "flex", gap: 8 }}
        onSubmit={event => {
          event.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="اكتب سؤالك..."
          style={{ flex: 1 }}
          disabled={!sessionId || askChat.isPending}
        />
        <button
          type="submit"
          className="primary-button"
          style={{ width: "auto", padding: "0 18px" }}
          disabled={!sessionId || !input.trim() || askChat.isPending}
          aria-label="إرسال"
        >
          <Send size={16} />
        </button>
      </form>
    </section>
  );
}

function useContextLabel(target: ChatTarget): string {
  const bookQuery = trpc.books.get.useQuery(
    { id: target.scope === "book" ? target.bookId : "" },
    { enabled: target.scope === "book" }
  );
  const subjectQuery = trpc.subjects.get.useQuery(
    { id: target.scope === "subject" ? target.subjectId : "" },
    { enabled: target.scope === "subject" }
  );
  const chapterQuery = trpc.books.getChapter.useQuery(
    { id: target.scope === "chapter" ? target.chapterId : "" },
    { enabled: target.scope === "chapter" }
  );

  if (target.scope === "book") return bookQuery.data?.book.fileName ?? "";
  if (target.scope === "subject") return subjectQuery.data?.name ?? "";
  if (target.scope === "chapter") return chapterQuery.data?.chapter.title ?? "";
  return "";
}
