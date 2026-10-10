# 03 — البيانات والـ API

## 1. الجداول الجديدة (للمراجعة جدولًا جدولًا)

تسعة جداول، كلها **إضافية**: لا يُعدَّل جدول قائم ولا عمود قائم. تُكتب في
`drizzle/schema.ts` وتُطبَّق يدويًا من المالك بعد نسخة احتياطية (انظر آخر
الملف). الأسماء والأنواع بأسلوب الجداول الحالية (uuid، أعمدة camelCase).

### 1.1 `study_rooms` — الغرفة

| العمود | النوع | ملاحظة |
|---|---|---|
| `id` | uuid PK | |
| `hostId` | uuid → users, cascade | القائد الحالي (يتغير عند نقل القيادة) |
| `createdById` | uuid → users, set null | من أنشأها، للتدقيق |
| `visibility` | varchar(8) | `public` / `private` |
| `title` | text | 3–80 حرفًا |
| `university` `major` `course` | text null | كما كتبها القائد (للعرض) |
| `universityKey` `majorKey` `courseKey` | text null | مُطبَّعة للبحث والتصفية |
| `language` | varchar(8) | `ar` / `en` / `mixed` |
| `capacity` | int | 2–20 |
| `bookId` | uuid → books, set null | الملف المشترك، اختياري |
| `sharedPage` | int default 1 | آخر صفحة مشتركة محفوظة |
| `pageLeaderId` | uuid null | من يقود الصفحة (القائد افتراضيًا) |
| `settings` | jsonb | صلاحيات الغرفة (§3)، بمخطط zod واحد |
| `inviteHash` | text null, unique | sha256 لرمز الدعوة؛ الرمز نفسه لا يُحفظ |
| `locked` | bool default false | |
| `hiddenAt` | timestamptz null | أُخفيت من الاستكشاف بعد بلاغات |
| `status` | varchar(8) | `active` / `ended` |
| `seq` | bigint default 0 | الرقم التسلسلي لأحداث الغرفة |
| `lastActiveAt` `endedAt` `createdAt` | timestamptz | |

فهارس: `(status, visibility, lastActiveAt)` للاستكشاف · `(universityKey,
majorKey, courseKey)` للتصفية · `(hostId, status)` · `(bookId)`.

لا جدول مقررات: الجامعة والتخصص والمقرر نصوص، والاقتراحات تأتي من القيم
الموجودة (`select distinct … where key like $1`). التطبيع: حروف صغيرة، إزالة
التشكيل والمسافات الزائدة، توحيد الألف والتاء المربوطة.

### 1.2 `study_room_members` — العضوية

| العمود | النوع | ملاحظة |
|---|---|---|
| `roomId` | uuid → study_rooms, cascade | |
| `userId` | uuid → users, cascade | |
| `role` | varchar(8) | `host` / `cohost` / `member` |
| `state` | varchar(8) | `joined` / `left` / `kicked` / `banned` |
| `grants` | jsonb | استثناءات هذا العضو: `{chat?:bool, mark?:bool, speak?:bool, lead?:bool}` |
| `mutedByHost` | bool default false | |
| `joinedAt` `leftAt` `lastSeenAt` | timestamptz | |

PK `(roomId, userId)` — عضو واحد لكل غرفة، فلا تتكرر العضوية. فهرس
`(userId, state)` لـ «غرفي».

### 1.3 `study_room_messages` — المحادثة

`id` uuid PK · `roomId` → cascade · `userId` → set null · `body` text (≤500) ·
`page` int null · `seq` bigint · `deletedAt` null · `createdAt`.
فهرس `(roomId, seq)`. تُحذف بعد 30 يومًا من انتهاء الغرفة.

### 1.4 `study_room_marks` — التظليل المشترك

`id` uuid PK · `roomId` → cascade · `userId` → set null · `bookId` → cascade ·
`pageNumber` int · `color` varchar(8) من أربعة · `rects` jsonb (حتى 40
مستطيلًا، إحداثيات 0–1) · `text` text null (≤600، النص المظلَّل إن وُجد) ·
`deletedAt` null · `createdAt`.
فهرس `(roomId, pageNumber)`.

### 1.5 `study_room_quizzes` — الاختبار الجماعي

`id` uuid PK · `roomId` → cascade · `bookId` → books (ملف الأسئلة) ·
`startedById` · `questionIds` jsonb (uuid[]، يُثبَّت عند البدء) ·
`secondsPerQuestion` int · `state` varchar(10)
(`countdown`/`question`/`reveal`/`finished`/`cancelled`) · `currentIndex` int ·
`questionStartedAt` timestamptz null · `createdAt` · `finishedAt`.
فهرس جزئي فريد على `(roomId)` حيث `state` ليست `finished`/`cancelled` —
اختبار واحد جارٍ لكل غرفة.

### 1.6 `study_room_quiz_answers`

`quizId` → cascade · `questionId` → extracted_questions · `userId` →
cascade · `selectedIndex` int · `isCorrect` bool null · `answerMs` int ·
`points` int · `createdAt`. PK `(quizId, questionId, userId)` — إجابة واحدة
لا تتغير.

### 1.7 `study_room_reports` — البلاغات

`id` uuid PK · `reporterId` → set null · `roomId` → set null · `targetUserId`
→ set null (فارغ = بلاغ عن الغرفة) · `reason` varchar(16)
(`abuse`/`spam`/`copyright`/`off_topic`/`other`) · `details` text null (≤500) ·
`status` varchar(10) (`open`/`actioned`/`dismissed`) · `handledById` ·
`handledAt` · `createdAt`.
فهرس فريد `(reporterId, roomId, targetUserId)` — بلاغ واحد لكل هدف من كل
مبلِّغ. فهرس `(status, createdAt)`.

### 1.8 `study_room_bans` — حظر على مستوى المنصة

`userId` PK → cascade · `until` timestamptz null (فارغ = دائم) · `reason`
text · `byAdminId` · `createdAt`. يمنع إنشاء الغرف والانضمام لها فقط؛ لا يمسّ
بقية الحساب.

### 1.9 `study_room_events` — سجل التدقيق

`id` bigserial PK · `roomId` → cascade · `actorId` → set null · `type`
varchar(24) · `targetUserId` null · `data` jsonb صغير · `createdAt`.
يُسجَّل: إنشاء، إنهاء، نقل قيادة، تغيير صلاحية، كتم، طرد، حظر، تغيير ملف،
بدء/نهاية اختبار. لا نصوص محادثة. يُحذف مع الغرفة بعد 90 يومًا.

### ما لا يُحفظ

الصوت (لا تسجيل)، من يتكلم، مواضع الأعضاء في الملف، رفع اليد.

### الاحتفاظ والحذف

| البيانات | المدة |
|---|---|
| الغرفة المنتهية وأعضاؤها وملخّصها | 30 يومًا ثم تُحذف (cascade) |
| الرسائل والتظليل المشترك | مع الغرفة |
| البلاغات | 12 شهرًا |
| سجل التدقيق | 90 يومًا |
| حذف الحساب | cascade للعضوية والإجابات؛ الرسائل والتظليل يبقيان بلا اسم (`set null`) |

مهمة تنظيف يومية عبر QStash (نوع رسالة جديد `cleanup_study_rooms`).

## 2. حق قراءة الملف داخل الغرفة

`lib/book-access.ts` يكسب دورًا ثالثًا بعد `owner` و`shared`:

- **`room`**: المستخدم عضو `joined` في غرفة `active` ملفها هذا الملف.
- يُمنح **للقراءة فقط** وما دامت العضوية قائمة: لا بطاقات، لا توليد، لا
  تنزيل، لا مشاركة. يسقط لحظة الخروج أو الطرد أو انتهاء الغرفة.
- **الملف المحمي لا يدخل غرفة أبدًا:** `rooms.create` و`rooms.setBook`
  يرفضان أي ملف مرتبط بـ `question_sets`، ويرفضان ملفًا ليس المستخدم مالكه.
- الملف المشارَك مع القائد (ليس ملكه) لا يُفتح في غرفة: لا يعيد مشاركة ما
  ليس له.
- `/api/files` يستعمل الفحص نفسه، فالرابط المنسوخ يتوقف عن العمل بعد الخروج.

## 3. الصلاحيات

`settings` (jsonb، مخطط zod واحد):

```ts
{
  freeNav: boolean,                    // التنقل الحرّ
  marks: boolean,                      // التظليل المشترك
  chat: boolean,                       // الكتابة في المحادثة
  speak: "open" | "request" | "host",  // الكلام
  quizStart: "host" | "cohost",        // من يبدأ اختبارًا
  invite: "host" | "anyone",           // الدعوة (الخاصة)
}
```

`grants` لعضو بعينه يعلو على إعداد الغرفة في اتجاهَي المنح والسحب.
دالة واحدة `can(member, room, action)` في `lib/study-rooms/permissions.ts`،
**تُستدعى في كل procedure**، ولها اختبار جدولي يغطي كل تركيبة.

### المصفوفة

| الفعل | عضو | مشرف | قائد | أدمن |
|---|---|---|---|---|
| قراءة الملف المشترك | ✓ | ✓ | ✓ | — |
| تنقل حرّ | حسب `freeNav` | ✓ | ✓ | — |
| تغيير الصفحة المشتركة | بمنحة `lead` | بمنحة | ✓ | — |
| تظليل مشترك | حسب `marks` | ✓ | ✓ | — |
| حذف تظليله | ✓ | ✓ | ✓ | — |
| حذف تظليل غيره | ✗ | ✓ | ✓ | ✓ |
| إرسال رسالة | حسب `chat` | ✓ | ✓ | — |
| حذف رسالة غيره | ✗ | ✓ | ✓ | ✓ |
| فتح الميكروفون | حسب `speak` | ✓ | ✓ | — |
| كتم عضو | ✗ | ✓ | ✓ | — |
| طرد عضو | ✗ | ✓ (لا يطرد القائد) | ✓ | ✓ |
| حظر من الغرفة | ✗ | ✗ | ✓ | ✓ |
| تغيير الإعدادات والمنح | ✗ | ✗ | ✓ | — |
| تغيير الملف، قفل، إنهاء | ✗ | ✗ | ✓ | ✓ (إنهاء) |
| ترقية/تنزيل، نقل القيادة | ✗ | ✗ | ✓ | — |
| بدء اختبار جماعي | ✗ | حسب `quizStart` | ✓ | — |
| دعوة (الخاصة) | حسب `invite` | ✓ | ✓ | — |
| إبلاغ | ✓ | ✓ | ✓ | — |
| البلاغات وحظر المنصة | ✗ | ✗ | ✗ | ✓ |

الأدمن لا يدخل غرفة خاصة ولا يقرأ ملفها بصفته أدمن؛ يتصرف من لوحة البلاغات.

## 4. الـ API — router جديد `rooms` في `lib/trpc/roomsRouter.ts`

كل procedure: `protectedProcedure`، مدخلات zod، ثم بالترتيب: الميزة مفعّلة؟ ←
المستخدم غير محظور منصّيًا؟ ← عضو `joined`؟ ← `can(...)`؟ ← حدّ المعدّل ←
الفعل ← حدث تدقيق ← بثّ. الأخطاء بأكواد tRPC مع `message` عربي جاهز للعرض.

| Procedure | المدخل | المخرج | ملاحظات |
|---|---|---|---|
| `explore` (query) | `{q?, university?, major?, course?, language?, cursor?}` | `{rooms[], nextCursor}` | العامة النشطة غير المخفية؛ يستثني غرف من حظرتَه أو حظرك؛ 20 لكل صفحة |
| `suggest` (query) | `{field, q}` | `string[]` | اقتراحات الجامعة/التخصص/المقرر، 8 نتائج |
| `mine` (query) | — | `{active[], recent[]}` | |
| `create` (mutation) | `{visibility, title, capacity, language, university?, major?, course?, bookId?}` | `{roomId, inviteUrl?}` | يتحقق من ملكية الملف وأنه غير محمي؛ معاملة واحدة مع عضوية القائد |
| `preview` (query) | `{roomId}` أو `{invite}` | بيانات الردهة | للخاصة يلزم الرمز أو عضوية سابقة؛ لا يكشف الملف لغير من سيُقبل |
| `join` (mutation) | `{roomId, invite?}` | `{token, url, state}` | **معاملة مع قفل الصف** للسعة؛ idempotent للعضو الحاضر؛ يصدر توكن LiveKit |
| `token` (mutation) | `{roomId}` | `{token, url}` | تجديد التوكن لعضو حاضر |
| `state` (query) | `{roomId}` | الحالة الكاملة: الغرفة، الأعضاء، الصلاحيات، الصفحة، الاختبار الجاري، `seq` | لإعادة المزامنة |
| `leave` (mutation) | `{roomId}` | — | ينقل القيادة إن كان قائدًا |
| `setPage` (mutation) | `{roomId, page}` | — | حفظ دوري للصفحة المشتركة؛ القائد أو صاحب منحة `lead` |
| `update` (mutation) | `{roomId, title?, capacity?, locked?, settings?}` | — | القائد |
| `setBook` (mutation) | `{roomId, bookId \| null}` | — | القائد؛ نفس فحوص `create` |
| `rotateInvite` (mutation) | `{roomId}` | `{inviteUrl}` | يُبطل الرابط القديم |
| `setMember` (mutation) | `{roomId, userId, role?, grants?, muted?}` | — | حسب المصفوفة؛ الكتم يُنفَّذ في LiveKit |
| `remove` (mutation) | `{roomId, userId, ban}` | — | طرد أو حظر؛ يُخرجه من LiveKit فورًا |
| `transferHost` (mutation) | `{roomId, userId}` | — | معاملة |
| `end` (mutation) | `{roomId}` | — | القائد أو الأدمن |
| `messages` (query) | `{roomId, afterSeq?}` | `{messages[]}` | |
| `sendMessage` (mutation) | `{roomId, body, page?, clientId}` | `{id, seq}` | `clientId` يمنع التكرار عند إعادة الإرسال |
| `deleteMessage` (mutation) | `{roomId, id}` | — | |
| `marks` (query) | `{roomId, page?}` | `{marks[]}` | |
| `addMark` (mutation) | `{roomId, page, color, rects, text?, clientId}` | `{id}` | حدود العدد |
| `deleteMark` (mutation) | `{roomId, id}` | — | |
| `quiz.start` | `{roomId, bookId, count, seconds}` | `{quizId}` | ملف أسئلة يملكه البادئ وغير محمي |
| `quiz.current` (query) | `{roomId}` | السؤال الجاري **بلا الإجابة**، الوقت المتبقي بحساب السيرفر | |
| `quiz.answer` | `{quizId, questionId, selectedIndex}` | `{accepted}` | يُرفض بعد المهلة أو لسؤال غير الجاري |
| `quiz.advance` | `{quizId}` | — | كشف ثم السؤال التالي؛ القائد، أو تلقائيًا (انظر أسفل) |
| `quiz.cancel` | `{quizId}` | — | |
| `quiz.results` (query) | `{quizId}` | الترتيب والتفاصيل | |
| `summary` (query) | `{roomId}` | ملخّص الجلسة | لأعضائها، 30 يومًا |
| `report` (mutation) | `{roomId, targetUserId?, reason, details?}` | — | |
| `admin.reports` / `admin.resolve` / `admin.ban` / `admin.unban` / `admin.active` | | | `adminProcedure` |

**توقيت الاختبار بلا مؤقّت في السيرفر:** نسختا التطبيق بلا ذاكرة مشتركة،
فلا `setTimeout`. الحالة تُشتق من `questionStartedAt + secondsPerQuestion`:
أي عميل يستدعي `quiz.current` بعد انتهاء المهلة يجد السيرفر قد نقل الحالة
إلى `reveal` (تحديث شرطي ذرّي `where state='question' and currentIndex=$i`،
فلا يتكرر الانتقال مهما تزامنت الطلبات). عميل القائد يستدعي `quiz.advance`
تلقائيًا، وأي عميل آخر يكمل إن غاب القائد.

**مسار واحد خارج tRPC:** `POST /api/rooms/livekit` — webhook من LiveKit
(انضمام/خروج مشارك، انتهاء غرفة). يُتحقق من توقيعه بـ `livekit-server-sdk`
قبل أي قراءة، ويحدّث `lastSeenAt` و`lastActiveAt` ويشغّل إغلاق الغرفة الفارغة.

### توكن الغرفة

- يُصدَر في `join`/`token` فقط، بعد كل الفحوص.
- الهوية = `userId` (لا تُقبل من العميل)، والغرفة = `roomId`.
- العمر 10 دقائق (يكفي لبدء الاتصال؛ الاتصال القائم لا ينقطع بانتهائه).
- `canPublish` يطابق حق الكلام **لحظة الإصدار**؛ أي تغيير لاحق يُنفَّذ بـ
  `updateParticipant` من السيرفر. `canPublishData: true`، `canSubscribe: true`.
- السرّ في السيرفر فقط.

## 5. حالات الخطأ

| الحالة | الكود | ما يراه الطالب |
|---|---|---|
| الميزة مطفأة / الغرفة غير موجودة / خاصة بلا رمز | `NOT_FOUND` | «هذه الغرفة غير متاحة.» (ردّ واحد للحالات الثلاث، فلا يُكشف وجود غرفة خاصة) |
| رمز دعوة خاطئ أو مُبطَل | `NOT_FOUND` | «رابط الدعوة لم يعد صالحًا. اطلب رابطًا جديدًا.» |
| ممتلئة | `CONFLICT` | «الغرفة ممتلئة الآن.» + «نبّهني» |
| مقفلة | `FORBIDDEN` | «القائد أقفل الغرفة.» |
| محظور من الغرفة | `FORBIDDEN` | «لا يمكنك دخول هذه الغرفة.» |
| محظور من المنصة | `FORBIDDEN` | «حسابك موقوف عن غرف المذاكرة حتى …» |
| انتهت | `PRECONDITION_FAILED` | «انتهت هذه الجلسة.» + رابط الملخّص للأعضاء |
| فعل بلا صلاحية | `FORBIDDEN` | «القائد أوقف {الفعل} الآن.» |
| ملف محمي أو ليس ملكك | `BAD_REQUEST` | «هذا الملف لا يمكن فتحه في غرفة.» |
| تجاوز حدّ المعدّل | `TOO_MANY_REQUESTS` | «انتظر {n} ثانية ثم حاول.» |
| خدمة الصوت لا تردّ | `SERVICE_UNAVAILABLE` | «الصوت غير متاح الآن. الملف والمحادثة يعملان.» — الغرفة تفتح بلا صوت |
| إجابة بعد المهلة | `PRECONDITION_FAILED` | «انتهى وقت هذا السؤال.» |

**في المتصفح:** رفض إذن الميكروفون · لا يوجد ميكروفون · المتصفح لا يدعم
WebRTC · انقطاع الشبكة · فتح الغرفة من تبويب آخر — لكل واحدة رسالة وحلّ في
الواجهة، ولا واحدة منها تُخرج الطالب من الغرفة.

## 6. حدود المعدّل

بنمط `lib/queue/rateLimit.ts` (عدّ في Postgres ضمن نافذة زمنية):

| الفعل | الحدّ لكل مستخدم |
|---|---|
| إنشاء غرفة | 5 في الساعة، 15 في اليوم، وغرفة نشطة واحدة يقودها |
| انضمام | 20 في 10 دقائق |
| محاولة رمز دعوة خاطئ | 10 في الساعة، ثم إيقاف ساعة |
| رسالة | 5 في 10 ثوانٍ، 60 في 5 دقائق |
| تظليل مشترك | 20 في الدقيقة |
| بلاغ | 5 في اليوم |
| اقتراحات وبحث | 30 في الدقيقة |
| تجديد التوكن | 10 في 10 دقائق |

الأحداث العابرة على data channel (`at`, `page`, `hand`) تُخنق في العميل،
ويتجاهل العملاء ما يتجاوز 10 أحداث/ثانية من مرسل واحد.

## 7. تطبيق الـ migrations بأمان

1. ملف SQL واحد لكل مرحلة (`drizzle/00NN_study_rooms_*.sql`)، `create table`
   و`create index` فقط — لا `alter` على جدول قائم.
2. المالك يراجع الملف، ثم يأخذ **نسخة احتياطية** من لوحة Supabase.
3. التطبيق بسكربت معاملة واحدة بنمط `apply-00NN.cjs` المعتاد، يشغّله المالك.
4. الكود يُنشر **بعد** التطبيق، والميزة تبقى مطفأة بـ `STUDY_ROOMS_ENABLED`.
5. **التراجع:** إطفاء المفتاح يكفي. الجداول الجديدة لا يقرؤها أي كود قديم،
   وحذفها لاحقًا `drop table` لتسعة جداول بلا أثر على غيرها.

المرحلة 1 تضيف الجداول 1.1، 1.2، 1.7، 1.8، 1.9 · المرحلة 2 تضيف 1.4 ·
المرحلة 3 تضيف 1.3 · المرحلة 4 تضيف 1.5 و1.6.
