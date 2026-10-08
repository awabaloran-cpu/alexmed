import { SITE_ENTITY_DESCRIPTION_AR } from "@/lib/site";

export type LearnLanguage = "ar" | "en";
export type LearnCategory =
  | "brand"
  | "ai-study"
  | "pdf-study"
  | "flashcards"
  | "exam-prep"
  | "games"
  | "protected-sets";

export type LearnFeatureLink = {
  href: string;
  label: string;
  description: string;
};

export type LearnSection = {
  id: string;
  title: string;
  body: string[];
  bullets?: string[];
};

export type LearnArticle = {
  slug: string;
  title: string;
  description: string;
  language: LearnLanguage;
  category: LearnCategory;
  intent: string;
  keywords: string[];
  directAnswer: string;
  factBlock?: Record<string, string | string[]>;
  sections: LearnSection[];
  relatedArticles: string[];
  relatedFeatures: LearnFeatureLink[];
  publishedAt: string;
  updatedAt: string;
  indexable: boolean;
};

const productFeatures: Record<string, LearnFeatureLink> = {
  pdf: {
    href: "/pdf-summary",
    label: "تلخيص PDF",
    description: "حوّل الكتب والمحاضرات إلى ملخصات منظمة وأدوات مذاكرة.",
  },
  flashcards: {
    href: "/flashcards",
    label: "فلاش كارد",
    description: "راجع بأسئلة قصيرة وتكرار متباعد بدل إعادة القراءة فقط.",
  },
  mindMap: {
    href: "/mind-map",
    label: "خرائط ذهنية",
    description: "افهم علاقة الأفكار داخل كل جزء من الملف.",
  },
  studyMethod: {
    href: "/how-to-study",
    label: "طريقة المذاكرة",
    description: "خطة عملية لمذاكرة ملف كبير قبل الامتحان.",
  },
  telegramBot: {
    href: "/telegram-bot",
    label: "بوت Telegram",
    description: "أرسل ملف PDF في تلغرام وافتح أسئلته كاختبار تفاعلي.",
  },
  pastQuestions: {
    href: "/past-exam-questions",
    label: "أسئلة سنوات سابقة",
    description: "حوّل ملف أسئلة السنوات إلى اختبار تحلّه مع شرح.",
  },
  solveQuestions: {
    href: "/solve-questions",
    label: "حل أسئلة بالذكاء الاصطناعي",
    description: "أرسل ملف الأسئلة واحصل على إجابة كل سؤال مع شرحها.",
  },
  register: {
    href: "/register",
    label: "ابدأ مجانًا",
    description: "أنشئ حسابًا وارفع أول ملف للدراسة.",
  },
};

export const LEARN_ARTICLES: LearnArticle[] = [
  {
    slug: "nirolearn",
    title: "ما هو NiroLearn؟",
    description:
      "تعريف رسمي واضح لمنصة NiroLearn، جمهورها، أدواتها التعليمية، وحدود ما تفعله للطلاب.",
    language: "ar",
    category: "brand",
    intent: "brand-entity",
    keywords: [
      "NiroLearn",
      "ما هو NiroLearn",
      "منصة NiroLearn",
      "منصة دراسة بالذكاء الاصطناعي",
      "مساعد دراسة بالذكاء الاصطناعي",
    ],
    directAnswer: SITE_ENTITY_DESCRIPTION_AR,
    factBlock: {
      "Name": "NiroLearn",
      "Website": "https://nirolearn.com",
      "Type": "AI-powered learning platform",
      "Audience": "طلاب ومتعلمون",
      "Core tools": [
        "تلخيص PDF",
        "فلاش كارد",
        "أسئلة واختبارات",
        "خرائط ذهنية",
        "Exam Focus",
        "ألعاب تعليمية",
      ],
    },
    sections: [
      {
        id: "what-it-does",
        title: "ماذا يفعل NiroLearn؟",
        body: [
          "يركّز NiroLearn على تحويل مادة الطالب نفسها إلى أدوات مذاكرة قابلة للاستخدام: ملخص، بطاقات مراجعة، أسئلة، اختبارات، وخريطة ذهنية. الهدف ليس استبدال الدراسة، بل تنظيمها حول مصادر الطالب الأصلية.",
          "المنصة عربية في الواجهة، وتدعم مذاكرة ملفات عربية أو إنجليزية مع الحفاظ على المصطلحات العلمية عندما تكون مهمة.",
        ],
        bullets: [
          "تلخيص ملفات PDF الكبيرة إلى أجزاء قابلة للمذاكرة.",
          "استخراج نقاط Exam Focus للمراجعة قبل الامتحان.",
          "إنشاء فلاش كارد وأسئلة من محتوى الطالب نفسه.",
          "تقديم خرائط ذهنية تساعد على رؤية العلاقات بين الأفكار.",
        ],
      },
      {
        id: "who-for",
        title: "لمن صُممت المنصة؟",
        body: [
          "NiroLearn موجّه للطلاب والمتعلمين الذين يدرسون من كتب ومحاضرات وملفات أسئلة. يناسب الطالب الجامعي، وطلاب المواد العلمية، ومن يحتاج إلى مراجعة منظمة قبل الامتحان.",
          "الصفحات العامة تشرح المنتج فقط. ملفات الطلاب، محتوى الأسئلة المحمية، ولوحات التحكم الخاصة تبقى داخل الحساب وليست محتوى عامًا للفهرسة.",
        ],
      },
      {
        id: "boundaries",
        title: "ما حدود NiroLearn؟",
        body: [
          "NiroLearn أداة دراسة وتنظيم ومراجعة، وليس مصدرًا رسميًا بديلًا عن كتاب المادة أو تعليمات المدرّس. يجب الرجوع إلى المصدر الأصلي عند المراجعة النهائية أو عند وجود معلومة حساسة.",
        ],
      },
    ],
    relatedArticles: [
      "ai-study-guide",
      "pdf-study-guide",
      "protected-question-sets",
    ],
    relatedFeatures: [
      productFeatures.pdf,
      productFeatures.flashcards,
      productFeatures.mindMap,
      productFeatures.telegramBot,
      productFeatures.solveQuestions,
    ],
    publishedAt: "2026-10-02",
    updatedAt: "2026-10-02",
    indexable: true,
  },
  {
    slug: "ai-study-guide",
    title: "دليل الدراسة بالذكاء الاصطناعي للطلاب",
    description:
      "كيف تستخدم الذكاء الاصطناعي في المذاكرة دون أن تفقد الفهم أو تعتمد على إجابات غير موثقة.",
    language: "ar",
    category: "ai-study",
    intent: "informational",
    keywords: [
      "الدراسة بالذكاء الاصطناعي",
      "مساعد دراسة بالذكاء الاصطناعي",
      "AI study assistant",
      "أدوات ذكاء اصطناعي للطلاب",
    ],
    directAnswer:
      "الدراسة بالذكاء الاصطناعي تعني استخدام أدوات تساعدك على تنظيم المادة، تلخيصها، توليد أسئلة منها، ومراجعتها بطريقة نشطة. الاستخدام الجيد يبدأ من مصدر موثوق مثل كتابك أو محاضرتك، ثم يتحقق الطالب من النتائج بدل الاعتماد عليها بشكل أعمى.",
    sections: [
      {
        id: "workflow",
        title: "سير عمل عملي للدراسة بالذكاء الاصطناعي",
        body: [
          "ابدأ بالمصدر الأصلي، ثم اطلب تحويله إلى أجزاء قابلة للمذاكرة. بعد ذلك راجع الملخص، أجب عن أسئلة، واستخدم الفلاش كارد للتكرار المتباعد.",
        ],
        bullets: [
          "ارفع أو حدّد المادة التي تريد مذاكرتها.",
          "اقرأ ملخصًا قصيرًا لتكوين الصورة العامة.",
          "اختبر نفسك بأسئلة مبنية على نفس المادة.",
          "راجع ما أخطأت فيه بدل إعادة قراءة كل شيء.",
        ],
      },
      {
        id: "mistakes",
        title: "أخطاء شائعة",
        body: [
          "أكبر خطأ هو تحويل الذكاء الاصطناعي إلى بديل عن الفهم. إذا نسخت إجابة دون أن تراجع المصدر أو تختبر نفسك، فقد تبدو المذاكرة أسرع لكنها أقل ثباتًا.",
        ],
        bullets: [
          "طلب ملخص عام بلا مصدر واضح.",
          "حفظ الإجابات دون محاولة التذكر أولًا.",
          "عدم الرجوع إلى صفحات الكتاب عند الشك.",
        ],
      },
      {
        id: "nirolearn-fit",
        title: "أين يدخل NiroLearn؟",
        body: [
          "NiroLearn يربط أدوات الذكاء الاصطناعي بمادة الطالب نفسها: PDF، ملخص، Exam Focus، فلاش كارد، اختبارات، وخريطة ذهنية. هذا يجعل سير العمل أقرب إلى المذاكرة الفعلية من محادثة عامة فقط.",
        ],
      },
    ],
    relatedArticles: [
      "nirolearn",
      "pdf-study-guide",
      "exam-preparation-guide",
      "pdf-questions-to-interactive-quiz",
    ],
    relatedFeatures: [
      productFeatures.pdf,
      productFeatures.studyMethod,
      productFeatures.solveQuestions,
    ],
    publishedAt: "2026-10-02",
    updatedAt: "2026-10-02",
    indexable: true,
  },
  {
    slug: "pdf-study-guide",
    title: "كيف تذاكر من ملف PDF كبير؟",
    description:
      "طريقة عملية لتحويل كتاب أو محاضرة PDF إلى خطة مذاكرة، ملخصات، أسئلة، وبطاقات مراجعة.",
    language: "ar",
    category: "pdf-study",
    intent: "problem-solution",
    keywords: [
      "تلخيص PDF للطلاب",
      "كيف أذاكر من ملف PDF",
      "تحويل PDF إلى أسئلة",
      "تحويل PDF إلى فلاش كارد",
    ],
    directAnswer:
      "لمذاكرة ملف PDF كبير، قسّمه إلى أجزاء صغيرة، اقرأ ملخص كل جزء، حدّد المعلومات عالية الأهمية، ثم اختبر نفسك بأسئلة وبطاقات مراجعة بدل الاكتفاء بإعادة القراءة.",
    sections: [
      {
        id: "steps",
        title: "خطوات مذاكرة ملف PDF كبير",
        body: [
          "الملف الكبير لا يُذاكَر دفعة واحدة. قسّمه إلى وحدات، ثم امنح كل وحدة هدفًا واضحًا: فهم عام، تفاصيل مهمة، أسئلة، ثم مراجعة.",
        ],
        bullets: [
          "ابدأ بالفهرس أو عناوين المحاضرة لتعرف الحدود.",
          "اكتب سؤالًا واحدًا تريد إجابته من كل جزء.",
          "حوّل النقاط المهمة إلى أسئلة قصيرة.",
          "راجع البطاقات بعد يوم ثم بعد عدة أيام.",
        ],
      },
      {
        id: "large-files",
        title: "ماذا عن الكتب والمحاضرات الطويلة؟",
        body: [
          "كلما كان الملف أكبر، زادت أهمية التقسيم. الملخص وحده لا يكفي؛ تحتاج إلى أسئلة تكشف ما فهمته، ونقاط Exam Focus تساعدك على ترتيب الأولويات.",
        ],
      },
      {
        id: "nirolearn-pdf",
        title: "كيف يساعد NiroLearn في ملفات PDF؟",
        body: [
          "يركّز NiroLearn على تحويل PDF إلى موارد مذاكرة مترابطة: ملخصات، فلاش كارد، اختبارات، خرائط ذهنية، وأهم نقاط الامتحان. تبقى المراجعة مرتبطة بالمادة الأصلية بدل أن تكون ملاحظات منفصلة.",
        ],
      },
    ],
    relatedArticles: [
      "flashcards-guide",
      "exam-preparation-guide",
      "nirolearn",
      "pdf-questions-to-interactive-quiz",
    ],
    relatedFeatures: [
      productFeatures.pdf,
      productFeatures.flashcards,
      productFeatures.mindMap,
      productFeatures.telegramBot,
    ],
    publishedAt: "2026-10-02",
    updatedAt: "2026-10-02",
    indexable: true,
  },
  {
    slug: "flashcards-guide",
    title: "دليل الفلاش كارد: كيف تراجع بذكاء؟",
    description:
      "شرح الفلاش كارد، الاسترجاع النشط، التكرار المتباعد، وأخطاء البطاقات الشائعة.",
    language: "ar",
    category: "flashcards",
    intent: "educational",
    keywords: [
      "ما هي الفلاش كارد",
      "التكرار المتباعد",
      "الاسترجاع النشط",
      "AI flashcards",
      "فلاش كارد من PDF",
    ],
    directAnswer:
      "الفلاش كارد بطاقة سؤال وجواب تجبرك على تذكّر المعلومة قبل رؤية الإجابة. فائدتها الأساسية أنها تطبق الاسترجاع النشط، وتصبح أقوى عندما تراجعها بتكرار متباعد.",
    sections: [
      {
        id: "definition",
        title: "ما هي الفلاش كارد؟",
        body: [
          "البطاقة الجيدة ليست نسخة من فقرة الكتاب. هي سؤال محدد يقيس معلومة واحدة أو علاقة واحدة، مع إجابة قصيرة وواضحة.",
        ],
      },
      {
        id: "better-cards",
        title: "كيف تصنع بطاقات أفضل؟",
        body: [
          "اجعل السؤال قابلًا للإجابة من الذاكرة، ولا تجمع أكثر من فكرة في بطاقة واحدة. إذا كانت الإجابة طويلة جدًا، قسّمها إلى عدة بطاقات.",
        ],
        bullets: [
          "اسأل قبل أن تكشف الإجابة.",
          "استخدم أمثلة من محاضرتك عندما يكون ذلك مفيدًا.",
          "راجع البطاقات الصعبة أكثر من السهلة.",
        ],
      },
      {
        id: "nirolearn-cards",
        title: "الفلاش كارد في NiroLearn",
        body: [
          "يمكن أن يحوّل NiroLearn أجزاء الملف إلى بطاقات سؤال وجواب، ثم تستخدمها للمراجعة بدل إعادة قراءة الملف كاملًا. الهدف أن تقيس تذكرك للمعلومة لا أن تنظر إليها فقط.",
        ],
      },
    ],
    relatedArticles: ["pdf-study-guide", "exam-preparation-guide", "ai-study-guide"],
    relatedFeatures: [productFeatures.flashcards, productFeatures.pdf],
    publishedAt: "2026-10-02",
    updatedAt: "2026-10-02",
    indexable: true,
  },
  {
    slug: "exam-preparation-guide",
    title: "دليل التحضير للامتحان: من المادة إلى الأسئلة",
    description:
      "كيف تراجع قبل الامتحان باستخدام الأسئلة، Exam Focus، الفلاش كارد، وخطة مراجعة واقعية.",
    language: "ar",
    category: "exam-prep",
    intent: "educational",
    keywords: [
      "التحضير للامتحان",
      "مراجعة قبل الامتحان",
      "Exam Focus",
      "أسئلة للمذاكرة",
      "اختبارات تعليمية",
    ],
    directAnswer:
      "أفضل تحضير للامتحان يجمع بين تحديد المهم، حل الأسئلة، مراجعة الأخطاء، وتكرار المعلومات التي تنساها. القراءة وحدها لا تكشف جاهزيتك مثل الاختبار الذاتي.",
    sections: [
      {
        id: "plan",
        title: "خطة مراجعة مختصرة",
        body: [
          "ابدأ بما يتكرر في المحاضرات والأسئلة السابقة، ثم اربط كل نقطة بسؤال. استخدم الوقت الأخير للمراجعة النشطة لا للقراءة العشوائية.",
        ],
        bullets: [
          "اليوم الأول: صورة عامة وتقسيم المادة.",
          "الأيام التالية: أسئلة وفلاش كارد لكل جزء.",
          "قبل الامتحان: مراجعة الأخطاء والنقاط عالية الأهمية.",
        ],
      },
      {
        id: "questions",
        title: "لماذا الأسئلة مهمة؟",
        body: [
          "السؤال يكشف فجوة الفهم بسرعة. عندما تخطئ، تحصل على خريطة لما يجب مراجعته بدل الشعور العام بأنك غير جاهز.",
        ],
      },
      {
        id: "exam-focus",
        title: "دور Exam Focus",
        body: [
          "Exam Focus يساعدك على رؤية النقاط عالية الأهمية داخل المادة، لكنه لا يلغي الرجوع إلى المصدر أو حل الأسئلة. استخدمه كبوصلة للمراجعة، لا كبديل كامل عن الدراسة.",
        ],
      },
    ],
    relatedArticles: [
      "pdf-questions-to-interactive-quiz",
      "flashcards-guide",
      "pdf-study-guide",
      "ai-study-guide",
    ],
    relatedFeatures: [
      productFeatures.studyMethod,
      productFeatures.pastQuestions,
      productFeatures.solveQuestions,
      productFeatures.flashcards,
      productFeatures.pdf,
    ],
    publishedAt: "2026-10-02",
    updatedAt: "2026-10-02",
    indexable: true,
  },
  {
    slug: "educational-games-guide",
    title: "الألعاب التعليمية في NiroLearn",
    description:
      "شرح دور الألعاب التعليمية في فترات المذاكرة، مع توضيح ألعاب NiroLearn الحالية دون اختراع ميزات غير موجودة.",
    language: "ar",
    category: "games",
    intent: "product-knowledge",
    keywords: [
      "ألعاب تعليمية",
      "ألعاب رياضيات",
      "ألعاب ضرب",
      "سودوكو تعليمي",
      "learning games",
    ],
    directAnswer:
      "الألعاب التعليمية يمكن أن تكون استراحة نشطة أثناء المذاكرة: تدريب سريع على الحساب، جدول الضرب، المنطق، أو المعلومات العامة. في NiroLearn توجد ألعاب مثل تحدي الحساب، جدول الضرب، سودوكو، ومعلومات عامة.",
    sections: [
      {
        id: "role",
        title: "ما دور الألعاب التعليمية؟",
        body: [
          "ليست كل لعبة تعليمية بديلًا عن المذاكرة. فائدتها الأكبر أنها تمنح تدريبًا قصيرًا على مهارة محددة أو استراحة ذهنية لا تقطعك تمامًا عن جو التعلم.",
        ],
      },
      {
        id: "actual-games",
        title: "الألعاب الموجودة حاليًا",
        body: [
          "NiroLearn يحتوي على تحدي الحساب، جدول الضرب، سودوكو، ومعلومات عامة. هذه الصفحة تذكر الألعاب الموجودة فقط ولا تعد بألعاب غير مطبقة.",
        ],
        bullets: [
          "تحدي الحساب: سرعة ودقة في العمليات الحسابية.",
          "جدول الضرب: تدريب مباشر على الضرب.",
          "سودوكو: منطق وتركيز وحل تدريجي.",
          "معلومات عامة: أسئلة معرفة متنوعة.",
        ],
      },
      {
        id: "study-breaks",
        title: "كيف تستخدمها كاستراحة؟",
        body: [
          "اجعل اللعبة قصيرة ومحددة الوقت. إذا تحولت الاستراحة إلى هروب طويل من المادة، فهي لم تعد تخدم المذاكرة.",
        ],
      },
    ],
    relatedArticles: ["nirolearn", "ai-study-guide", "exam-preparation-guide"],
    relatedFeatures: [productFeatures.register],
    publishedAt: "2026-10-02",
    updatedAt: "2026-10-02",
    indexable: true,
  },
  {
    slug: "protected-question-sets",
    title: "ما هي مجموعات الأسئلة المحمية؟",
    description:
      "شرح عام وآمن لميزة مجموعات الأسئلة المحمية للمدرسين والأطباء والطلاب دون كشف محتوى أو تفاصيل تنفيذية.",
    language: "ar",
    category: "protected-sets",
    intent: "product-knowledge",
    keywords: [
      "مجموعات أسئلة محمية",
      "doctor question sets",
      "protected question sets",
      "أكواد وصول للطلاب",
      "بنوك أسئلة طبية محمية",
    ],
    directAnswer:
      "مجموعات الأسئلة المحمية هي طريقة يرفع فيها المدرّس أو الطبيب مادة أسئلة داخل NiroLearn، ثم يدرسها الطلاب داخل المنصة عبر آلية وصول مخصصة. الهدف هو تنظيم الأسئلة للمذاكرة مع إبقاء المصدر والمحتوى المحمي خارج الفهرسة والتنزيل العام.",
    sections: [
      {
        id: "workflow",
        title: "كيف يعمل المفهوم؟",
        body: [
          "يرفع صاحب المحتوى مادة الأسئلة، ويقوم NiroLearn بتنظيمها للعرض والدراسة داخل الحساب. الطالب لا يحصل على رابط عام مفتوح للمصدر، بل يدخل إلى تجربة دراسة محمية حسب آلية الوصول المحددة.",
        ],
        bullets: [
          "المادة المحمية ليست صفحة عامة للفهرسة.",
          "الطلاب يدرسون داخل NiroLearn بدل تنزيل المصدر علنًا.",
          "يمكن استخدام أكواد وصول مخصصة، وقد تكون لمرة واحدة حسب الإعداد.",
        ],
      },
      {
        id: "privacy",
        title: "ما الذي لا تعرضه الصفحات العامة؟",
        body: [
          "الشرح العام لا يكشف ملفات الأسئلة، روابط التخزين، الأكواد، بيانات الأطباء، بيانات الطلاب، أو أي تفاصيل داخلية عن التفويض والحماية.",
        ],
      },
      {
        id: "separate-flow",
        title: "منفصلة عن ملفات الطالب العادية",
        body: [
          "ملف الطالب الشخصي وملف مجموعة أسئلة محمية ليسا نفس الشيء. المحتوى المحمي له تدفق وصول مختلف وحدود خصوصية أقوى، لذلك يجب ألا يظهر في sitemap أو صفحات عامة قابلة للفهرسة.",
        ],
      },
    ],
    relatedArticles: ["nirolearn", "exam-preparation-guide", "pdf-study-guide"],
    relatedFeatures: [productFeatures.register],
    publishedAt: "2026-10-02",
    updatedAt: "2026-10-02",
    indexable: true,
  },
  {
    slug: "pdf-questions-to-interactive-quiz",
    title: "تحويل ملف أسئلة PDF إلى اختبار تفاعلي",
    description:
      "كيف تحوّل ملف أسئلة السنوات السابقة من PDF إلى اختبار تحلّه سؤالًا سؤالًا مع شرح لكل إجابة، وما الذي يجعل الملف يُقرأ بشكل صحيح.",
    language: "ar",
    category: "exam-prep",
    intent: "how-to",
    keywords: [
      "تحويل PDF إلى أسئلة",
      "تحويل ملف أسئلة إلى اختبار",
      "اختبار تفاعلي من PDF",
      "أسئلة سنوات سابقة",
      "بوت تلغرام أسئلة",
    ],
    directAnswer:
      "لتحويل ملف أسئلة PDF إلى اختبار تفاعلي، ارفعه في NiroLearn من الموقع أو أرسله للبوت على تلغرام. تُستخرج الأسئلة وخياراتها وإجاباتها من نص الملف نفسه، ثم تحلّها سؤالًا سؤالًا: تختار إجابة فتعرف فورًا إن كانت صحيحة، مع شرح بالعربية وكلمات مفتاحية لكل سؤال. الملف المنظّم (رقم السؤال، ثم الخيارات، ثم الإجابة) يُقرأ بأعلى دقة.",
    factBlock: {
      "ماذا ترفع": "ملف أسئلة بصيغة PDF: اختيار من متعدد، مع الإجابات أو بدونها",
      "ماذا تحصل": [
        "اختبار تفاعلي سؤالًا سؤالًا",
        "شرح بالعربية لكل إجابة",
        "كلمات مفتاحية وجملة ربط قصيرة",
        "حفظ التقدّم والإكمال لاحقًا",
      ],
      "من أين": "موقع NiroLearn أو بوت NiroLearn على تلغرام",
    },
    sections: [
      {
        id: "why",
        title: "لماذا تحوّل ملف الأسئلة أصلًا؟",
        body: [
          "ملف الأسئلة بصيغة PDF يعرض السؤال وإجابته في الصفحة نفسها، فتقع عينك على الإجابة قبل أن تفكّر. الاختبار التفاعلي يخفي الإجابة حتى تختار، وهذا هو الاسترجاع النشط: أن تحاول التذكّر أولًا ثم تتحقق.",
          "وعندما تُحفظ إجاباتك، تعرف في نهاية الملف أي الأسئلة أخطأت فيها، فتراجعها هي بدل إعادة الملف كله.",
        ],
      },
      {
        id: "steps",
        title: "الخطوات",
        body: [
          "الطريقة واحدة سواء رفعت الملف من الموقع أو أرسلته للبوت على تلغرام.",
        ],
        bullets: [
          "ارفع ملف الأسئلة PDF من صفحة «رفع ملف» في الموقع، أو أرسله لبوت NiroLearn في تلغرام.",
          "انتظر قراءة الملف: الملف النصي يجهز خلال ثوانٍ، والممسوح ضوئيًا يأخذ أطول.",
          "افتح الملف وحلّ الأسئلة واحدًا واحدًا. الشروح تُضاف تباعًا للملفات الطويلة.",
          "ارجع لاحقًا وأكمل من أول سؤال لم تجبه.",
        ],
      },
      {
        id: "answers",
        title: "من أين تأتي الإجابة الصحيحة؟",
        body: [
          "إذا ذكر الملف إجابة السؤال (سطر «Answer: B» تحت السؤال، أو مفتاح إجابات في آخر الملف)، فهي المعتمدة كما هي.",
          "إذا لم يذكر الملف إجابة، تظهر إجابة مقترحة من الذكاء الاصطناعي وعليها علامة واضحة بذلك. تعامل معها كاقتراح وراجعها مع مصدرك، فهي قد تخطئ.",
        ],
      },
      {
        id: "format",
        title: "ما الذي يجعل الملف يُقرأ بشكل صحيح؟",
        body: [
          "الأسئلة تُستخرج بقراءة بنية الملف: رقم السؤال، نصه، ثم الخيارات. كلما كانت البنية أوضح كان الاستخراج أدق.",
        ],
        bullets: [
          "ترقيم ثابت للأسئلة: 1. أو 1) أو 01 في أول السطر.",
          "خيارات تبدأ بحرف: A. B. C. D. أو أ) ب) ج) د).",
          "سطر إجابة واضح بعد كل سؤال، أو مفتاح إجابات في قسم مستقل.",
          "ملف نصي أفضل من صور ممسوحة. الممسوح يُقرأ أيضًا لكنه أبطأ وأكثر عرضة لأخطاء الحروف.",
          "الأسئلة التي لا يمكن التأكد من بنيتها لا تُعرض، حتى لا تحلّ سؤالًا مشوّهًا.",
        ],
      },
      {
        id: "limits",
        title: "حدود يجب أن تعرفها",
        body: [
          "الاختبار يعرض أسئلة ملفك أنت، ولا يضيف أسئلة من خارجه. وشرح الإجابة يكتبه الذكاء الاصطناعي اعتمادًا على السؤال وخياراته، فهو مساعد للفهم وليس مرجعًا يغني عن كتابك أو محاضرتك.",
          "البوت على تلغرام يقبل حاليًا ملفات حتى 20 ميغابايت. الأكبر من ذلك يُرفع من الموقع.",
        ],
      },
    ],
    relatedArticles: [
      "exam-preparation-guide",
      "flashcards-guide",
      "pdf-study-guide",
    ],
    relatedFeatures: [
      productFeatures.telegramBot,
      productFeatures.pastQuestions,
      productFeatures.solveQuestions,
      productFeatures.flashcards,
      productFeatures.studyMethod,
    ],
    publishedAt: "2026-10-08",
    updatedAt: "2026-10-08",
    indexable: true,
  },
];

export const LEARN_ARTICLE_BY_SLUG = new Map(
  LEARN_ARTICLES.map(article => [article.slug, article])
);

export const INDEXABLE_LEARN_ARTICLES = LEARN_ARTICLES.filter(
  article => article.indexable
);

export function getLearnArticle(slug: string): LearnArticle | undefined {
  return LEARN_ARTICLE_BY_SLUG.get(slug);
}

export function learnPath(slug: string): `/learn/${string}` {
  return `/learn/${slug}`;
}
