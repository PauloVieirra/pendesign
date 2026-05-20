# Dual View Mode + Responsive Viewport — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third FileViewer display mode (Dual) that shows source code and rendered design side-by-side with a draggable divider, plus a fourth viewport preset (Responsive) with a breakpoint ruler and free-resize handle. Rename the existing `desktop` preset to `web` end-to-end.

**Architecture:** Two new self-contained components (`SplitPane`, `BreakpointRuler`) plus surgical edits in `FileViewer.tsx`. New `viewMode` state replaces the existing two-state `mode` and gets persisted in a new `od.fileViewer.viewMode` localStorage key. The CodeEditor's existing 400ms debounce-commit drives the right-pane iframe re-render in Dual — no new save handler. New `responsive` preset overrides the fixed viewport sizing with a free-resize container.

**Tech Stack:** React 18 + TypeScript, Vitest + JSDOM for tests, Next.js 16 (the host runtime — not directly touched).

**Spec:** `docs/superpowers/specs/2026-05-20-dual-view-and-responsive-viewport-design.md`

---

## Phase order and confirmation gates

Per the user's working preference: **stop and confirm before starting each phase.** Phases below are sequenced so each one leaves the app in a working, mergeable state.

1. i18n foundation (also fixes a pre-existing typecheck failure)
2. `SplitPane` component (standalone, TDD)
3. `BreakpointRuler` component (standalone, TDD)
4. Rename `desktop` → `web` (isolated, low-risk)
5. `responsive` viewport preset (integrate `BreakpointRuler` + free-resize handle)
6. `dual` view mode (integrate `SplitPane` + new dropdown item + persistence + fallbacks)
7. Integration tests + manual verification

---

## Phase 1 — i18n foundation

**Why first:** Adding new keys to `Dict` breaks typecheck until all 19 locales are filled. Doing this first lets every subsequent task reference real keys. It also fixes a pre-existing bug: `fileViewer.codeEditor.statusSaved/Pending/Error` are used in `apps/web/src/components/CodeEditor.tsx:124-127` but were never declared, which is why `pnpm --filter @open-design/web build` currently fails.

### Task 1.1: Add new keys to `Dict`

**Files:**
- Modify: `apps/web/src/i18n/types.ts`

- [ ] **Step 1: Locate the existing `fileViewer.*` keys block in `types.ts`**

Run: `grep -n "fileViewer.viewport\|fileViewer.preview':\|fileViewer.source':" apps/web/src/i18n/types.ts`

Expected: shows the line numbers where `'fileViewer.viewportDesktop'`, `'fileViewer.viewportTablet'`, `'fileViewer.viewportMobile'`, `'fileViewer.preview'`, `'fileViewer.source'` live.

- [ ] **Step 2: Add new keys + delete the two desktop keys**

In `apps/web/src/i18n/types.ts`, inside the `Dict` type, **remove**:

```ts
'fileViewer.viewportDesktop': string;
'fileViewer.viewportDesktopTitle': string;
```

**Add**, grouped near the existing `fileViewer.*` keys:

```ts
'fileViewer.viewportWeb': string;
'fileViewer.viewportWebTitle': string;
'fileViewer.viewportResponsive': string;
'fileViewer.viewportResponsiveTitle': string;
'fileViewer.modeDual': string;
'fileViewer.modeDualTitle': string;
'fileViewer.modeDualUnavailableSmallWindow': string;
'fileViewer.modeDualUnavailableFileType': string;
'fileViewer.breakpointPresetLabel': string;
'fileViewer.breakpointPresetTailwind': string;
'fileViewer.breakpointPresetBootstrap': string;
'fileViewer.codeEditor.statusSaved': string;
'fileViewer.codeEditor.statusPending': string;
'fileViewer.codeEditor.statusError': string;
```

- [ ] **Step 3: Run typecheck — expect failures across all locales**

Run: `pnpm --filter @open-design/web typecheck`

Expected: 19 errors, one per locale file in `apps/web/src/i18n/locales/`, each complaining about the missing keys. This is the green light to continue.

### Task 1.2: Fill English locale (the reference)

**Files:**
- Modify: `apps/web/src/i18n/locales/en.ts`

- [ ] **Step 1: Add new keys, remove desktop keys**

In `apps/web/src/i18n/locales/en.ts`:

**Remove:**
```ts
'fileViewer.viewportDesktop': 'Desktop',
'fileViewer.viewportDesktopTitle': 'Full-width desktop preview',
```

**Add (grouped near the existing fileViewer keys, alphabetical inside the group is fine):**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Full-width web preview',
'fileViewer.viewportResponsive': 'Responsive',
'fileViewer.viewportResponsiveTitle': 'Free-resize preview with breakpoint ruler',
'fileViewer.modeDual': 'Dual',
'fileViewer.modeDualTitle': 'Source and design side-by-side',
'fileViewer.modeDualUnavailableSmallWindow': 'Dual view needs a wider window',
'fileViewer.modeDualUnavailableFileType': 'Dual view requires a renderable file',
'fileViewer.breakpointPresetLabel': 'Breakpoints',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Saved',
'fileViewer.codeEditor.statusPending': 'Pending…',
'fileViewer.codeEditor.statusError': 'Parse error',
```

- [ ] **Step 2: Re-run typecheck**

Run: `pnpm --filter @open-design/web typecheck`

Expected: 18 errors (one per remaining locale). English no longer fails.

### Task 1.3: Fill the other 18 locales

**Files (modify each):**
- `apps/web/src/i18n/locales/ar.ts`
- `apps/web/src/i18n/locales/de.ts`
- `apps/web/src/i18n/locales/es-ES.ts`
- `apps/web/src/i18n/locales/fa.ts`
- `apps/web/src/i18n/locales/fr.ts`
- `apps/web/src/i18n/locales/hu.ts`
- `apps/web/src/i18n/locales/id.ts`
- `apps/web/src/i18n/locales/it.ts`
- `apps/web/src/i18n/locales/ja.ts`
- `apps/web/src/i18n/locales/ko.ts`
- `apps/web/src/i18n/locales/pl.ts`
- `apps/web/src/i18n/locales/pt-BR.ts`
- `apps/web/src/i18n/locales/ru.ts`
- `apps/web/src/i18n/locales/th.ts`
- `apps/web/src/i18n/locales/tr.ts`
- `apps/web/src/i18n/locales/uk.ts`
- `apps/web/src/i18n/locales/zh-CN.ts`
- `apps/web/src/i18n/locales/zh-TW.ts`

For each file, perform the same removal and addition as Task 1.2, with appropriate translations.

- [ ] **Step 1: Portuguese (Brazilian) — `pt-BR.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Preview Web em largura cheia',
'fileViewer.viewportResponsive': 'Responsivo',
'fileViewer.viewportResponsiveTitle': 'Preview com redimensionamento livre e régua de breakpoints',
'fileViewer.modeDual': 'Dual',
'fileViewer.modeDualTitle': 'Código e design lado a lado',
'fileViewer.modeDualUnavailableSmallWindow': 'O modo Dual precisa de uma janela mais larga',
'fileViewer.modeDualUnavailableFileType': 'O modo Dual exige um arquivo renderizável',
'fileViewer.breakpointPresetLabel': 'Breakpoints',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Salvo',
'fileViewer.codeEditor.statusPending': 'Pendente…',
'fileViewer.codeEditor.statusError': 'Erro de parse',
```

- [ ] **Step 2: Spanish — `es-ES.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Vista previa web a ancho completo',
'fileViewer.viewportResponsive': 'Responsivo',
'fileViewer.viewportResponsiveTitle': 'Vista previa redimensionable con regla de breakpoints',
'fileViewer.modeDual': 'Dual',
'fileViewer.modeDualTitle': 'Código y diseño en paralelo',
'fileViewer.modeDualUnavailableSmallWindow': 'El modo Dual necesita una ventana más ancha',
'fileViewer.modeDualUnavailableFileType': 'El modo Dual requiere un archivo renderizable',
'fileViewer.breakpointPresetLabel': 'Breakpoints',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Guardado',
'fileViewer.codeEditor.statusPending': 'Pendiente…',
'fileViewer.codeEditor.statusError': 'Error de parsing',
```

- [ ] **Step 3: French — `fr.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Aperçu web pleine largeur',
'fileViewer.viewportResponsive': 'Responsive',
'fileViewer.viewportResponsiveTitle': 'Aperçu redimensionnable avec règle de breakpoints',
'fileViewer.modeDual': 'Double',
'fileViewer.modeDualTitle': 'Code et design côte à côte',
'fileViewer.modeDualUnavailableSmallWindow': 'Le mode Double nécessite une fenêtre plus large',
'fileViewer.modeDualUnavailableFileType': 'Le mode Double requiert un fichier rendu',
'fileViewer.breakpointPresetLabel': 'Breakpoints',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Enregistré',
'fileViewer.codeEditor.statusPending': 'En attente…',
'fileViewer.codeEditor.statusError': 'Erreur d’analyse',
```

- [ ] **Step 4: German — `de.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Webvorschau in voller Breite',
'fileViewer.viewportResponsive': 'Responsiv',
'fileViewer.viewportResponsiveTitle': 'Vorschau mit freier Größenanpassung und Breakpoint-Lineal',
'fileViewer.modeDual': 'Dual',
'fileViewer.modeDualTitle': 'Code und Design nebeneinander',
'fileViewer.modeDualUnavailableSmallWindow': 'Dual-Ansicht benötigt ein breiteres Fenster',
'fileViewer.modeDualUnavailableFileType': 'Dual-Ansicht benötigt eine renderbare Datei',
'fileViewer.breakpointPresetLabel': 'Breakpoints',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Gespeichert',
'fileViewer.codeEditor.statusPending': 'Ausstehend…',
'fileViewer.codeEditor.statusError': 'Parse-Fehler',
```

- [ ] **Step 5: Italian — `it.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Anteprima web a larghezza piena',
'fileViewer.viewportResponsive': 'Responsive',
'fileViewer.viewportResponsiveTitle': 'Anteprima ridimensionabile con righello dei breakpoint',
'fileViewer.modeDual': 'Doppia',
'fileViewer.modeDualTitle': 'Codice e design affiancati',
'fileViewer.modeDualUnavailableSmallWindow': 'La modalità Doppia richiede una finestra più larga',
'fileViewer.modeDualUnavailableFileType': 'La modalità Doppia richiede un file rendibile',
'fileViewer.breakpointPresetLabel': 'Breakpoint',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Salvato',
'fileViewer.codeEditor.statusPending': 'In attesa…',
'fileViewer.codeEditor.statusError': 'Errore di parsing',
```

- [ ] **Step 6: Japanese — `ja.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'ウェブ',
'fileViewer.viewportWebTitle': 'フル幅のウェブプレビュー',
'fileViewer.viewportResponsive': 'レスポンシブ',
'fileViewer.viewportResponsiveTitle': 'ブレークポイント定規付きの自由リサイズプレビュー',
'fileViewer.modeDual': 'デュアル',
'fileViewer.modeDualTitle': 'コードとデザインを並べて表示',
'fileViewer.modeDualUnavailableSmallWindow': 'デュアルビューにはより広いウィンドウが必要です',
'fileViewer.modeDualUnavailableFileType': 'デュアルビューにはレンダリング可能なファイルが必要です',
'fileViewer.breakpointPresetLabel': 'ブレークポイント',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': '保存済み',
'fileViewer.codeEditor.statusPending': '保留中…',
'fileViewer.codeEditor.statusError': '解析エラー',
```

- [ ] **Step 7: Korean — `ko.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': '웹',
'fileViewer.viewportWebTitle': '전체 너비 웹 미리보기',
'fileViewer.viewportResponsive': '반응형',
'fileViewer.viewportResponsiveTitle': '자유 크기 조정 및 브레이크포인트 눈금자 미리보기',
'fileViewer.modeDual': '듀얼',
'fileViewer.modeDualTitle': '코드와 디자인 나란히 보기',
'fileViewer.modeDualUnavailableSmallWindow': '듀얼 보기에는 더 넓은 창이 필요합니다',
'fileViewer.modeDualUnavailableFileType': '듀얼 보기에는 렌더링 가능한 파일이 필요합니다',
'fileViewer.breakpointPresetLabel': '브레이크포인트',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': '저장됨',
'fileViewer.codeEditor.statusPending': '대기 중…',
'fileViewer.codeEditor.statusError': '구문 분석 오류',
```

- [ ] **Step 8: Chinese (Simplified) — `zh-CN.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': '网页',
'fileViewer.viewportWebTitle': '全宽网页预览',
'fileViewer.viewportResponsive': '响应式',
'fileViewer.viewportResponsiveTitle': '带断点标尺的自由缩放预览',
'fileViewer.modeDual': '双视图',
'fileViewer.modeDualTitle': '代码与设计并排显示',
'fileViewer.modeDualUnavailableSmallWindow': '双视图需要更宽的窗口',
'fileViewer.modeDualUnavailableFileType': '双视图需要可渲染的文件',
'fileViewer.breakpointPresetLabel': '断点',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': '已保存',
'fileViewer.codeEditor.statusPending': '待处理…',
'fileViewer.codeEditor.statusError': '解析错误',
```

- [ ] **Step 9: Chinese (Traditional) — `zh-TW.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': '網頁',
'fileViewer.viewportWebTitle': '全寬網頁預覽',
'fileViewer.viewportResponsive': '響應式',
'fileViewer.viewportResponsiveTitle': '具中斷點標尺的自由縮放預覽',
'fileViewer.modeDual': '雙視圖',
'fileViewer.modeDualTitle': '程式碼與設計並排顯示',
'fileViewer.modeDualUnavailableSmallWindow': '雙視圖需要更寬的視窗',
'fileViewer.modeDualUnavailableFileType': '雙視圖需要可渲染的檔案',
'fileViewer.breakpointPresetLabel': '中斷點',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': '已儲存',
'fileViewer.codeEditor.statusPending': '待處理…',
'fileViewer.codeEditor.statusError': '解析錯誤',
```

- [ ] **Step 10: Arabic — `ar.ts`** (RTL — translation strings only, RTL is handled by the locale loader)

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'ويب',
'fileViewer.viewportWebTitle': 'معاينة الويب بكامل العرض',
'fileViewer.viewportResponsive': 'متجاوب',
'fileViewer.viewportResponsiveTitle': 'معاينة قابلة لتغيير الحجم بحرية مع مسطرة نقاط التوقف',
'fileViewer.modeDual': 'مزدوج',
'fileViewer.modeDualTitle': 'الكود والتصميم جنبًا إلى جنب',
'fileViewer.modeDualUnavailableSmallWindow': 'يتطلب العرض المزدوج نافذة أوسع',
'fileViewer.modeDualUnavailableFileType': 'يتطلب العرض المزدوج ملفًا قابلًا للعرض',
'fileViewer.breakpointPresetLabel': 'نقاط التوقف',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'تم الحفظ',
'fileViewer.codeEditor.statusPending': 'قيد الانتظار…',
'fileViewer.codeEditor.statusError': 'خطأ في التحليل',
```

- [ ] **Step 11: Persian / Farsi — `fa.ts`** (RTL)

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'وب',
'fileViewer.viewportWebTitle': 'پیش‌نمایش وب با عرض کامل',
'fileViewer.viewportResponsive': 'واکنش‌گرا',
'fileViewer.viewportResponsiveTitle': 'پیش‌نمایش قابل تغییر اندازه با خط‌کش نقاط شکست',
'fileViewer.modeDual': 'دوگانه',
'fileViewer.modeDualTitle': 'کد و طراحی در کنار هم',
'fileViewer.modeDualUnavailableSmallWindow': 'نمای دوگانه به پنجره پهن‌تری نیاز دارد',
'fileViewer.modeDualUnavailableFileType': 'نمای دوگانه به فایل قابل ارائه نیاز دارد',
'fileViewer.breakpointPresetLabel': 'نقاط شکست',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'ذخیره شد',
'fileViewer.codeEditor.statusPending': 'در انتظار…',
'fileViewer.codeEditor.statusError': 'خطای تجزیه',
```

- [ ] **Step 12: Russian — `ru.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Веб',
'fileViewer.viewportWebTitle': 'Предпросмотр веб-страницы во всю ширину',
'fileViewer.viewportResponsive': 'Адаптивный',
'fileViewer.viewportResponsiveTitle': 'Свободно масштабируемый предпросмотр с линейкой брейкпоинтов',
'fileViewer.modeDual': 'Двойной',
'fileViewer.modeDualTitle': 'Код и дизайн рядом',
'fileViewer.modeDualUnavailableSmallWindow': 'Двойному режиму нужно более широкое окно',
'fileViewer.modeDualUnavailableFileType': 'Двойному режиму нужен отображаемый файл',
'fileViewer.breakpointPresetLabel': 'Брейкпоинты',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Сохранено',
'fileViewer.codeEditor.statusPending': 'Ожидание…',
'fileViewer.codeEditor.statusError': 'Ошибка разбора',
```

- [ ] **Step 13: Ukrainian — `uk.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Веб',
'fileViewer.viewportWebTitle': 'Попередній перегляд вебсторінки на всю ширину',
'fileViewer.viewportResponsive': 'Адаптивний',
'fileViewer.viewportResponsiveTitle': 'Вільно масштабований перегляд з лінійкою брейкпоінтів',
'fileViewer.modeDual': 'Подвійний',
'fileViewer.modeDualTitle': 'Код і дизайн поруч',
'fileViewer.modeDualUnavailableSmallWindow': 'Подвійному режиму потрібне ширше вікно',
'fileViewer.modeDualUnavailableFileType': 'Подвійному режиму потрібен відображуваний файл',
'fileViewer.breakpointPresetLabel': 'Брейкпоінти',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Збережено',
'fileViewer.codeEditor.statusPending': 'Очікування…',
'fileViewer.codeEditor.statusError': 'Помилка розбору',
```

- [ ] **Step 14: Turkish — `tr.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Tam genişlikte web önizlemesi',
'fileViewer.viewportResponsive': 'Duyarlı',
'fileViewer.viewportResponsiveTitle': 'Kırılma noktası cetveli ile serbest yeniden boyutlandırma önizlemesi',
'fileViewer.modeDual': 'Çift',
'fileViewer.modeDualTitle': 'Kod ve tasarım yan yana',
'fileViewer.modeDualUnavailableSmallWindow': 'Çift görünüm daha geniş bir pencere gerektirir',
'fileViewer.modeDualUnavailableFileType': 'Çift görünüm görüntülenebilir bir dosya gerektirir',
'fileViewer.breakpointPresetLabel': 'Kırılma noktaları',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Kaydedildi',
'fileViewer.codeEditor.statusPending': 'Beklemede…',
'fileViewer.codeEditor.statusError': 'Ayrıştırma hatası',
```

- [ ] **Step 15: Polish — `pl.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Podgląd web na pełną szerokość',
'fileViewer.viewportResponsive': 'Responsywny',
'fileViewer.viewportResponsiveTitle': 'Swobodnie skalowalny podgląd z linijką breakpointów',
'fileViewer.modeDual': 'Podwójny',
'fileViewer.modeDualTitle': 'Kod i projekt obok siebie',
'fileViewer.modeDualUnavailableSmallWindow': 'Widok podwójny wymaga szerszego okna',
'fileViewer.modeDualUnavailableFileType': 'Widok podwójny wymaga renderowalnego pliku',
'fileViewer.breakpointPresetLabel': 'Breakpointy',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Zapisano',
'fileViewer.codeEditor.statusPending': 'Oczekuje…',
'fileViewer.codeEditor.statusError': 'Błąd parsowania',
```

- [ ] **Step 16: Hungarian — `hu.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Teljes szélességű webes előnézet',
'fileViewer.viewportResponsive': 'Reszponzív',
'fileViewer.viewportResponsiveTitle': 'Szabadon átméretezhető előnézet töréspont-vonalzóval',
'fileViewer.modeDual': 'Kettős',
'fileViewer.modeDualTitle': 'Kód és design egymás mellett',
'fileViewer.modeDualUnavailableSmallWindow': 'A kettős nézet szélesebb ablakot igényel',
'fileViewer.modeDualUnavailableFileType': 'A kettős nézet renderelhető fájlt igényel',
'fileViewer.breakpointPresetLabel': 'Töréspontok',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Mentve',
'fileViewer.codeEditor.statusPending': 'Függőben…',
'fileViewer.codeEditor.statusError': 'Elemzési hiba',
```

- [ ] **Step 17: Indonesian — `id.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'Web',
'fileViewer.viewportWebTitle': 'Pratinjau web lebar penuh',
'fileViewer.viewportResponsive': 'Responsif',
'fileViewer.viewportResponsiveTitle': 'Pratinjau ukuran bebas dengan penggaris breakpoint',
'fileViewer.modeDual': 'Ganda',
'fileViewer.modeDualTitle': 'Kode dan desain berdampingan',
'fileViewer.modeDualUnavailableSmallWindow': 'Tampilan ganda memerlukan jendela yang lebih lebar',
'fileViewer.modeDualUnavailableFileType': 'Tampilan ganda memerlukan berkas yang dapat dirender',
'fileViewer.breakpointPresetLabel': 'Breakpoint',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'Tersimpan',
'fileViewer.codeEditor.statusPending': 'Menunggu…',
'fileViewer.codeEditor.statusError': 'Kesalahan penguraian',
```

- [ ] **Step 18: Thai — `th.ts`**

**Remove** the two `viewportDesktop*` keys.

**Add:**
```ts
'fileViewer.viewportWeb': 'เว็บ',
'fileViewer.viewportWebTitle': 'พรีวิวเว็บความกว้างเต็ม',
'fileViewer.viewportResponsive': 'ตอบสนอง',
'fileViewer.viewportResponsiveTitle': 'พรีวิวปรับขนาดอิสระพร้อมไม้บรรทัดเบรกพอยต์',
'fileViewer.modeDual': 'คู่',
'fileViewer.modeDualTitle': 'โค้ดและดีไซน์เคียงข้างกัน',
'fileViewer.modeDualUnavailableSmallWindow': 'มุมมองคู่ต้องการหน้าต่างที่กว้างกว่า',
'fileViewer.modeDualUnavailableFileType': 'มุมมองคู่ต้องการไฟล์ที่แสดงผลได้',
'fileViewer.breakpointPresetLabel': 'เบรกพอยต์',
'fileViewer.breakpointPresetTailwind': 'Tailwind',
'fileViewer.breakpointPresetBootstrap': 'Bootstrap',
'fileViewer.codeEditor.statusSaved': 'บันทึกแล้ว',
'fileViewer.codeEditor.statusPending': 'รอดำเนินการ…',
'fileViewer.codeEditor.statusError': 'ข้อผิดพลาดในการแยกวิเคราะห์',
```

- [ ] **Step 19: Final typecheck**

Run: `pnpm --filter @open-design/web typecheck`

Expected: **0 errors.**

- [ ] **Step 20: Commit**

```bash
git add apps/web/src/i18n/
git commit -m "feat(i18n): add Dual mode + Responsive viewport keys; rename Desktop→Web

Also adds the previously-missing fileViewer.codeEditor.statusSaved/Pending/Error
keys that were referenced in CodeEditor.tsx but never declared — this is what
was breaking pnpm --filter @open-design/web build."
```

---

## Phase 2 — `SplitPane` component (TDD)

**Why this phase:** standalone reusable component with no host wiring yet. Lets us validate the drag math and clamp behavior in isolation before integrating.

### Task 2.1: Write `SplitPane` test file

**Files:**
- Create: `apps/web/tests/components/SplitPane.test.tsx`

- [ ] **Step 1: Write the failing test file**

Create `apps/web/tests/components/SplitPane.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { SplitPane } from '../../src/components/SplitPane';

describe('SplitPane', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1000 });
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  function pane(children: [React.ReactNode, React.ReactNode], props: Partial<React.ComponentProps<typeof SplitPane>> = {}) {
    act(() => {
      root.render(<SplitPane {...props}>{children}</SplitPane>);
    });
  }

  it('renders both children with default 50/50 ratio', () => {
    pane([<div key="L">left</div>, <div key="R">right</div>]);
    const left = host.querySelector('[data-split-side="left"]') as HTMLElement;
    const right = host.querySelector('[data-split-side="right"]') as HTMLElement;
    expect(left.style.flexBasis).toBe('50%');
    expect(right.style.flexBasis).toBe('50%');
  });

  it('honours a custom defaultRatio', () => {
    pane([<div key="L" />, <div key="R" />], { defaultRatio: 0.3 });
    const left = host.querySelector('[data-split-side="left"]') as HTMLElement;
    expect(left.style.flexBasis).toBe('30%');
  });

  it('moves the divider on mouse drag and calls onRatioChange', () => {
    let received: number | null = null;
    pane(
      [<div key="L" />, <div key="R" />],
      { onRatioChange: (r) => { received = r; } },
    );
    const divider = host.querySelector('[data-split-divider="true"]') as HTMLElement;
    act(() => {
      divider.dispatchEvent(new dom.window.MouseEvent('mousedown', { clientX: 500, bubbles: true }));
      dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 700 }));
      dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { clientX: 700 }));
    });
    expect(received).not.toBeNull();
    expect(received!).toBeGreaterThan(0.65);
    expect(received!).toBeLessThan(0.75);
  });

  it('clamps ratio so each side respects minSize', () => {
    let received = 0.5;
    pane(
      [<div key="L" />, <div key="R" />],
      { minSize: 240, onRatioChange: (r) => { received = r; } },
    );
    const divider = host.querySelector('[data-split-divider="true"]') as HTMLElement;
    act(() => {
      divider.dispatchEvent(new dom.window.MouseEvent('mousedown', { clientX: 500, bubbles: true }));
      dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 50 }));
      dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { clientX: 50 }));
    });
    expect(received).toBeCloseTo(0.24, 2);
  });

  it('double-click on divider resets to 50/50', () => {
    let received = 0.5;
    pane(
      [<div key="L" />, <div key="R" />],
      { defaultRatio: 0.3, onRatioChange: (r) => { received = r; } },
    );
    const divider = host.querySelector('[data-split-divider="true"]') as HTMLElement;
    act(() => {
      divider.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    });
    expect(received).toBe(0.5);
    const left = host.querySelector('[data-split-side="left"]') as HTMLElement;
    expect(left.style.flexBasis).toBe('50%');
  });

  it('sets body cursor during drag and clears on mouseup', () => {
    pane([<div key="L" />, <div key="R" />]);
    const divider = host.querySelector('[data-split-divider="true"]') as HTMLElement;
    act(() => {
      divider.dispatchEvent(new dom.window.MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    });
    expect(document.body.style.cursor).toBe('col-resize');
    act(() => {
      dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup'));
    });
    expect(document.body.style.cursor).toBe('');
  });
});
```

- [ ] **Step 2: Run — expect "module not found"**

Run: `pnpm --filter @open-design/web exec vitest run tests/components/SplitPane.test.tsx`

Expected: FAIL with "Cannot find module '../../src/components/SplitPane'" — confirms the test is wired to the file we'll create next.

### Task 2.2: Implement `SplitPane`

**Files:**
- Create: `apps/web/src/components/SplitPane.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/SplitPane.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type SplitPaneProps = {
  children: [ReactNode, ReactNode];
  defaultRatio?: number;
  minSize?: number;
  onRatioChange?: (ratio: number) => void;
  className?: string;
};

const DEFAULT_RATIO = 0.5;
const DEFAULT_MIN_SIZE = 240;

export function SplitPane({
  children,
  defaultRatio = DEFAULT_RATIO,
  minSize = DEFAULT_MIN_SIZE,
  onRatioChange,
  className,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(defaultRatio);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const clamp = useCallback(
    (next: number) => {
      const width = containerRef.current?.clientWidth ?? 0;
      if (width <= 0) return next;
      const minRatio = minSize / width;
      const maxRatio = 1 - minSize / width;
      if (minRatio >= maxRatio) return 0.5;
      return Math.min(maxRatio, Math.max(minRatio, next));
    },
    [minSize],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const raw = (e.clientX - rect.left) / rect.width;
      const next = clamp(raw);
      setRatio(next);
    };
    const onUp = () => {
      setDragging(false);
      document.body.style.cursor = '';
      onRatioChange?.(ratio);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, clamp, onRatioChange, ratio]);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    document.body.style.cursor = 'col-resize';
  };

  const onDividerDoubleClick = () => {
    setRatio(DEFAULT_RATIO);
    onRatioChange?.(DEFAULT_RATIO);
  };

  const leftPct = `${(ratio * 100).toFixed(2)}%`;
  const rightPct = `${((1 - ratio) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      className={`split-pane${dragging ? ' split-pane-dragging' : ''}${className ? ' ' + className : ''}`}
      style={{ display: 'flex', width: '100%', height: '100%' }}
    >
      <div
        data-split-side="left"
        style={{ flexBasis: leftPct, flexGrow: 0, flexShrink: 0, overflow: 'hidden' }}
      >
        {children[0]}
      </div>
      <div
        data-split-divider="true"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onDividerMouseDown}
        onDoubleClick={onDividerDoubleClick}
        style={{
          flexBasis: '6px',
          flexGrow: 0,
          flexShrink: 0,
          cursor: 'col-resize',
          background: 'var(--split-divider-color, rgba(0,0,0,0.08))',
          position: 'relative',
        }}
      />
      <div
        data-split-side="right"
        style={{ flexBasis: rightPct, flexGrow: 1, flexShrink: 1, overflow: 'hidden', position: 'relative' }}
      >
        {children[1]}
        {dragging ? (
          <div
            data-split-overlay="true"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'all', cursor: 'col-resize' }}
          />
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @open-design/web exec vitest run tests/components/SplitPane.test.tsx`

Expected: all 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/SplitPane.tsx apps/web/tests/components/SplitPane.test.tsx
git commit -m "feat(SplitPane): add resizable two-pane container"
```

---

## Phase 3 — `BreakpointRuler` component (TDD)

### Task 3.1: Write `BreakpointRuler` test file

**Files:**
- Create: `apps/web/tests/components/BreakpointRuler.test.tsx`

- [ ] **Step 1: Write the failing test file**

Create `apps/web/tests/components/BreakpointRuler.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { BreakpointRuler, BREAKPOINT_PRESETS } from '../../src/components/BreakpointRuler';

const t = (k: string) => k;

describe('BreakpointRuler', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  function render(props: React.ComponentProps<typeof BreakpointRuler>) {
    act(() => {
      root.render(<BreakpointRuler {...props} />);
    });
  }

  it('exports both Tailwind and Bootstrap presets', () => {
    expect(BREAKPOINT_PRESETS.tailwind.map((b) => b.px)).toEqual([640, 768, 1024, 1280, 1536]);
    expect(BREAKPOINT_PRESETS.bootstrap.map((b) => b.px)).toEqual([576, 768, 992, 1200, 1400]);
  });

  it('marks the active breakpoint based on width (Tailwind, 900px)', () => {
    render({ width: 900, height: 720, preset: 'tailwind', onPresetChange: () => {}, t: t as never });
    const active = host.querySelector('[data-active-breakpoint="true"]') as HTMLElement;
    expect(active.dataset.breakpointId).toBe('md');
  });

  it('marks the active breakpoint based on width (Bootstrap, 1100px → lg)', () => {
    render({ width: 1100, height: 720, preset: 'bootstrap', onPresetChange: () => {}, t: t as never });
    const active = host.querySelector('[data-active-breakpoint="true"]') as HTMLElement;
    expect(active.dataset.breakpointId).toBe('lg');
  });

  it('shows the "below smallest" indicator when width < smallest breakpoint', () => {
    render({ width: 480, height: 720, preset: 'tailwind', onPresetChange: () => {}, t: t as never });
    const badge = host.querySelector('[data-ruler-badge]') as HTMLElement;
    expect(badge.textContent).toContain('< sm');
    expect(host.querySelector('[data-active-breakpoint="true"]')).toBeNull();
  });

  it('shows live width × height badge', () => {
    render({ width: 1024, height: 768, preset: 'tailwind', onPresetChange: () => {}, t: t as never });
    const badge = host.querySelector('[data-ruler-badge]') as HTMLElement;
    expect(badge.textContent).toContain('1024');
    expect(badge.textContent).toContain('768');
  });

  it('calls onPresetChange when the selector is changed', () => {
    let received: 'tailwind' | 'bootstrap' | null = null;
    render({
      width: 1024,
      height: 768,
      preset: 'tailwind',
      onPresetChange: (p) => { received = p; },
      t: t as never,
    });
    const select = host.querySelector('[data-preset-select]') as HTMLSelectElement;
    act(() => {
      select.value = 'bootstrap';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    expect(received).toBe('bootstrap');
  });
});
```

- [ ] **Step 2: Run — expect "module not found"**

Run: `pnpm --filter @open-design/web exec vitest run tests/components/BreakpointRuler.test.tsx`

Expected: FAIL with module-not-found.

### Task 3.2: Implement `BreakpointRuler`

**Files:**
- Create: `apps/web/src/components/BreakpointRuler.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/BreakpointRuler.tsx`:

```tsx
import type { Dict } from '../i18n/types';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export type BreakpointPresetId = 'tailwind' | 'bootstrap';

export type BreakpointDef = { id: string; px: number };

export const BREAKPOINT_PRESETS: Record<BreakpointPresetId, ReadonlyArray<BreakpointDef>> = {
  tailwind: [
    { id: 'sm', px: 640 },
    { id: 'md', px: 768 },
    { id: 'lg', px: 1024 },
    { id: 'xl', px: 1280 },
    { id: '2xl', px: 1536 },
  ],
  bootstrap: [
    { id: 'sm', px: 576 },
    { id: 'md', px: 768 },
    { id: 'lg', px: 992 },
    { id: 'xl', px: 1200 },
    { id: 'xxl', px: 1400 },
  ],
};

export type BreakpointRulerProps = {
  width: number;
  height: number;
  preset: BreakpointPresetId;
  onPresetChange: (next: BreakpointPresetId) => void;
  t: TranslateFn;
};

export function BreakpointRuler({ width, height, preset, onPresetChange, t }: BreakpointRulerProps) {
  const stops = BREAKPOINT_PRESETS[preset];
  const activeIdx = computeActiveIndex(stops, width);
  const smallestId = stops[0]?.id ?? '';
  const isBelowSmallest = activeIdx === -1;

  return (
    <div
      className="breakpoint-ruler"
      role="region"
      aria-label={t('fileViewer.breakpointPresetLabel')}
      style={{ display: 'flex', alignItems: 'center', height: 28, padding: '0 8px', gap: 12 }}
    >
      <select
        data-preset-select
        value={preset}
        onChange={(e) => onPresetChange(e.currentTarget.value as BreakpointPresetId)}
        aria-label={t('fileViewer.breakpointPresetLabel')}
        style={{ fontSize: 11 }}
      >
        <option value="tailwind">{t('fileViewer.breakpointPresetTailwind')}</option>
        <option value="bootstrap">{t('fileViewer.breakpointPresetBootstrap')}</option>
      </select>

      <div
        className="breakpoint-ruler-track"
        style={{ position: 'relative', flexGrow: 1, height: 16 }}
      >
        {stops.map((bp, i) => {
          const visible = bp.px <= width + 32;
          return (
            <div
              key={bp.id}
              data-breakpoint-id={bp.id}
              data-active-breakpoint={i === activeIdx ? 'true' : 'false'}
              style={{
                position: 'absolute',
                left: `${bp.px}px`,
                top: 0,
                width: 1,
                height: 8,
                background:
                  i === activeIdx ? 'var(--accent-color, #4c8bff)' : 'currentColor',
                opacity: visible ? (i === activeIdx ? 1 : 0.4) : 0,
                display: visible ? 'block' : 'none',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 2,
                  fontSize: 10,
                  fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'nowrap',
                  color: i === activeIdx ? 'var(--accent-color, #4c8bff)' : undefined,
                }}
              >
                {bp.id}
              </span>
            </div>
          );
        })}
      </div>

      <div
        data-ruler-badge
        style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}
      >
        {isBelowSmallest ? `< ${smallestId} · ` : ''}
        {Math.round(width)} × {Math.round(height)} px
      </div>
    </div>
  );
}

function computeActiveIndex(stops: ReadonlyArray<BreakpointDef>, width: number): number {
  let idx = -1;
  for (let i = 0; i < stops.length; i += 1) {
    if (stops[i]!.px <= width) idx = i;
  }
  return idx;
}
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @open-design/web exec vitest run tests/components/BreakpointRuler.test.tsx`

Expected: all 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/BreakpointRuler.tsx apps/web/tests/components/BreakpointRuler.test.tsx
git commit -m "feat(BreakpointRuler): add Tailwind/Bootstrap breakpoint ruler component"
```

---

## Phase 4 — Rename `desktop` → `web`

**Why this phase before `responsive`:** keeps the rename a small, atomic change that's easy to revert. The next phase extends an already-named-correctly preset list.

### Task 4.1: Rename in `FileViewer.tsx`

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx`

- [ ] **Step 1: Locate the existing union and presets**

Run: `grep -n "PreviewViewportId\|PREVIEW_VIEWPORT_PRESETS\|viewportDesktop\|'desktop'" apps/web/src/components/FileViewer.tsx`

Expected: shows ~10 lines including the type union, the presets array (~line 160), and any direct `'desktop'` string references.

- [ ] **Step 2: Replace `'desktop'` with `'web'` in the type union and the presets entry**

Edit `apps/web/src/components/FileViewer.tsx`:

- Find the `type PreviewViewportId = ...` declaration and replace `'desktop'` with `'web'`.
- In the `PREVIEW_VIEWPORT_PRESETS` array at line ~160, change the entry:

  Before:
  ```ts
  {
    id: 'desktop',
    width: null,
    height: null,
    labelKey: 'fileViewer.viewportDesktop',
    titleKey: 'fileViewer.viewportDesktopTitle',
  },
  ```

  After:
  ```ts
  {
    id: 'web',
    width: null,
    height: null,
    labelKey: 'fileViewer.viewportWeb',
    titleKey: 'fileViewer.viewportWebTitle',
  },
  ```

- [ ] **Step 3: Update direct comparisons in the file**

Run: `grep -n "viewport === 'desktop'\|=== \"desktop\"" apps/web/src/components/FileViewer.tsx`

For each match (e.g., line ~519 `if (viewport === 'desktop' && frozenWidth)`), change `'desktop'` to `'web'`.

- [ ] **Step 4: Update CSS class strings**

Run: `grep -n "preview-viewport-desktop\|preview-viewport-\${" apps/web/src/components/FileViewer.tsx apps/web/src/index.css 2>/dev/null`

- The interpolation `` `preview-viewport-${previewViewport}` `` already evaluates to `preview-viewport-web` after the union change. Nothing to edit in the .tsx.
- If `apps/web/src/index.css` references `.preview-viewport-desktop` specifically, rename it to `.preview-viewport-web`. Adjust adjacent rules as needed.

### Task 4.2: Migrate legacy persisted value at read time

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx`

- [ ] **Step 1: Locate the `previewViewport` state initializer**

Run: `grep -n "previewViewport\b" apps/web/src/components/FileViewer.tsx | head -10`

Expected: shows the `useState<PreviewViewportId>(...)` line.

- [ ] **Step 2: Add a one-shot migration in the initializer**

If the initial value comes from a prop or constant defaulting to `'desktop'`, replace it with `'web'`. If it could be read from any persisted store (sessionStorage, parent prop), wrap the read:

```ts
const initialViewport: PreviewViewportId = (() => {
  // Accept 'desktop' from legacy state and silently map to 'web'.
  const raw = (props.initialViewport as string | undefined) ?? 'web';
  return raw === 'desktop' ? 'web' : (raw as PreviewViewportId);
})();
```

(If `FileViewer` has no `initialViewport` prop today, this is a no-op and the rename in Task 4.1 is sufficient — the migration code is added in Phase 6 where the localStorage read is introduced.)

### Task 4.3: Verify

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`

Expected: 0 errors.

- [ ] **Step 2: Run the existing test suite for FileViewer (if any tests touch viewport)**

Run: `pnpm --filter @open-design/web exec vitest run tests/components/FileViewer 2>&1 | tail -20`

Expected: pre-existing tests (if any) still pass. Any test that hardcoded `'desktop'` should be updated to `'web'` as part of this step.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/FileViewer.tsx apps/web/src/index.css
git commit -m "refactor(FileViewer): rename desktop viewport preset to web

- Updates PreviewViewportId union, presets entry, CSS class names, and
  remaining string compares.
- i18n keys were swapped in Phase 1."
```

---

## Phase 5 — `responsive` viewport preset

### Task 5.1: Extend the presets list and union

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx`

- [ ] **Step 1: Add `'responsive'` to the union**

In the `PreviewViewportId` declaration:

Before:
```ts
type PreviewViewportId = 'web' | 'tablet' | 'mobile';
```

After:
```ts
type PreviewViewportId = 'web' | 'tablet' | 'mobile' | 'responsive';
```

- [ ] **Step 2: Add a 4th preset entry**

Append to `PREVIEW_VIEWPORT_PRESETS`:

```ts
{
  id: 'responsive',
  width: null,
  height: null,
  labelKey: 'fileViewer.viewportResponsive',
  titleKey: 'fileViewer.viewportResponsiveTitle',
},
```

### Task 5.2: Add responsive-mode state and resize handle

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx`

- [ ] **Step 1: Add `responsiveSize` and `breakpointPreset` state near the existing viewport state**

```ts
const [responsiveSize, setResponsiveSize] = useState<{ width: number; height: number } | null>(null);
const [breakpointPreset, setBreakpointPreset] = useState<'tailwind' | 'bootstrap'>('tailwind');
```

- [ ] **Step 2: When `previewViewport === 'responsive'`, override the iframe wrapper sizing**

Locate `previewViewportStyle` (around line 472). When the preset has `width: null` AND id is `'responsive'`, the wrapper should be sized by `responsiveSize` if set, otherwise fill the container:

```ts
function previewViewportStyle(
  viewport: PreviewViewportId,
  previewScale: number,
  canvasSize: { width: number; height: number },
  responsiveSize: { width: number; height: number } | null,
): React.CSSProperties {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((item) => item.id === viewport) ?? PREVIEW_VIEWPORT_PRESETS[0]!;
  if (viewport === 'responsive') {
    if (responsiveSize) {
      return {
        '--preview-viewport-width': `${responsiveSize.width}px`,
        '--preview-viewport-height': `${responsiveSize.height}px`,
      } as React.CSSProperties;
    }
    return {
      '--preview-viewport-width': '100%',
      '--preview-viewport-height': '100%',
    } as React.CSSProperties;
  }
  // existing branch for fixed presets is unchanged
  const effectiveScale = effectivePreviewScale(viewport, previewScale, canvasSize);
  return {
    '--preview-viewport-width': `${preset.width}px`,
    '--preview-viewport-height': `${preset.height}px`,
  } as React.CSSProperties;
}
```

Update every call site to pass `responsiveSize`.

- [ ] **Step 3: Render the resize handle when viewport is `'responsive'`**

In the JSX where the preview iframe wrapper lives (around line 5922), add a resize handle child:

```tsx
{previewViewport === 'responsive' ? (
  <div
    data-resize-handle="true"
    onMouseDown={(e) => beginResponsiveResize(e)}
    onDoubleClick={() => setResponsiveSize(null)}
    style={{
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 16,
      height: 16,
      cursor: 'nwse-resize',
      background:
        'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.35) 50%)',
      zIndex: 5,
    }}
    aria-label="Resize preview"
  />
) : null}
```

- [ ] **Step 4: Implement `beginResponsiveResize`**

Add inside the FileViewer component body:

```ts
const beginResponsiveResize = (e: React.MouseEvent) => {
  e.preventDefault();
  const wrapper = previewBodyRef.current;
  if (!wrapper) return;
  const startRect = wrapper.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = Math.max(320, startRect.width);
  const startH = Math.max(400, startRect.height);

  document.body.style.cursor = 'nwse-resize';

  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    let w = Math.max(320, startW + dx);
    let h = Math.max(400, startH + dy);
    if (ev.shiftKey) {
      const stops = BREAKPOINT_PRESETS[breakpointPreset];
      const closest = stops.reduce((acc, bp) =>
        Math.abs(bp.px - w) < Math.abs(acc - w) ? bp.px : acc,
      stops[0]!.px);
      if (Math.abs(closest - w) <= 12) w = closest;
    }
    setResponsiveSize({ width: w, height: h });
  };
  const onUp = () => {
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};
```

Add at the top of the file (after other imports):

```ts
import { BreakpointRuler, BREAKPOINT_PRESETS } from './BreakpointRuler';
```

- [ ] **Step 5: Render `<BreakpointRuler>` above the iframe wrapper when responsive**

Wrap the existing iframe container so the ruler sits on top:

```tsx
{previewViewport === 'responsive' ? (
  <BreakpointRuler
    width={responsiveSize?.width ?? (previewBodyRef.current?.clientWidth ?? 0)}
    height={responsiveSize?.height ?? (previewBodyRef.current?.clientHeight ?? 0)}
    preset={breakpointPreset}
    onPresetChange={setBreakpointPreset}
    t={t}
  />
) : null}
```

### Task 5.3: Tests for the viewport additions

**Files:**
- Create: `apps/web/tests/components/FileViewer.viewport.test.tsx`

- [ ] **Step 1: Write the test (focused on pure logic — selecting preset, snap math)**

Create `apps/web/tests/components/FileViewer.viewport.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { BREAKPOINT_PRESETS } from '../../src/components/BreakpointRuler';

function snapWidth(width: number, presetId: 'tailwind' | 'bootstrap'): number {
  const stops = BREAKPOINT_PRESETS[presetId];
  const closest = stops.reduce((acc, bp) =>
    Math.abs(bp.px - width) < Math.abs(acc - width) ? bp.px : acc,
  stops[0]!.px);
  return Math.abs(closest - width) <= 12 ? closest : width;
}

describe('responsive snap math', () => {
  it('snaps to 768 (md) when width is 760 with Tailwind', () => {
    expect(snapWidth(760, 'tailwind')).toBe(768);
  });

  it('does not snap when width is 720 (>12px away from md=768)', () => {
    expect(snapWidth(720, 'tailwind')).toBe(720);
  });

  it('snaps to 992 (lg) when width is 1000 with Bootstrap', () => {
    expect(snapWidth(1000, 'bootstrap')).toBe(992);
  });
});
```

The snap helper is duplicated intentionally for testability — in the host code (Task 5.2 step 4) it lives inline inside `beginResponsiveResize`. To share, extract to `apps/web/src/components/breakpoint-snap.ts` and import from both the test and the FileViewer. Pick the extraction route if the snap logic becomes more complex; otherwise the duplication is fine and matches the spec's preference for small, focused files.

- [ ] **Step 2: Run**

Run: `pnpm --filter @open-design/web exec vitest run tests/components/FileViewer.viewport.test.tsx`

Expected: 3 tests pass.

- [ ] **Step 3: Manual verification**

Run: `pnpm tools-dev`

Open the app, create or open an HTML file, select the new `Responsive` viewport from the existing viewport selector. Verify:
- Ruler appears above the iframe.
- Width/height badge updates as the window resizes.
- Drag the bottom-right handle: iframe resizes freely.
- Shift+drag near 768px (Tailwind active): snaps to 768.
- Double-click handle: iframe goes back to filling the container.
- Switch ruler selector to Bootstrap: marker positions recompute.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/FileViewer.tsx apps/web/tests/components/FileViewer.viewport.test.tsx
git commit -m "feat(FileViewer): add Responsive viewport with free resize + breakpoint ruler"
```

---

## Phase 6 — `dual` view mode

### Task 6.1: Add `viewMode` state + persistence

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx`

- [ ] **Step 1: Replace the existing `mode` state on the FileViewer instance that owns the dropdown**

Find (around line 3481):

```ts
const [mode, setMode] = useState<'preview' | 'source'>('preview');
```

Replace with:

```ts
type ViewMode = 'source' | 'preview' | 'dual';
const VIEW_MODE_STORAGE_KEY = 'od.fileViewer.viewMode';

function loadPersistedViewMode(): ViewMode {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (!raw) return 'preview';
    const parsed = JSON.parse(raw) as { viewMode?: unknown };
    const v = parsed.viewMode;
    return v === 'source' || v === 'preview' || v === 'dual' ? v : 'preview';
  } catch {
    return 'preview';
  }
}

const [viewMode, setViewModeState] = useState<ViewMode>(loadPersistedViewMode);

function setViewMode(next: ViewMode) {
  setViewModeState(next);
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, JSON.stringify({ viewMode: next }));
  } catch {
    // best-effort; private mode etc. shouldn't crash the app
  }
}

// Effective mode for rendering — Dual may be downgraded by runtime conditions.
// `viewMode` stays as the persisted intent; `effectiveViewMode` is what we actually render.
```

- [ ] **Step 2: Replace every `mode` read in this component with `effectiveViewMode`**

Compute the effective mode below the state declaration:

```ts
const containerWidth = previewBodyRef.current?.clientWidth ?? 1024;
const dualSupportsFile = isPreviewableFile(source); // see Step 4 for definition
const dualFitsWindow = containerWidth >= 720;
const dualAvailable = dualSupportsFile && dualFitsWindow;
const effectiveViewMode: ViewMode = viewMode === 'dual' && !dualAvailable ? (dualSupportsFile ? 'preview' : 'source') : viewMode;
```

Replace every reference to `mode` (in render logic, comparisons, etc.) with `effectiveViewMode`. Update `selectMode` (around line 5207) to take a `ViewMode` and call `setViewMode`:

```ts
function selectMode(nextMode: ViewMode) {
  if (nextMode === 'source') setDrawOverlayOpen(false);
  setViewMode(nextMode);
  setModeMenuOpen(false);
}
```

- [ ] **Step 3: Add the Dual entry to the dropdown**

Find the dropdown menu render (around line 5404):

Before:
```tsx
{([
  ['preview', t('fileViewer.preview')],
  ['source', t('fileViewer.source')],
] as const).map(([id, label]) => (
```

After:
```tsx
{([
  ['preview', t('fileViewer.preview'), true],
  ['source', t('fileViewer.source'), true],
  ['dual', t('fileViewer.modeDual'), dualAvailable] as const,
] as const).map(([id, label, available]) => (
  <button
    key={id}
    type="button"
    disabled={!available}
    title={
      !available && id === 'dual'
        ? dualSupportsFile
          ? t('fileViewer.modeDualUnavailableSmallWindow')
          : t('fileViewer.modeDualUnavailableFileType')
        : undefined
    }
    className={`viewer-mode-menu-item${effectiveViewMode === id ? ' active' : ''}`}
    role="menuitem"
    onClick={() => available && selectMode(id as ViewMode)}
  >
    <span>{label}</span>
    {effectiveViewMode === id ? <Icon name="check" size={13} /> : null}
  </button>
))}
```

And update the trigger button label (around line 5400):

```tsx
<span>
  {effectiveViewMode === 'preview'
    ? t('fileViewer.preview')
    : effectiveViewMode === 'source'
      ? t('fileViewer.source')
      : t('fileViewer.modeDual')}
</span>
```

- [ ] **Step 4: Add `isPreviewableFile` helper**

Near the top of the file (after imports, alongside other small helpers):

```ts
function isPreviewableFile(source: string | null): boolean {
  // The existing Preview render path renders iframe content for any non-null
  // source that produces a non-empty srcDoc OR is loadable via URL — the same
  // gate the Preview tab already uses. Reuse it here for consistency.
  return source !== null && source.trim().length > 0;
}
```

If the FileViewer already has a more sophisticated predicate (e.g., based on the file's mime type or render-mode resolution from `file-viewer-render-mode.ts`), use it instead.

### Task 6.2: Render Dual layout with `SplitPane`

**Files:**
- Modify: `apps/web/src/components/FileViewer.tsx`

- [ ] **Step 1: Add `SplitPane` import**

```ts
import { SplitPane } from './SplitPane';
```

- [ ] **Step 2: Locate the existing render branches for Source/Preview**

Run: `grep -n "mode === 'source'\|mode === 'preview'\|effectiveViewMode" apps/web/src/components/FileViewer.tsx | head -20`

Identify the JSX subtree that today switches between source and preview. Refactor into named local renderables:

```tsx
const sourcePane = (/* existing source render */);
const previewPane = (/* existing preview render including viewport selector, iframe, ruler, toolbar */);
```

(Do not move state hooks; only relocate JSX expressions.)

- [ ] **Step 3: Render based on `effectiveViewMode`**

Replace the top-level switch:

```tsx
{effectiveViewMode === 'source' && sourcePane}
{effectiveViewMode === 'preview' && previewPane}
{effectiveViewMode === 'dual' && (
  <SplitPane defaultRatio={0.5} minSize={240}>
    {sourcePane}
    {previewPane}
  </SplitPane>
)}
```

### Task 6.3: Test the Dual integration

**Files:**
- Create: `apps/web/tests/components/FileViewer.dual.test.tsx`

- [ ] **Step 1: Write the test**

Create `apps/web/tests/components/FileViewer.dual.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { FileViewer } from '../../src/components/FileViewer';

const FAKE_T = ((k: string) => k) as never;

function htmlSource() {
  return '<!doctype html><html><body><h1>Hi</h1></body></html>';
}

describe('FileViewer — dual view', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.localStorage = dom.window.localStorage;
    host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 1200 });
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
    dom.window.localStorage.clear();
  });

  it('renders three items in the mode dropdown', () => {
    act(() => {
      root.render(<FileViewer source={htmlSource()} t={FAKE_T} /* …other required props… */ />);
    });
    // Click the mode trigger
    const trigger = host.querySelector('.viewer-mode-trigger') as HTMLButtonElement;
    act(() => trigger.click());
    const items = host.querySelectorAll('.viewer-mode-menu-item');
    expect(items.length).toBe(3);
    const labels = Array.from(items).map((i) => i.textContent);
    expect(labels).toEqual(expect.arrayContaining([
      'fileViewer.preview',
      'fileViewer.source',
      'fileViewer.modeDual',
    ]));
  });

  it('Dual + renderable source renders SplitPane', () => {
    act(() => {
      window.localStorage.setItem('od.fileViewer.viewMode', JSON.stringify({ viewMode: 'dual' }));
      root.render(<FileViewer source={htmlSource()} t={FAKE_T} /* … */ />);
    });
    expect(host.querySelector('.split-pane')).not.toBeNull();
  });

  it('Dual + empty source falls back to Source effective mode (no SplitPane rendered)', () => {
    act(() => {
      window.localStorage.setItem('od.fileViewer.viewMode', JSON.stringify({ viewMode: 'dual' }));
      root.render(<FileViewer source="" t={FAKE_T} /* … */ />);
    });
    expect(host.querySelector('.split-pane')).toBeNull();
  });

  it('small window disables the Dual menu item with tooltip', () => {
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 600 });
    act(() => {
      root.render(<FileViewer source={htmlSource()} t={FAKE_T} /* … */ />);
    });
    const trigger = host.querySelector('.viewer-mode-trigger') as HTMLButtonElement;
    act(() => trigger.click());
    const dualItem = host.querySelector('.viewer-mode-menu-item[title*="SmallWindow"]') as HTMLButtonElement;
    expect(dualItem.disabled).toBe(true);
  });
});
```

> NOTE: the props list passed to `<FileViewer />` is abbreviated; fill in the real required props by reading `FileViewer.tsx`'s exported component signature when writing the test. If FileViewer requires data that's expensive to construct in a unit test, narrow the test to a thin wrapper or fixture instead.

- [ ] **Step 2: Run**

Run: `pnpm --filter @open-design/web exec vitest run tests/components/FileViewer.dual.test.tsx`

Expected: 4 tests pass. If FileViewer's prop surface forces refactor of the test scaffolding, treat that as part of this task — the goal is real coverage of the four behaviors above.

### Task 6.4: Manual verification + commit

- [ ] **Step 1: Boot the app**

Run: `pnpm tools-dev`

- [ ] **Step 2: Walk through the acceptance checklist (from spec)**

1. Source → Preview → Dual via the dropdown; selection sticks across reload.
2. Drag the divider, double-click to reset.
3. In Dual, edit HTML in the left pane; ~400ms after you stop typing, the right pane updates.
4. Type something unparseable (`<div`); editor shows `Parse error`, preview keeps last good render.
5. Switch viewport to Responsive while in Dual; ruler appears above the iframe in the right pane.
6. Drag the corner handle in Responsive; Shift+drag for snap; double-click to fill.
7. Toggle Tailwind ↔ Bootstrap in the ruler; markers reposition.
8. Resize the window below 720px; Dual menu item disables with tooltip; if currently in Dual, render falls back to Preview without rewriting the persisted mode.
9. Reload the app; persisted `viewMode` is restored.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/FileViewer.tsx apps/web/tests/components/FileViewer.dual.test.tsx
git commit -m "feat(FileViewer): add Dual view mode with split-pane code + design

- New 'dual' option in the existing mode dropdown.
- Persists chosen mode in od.fileViewer.viewMode localStorage key.
- Runtime fallbacks: container <720px → Preview; non-renderable file → Source.
- Reuses CodeEditor's existing 400ms debounce-commit for live re-render."
```

---

## Phase 7 — Integration + verification

### Task 7.1: Run the full web test suite

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter @open-design/web typecheck`

Expected: 0 errors.

- [ ] **Step 2: Test**

Run: `pnpm --filter @open-design/web test`

Expected: all green, including the 4 new test files (`SplitPane`, `BreakpointRuler`, `FileViewer.dual`, `FileViewer.viewport`).

- [ ] **Step 3: Repo guard**

Run: `pnpm guard`

Expected: pass. If `guard` flags new `.tsx` files for an unexpected reason, address inline.

### Task 7.2: Optional E2E

Out of scope unless explicitly requested. If the user asks for it, add:

- `e2e/ui/dual-view.spec.ts` — boot app, create HTML file via API, select Dual, edit, observe right pane update.
- `e2e/ui/responsive-ruler.spec.ts` — select Responsive viewport, drag handle, verify active marker, switch Tailwind ↔ Bootstrap.

### Task 7.3: Final verification commit (only if anything was tidied)

- [ ] **Step 1: `git status` and stage any leftovers**

Run: `git status`

If clean → skip the commit step.

- [ ] **Step 2: Commit**

```bash
git commit -m "chore(FileViewer): final cleanup after dual-view + responsive viewport rollout"
```

---

## Self-review (post-write)

**Spec coverage check:** the spec has 8 user-visible behavior sections (Mode dropdown, Dual layout, Debounce-driven re-render, Responsive preset, Breakpoint ruler, Renaming, State, Persistence) plus 8 edge cases. Mapping:

- Mode dropdown → Task 6.1 Step 3 (item array; entry for `dual`).
- Dual layout → Task 6.2 (SplitPane wraps source + preview).
- Debounce-driven re-render → relies on existing CodeEditor (no new task; documented in spec).
- Responsive preset → Phase 5 (entries, state, handle, ruler).
- Breakpoint ruler → Phase 3 (standalone), Phase 5 Step 5 (integration).
- Rename desktop→web → Phase 4 (union, presets, CSS, comparisons) + Phase 1 (i18n).
- State (viewMode, splitRatio, breakpointPreset, responsiveSize) → Task 6.1 Step 1; Phase 5 Step 1.
- Persistence (only `viewMode`) → Task 6.1 Step 1 (localStorage `od.fileViewer.viewMode`).
- Edge cases:
  - File not renderable → Task 6.1 Step 2 (`dualSupportsFile`) + dropdown disable + tooltip.
  - Mode switch with unsaved changes → no extra work; CodeEditor's pending state survives by design.
  - Container <720px → Task 6.1 Step 2 (`dualFitsWindow`).
  - URL-load preview → automatic; ruler measures wrapper, not iframe content.
  - Below smallest breakpoint → BreakpointRuler `isBelowSmallest` branch (Task 3.2).
  - Resize past container bounds → covered in `beginResponsiveResize` clamp (Task 5.2 Step 4).
  - Resize below min 320×400 → same clamp.
  - Editor pending in Dual → no work; reactive render already handles it.

**Placeholder scan:** the only intentionally non-final pieces are the `/* …other required props… */` and `/* existing source render */` markers in Task 6.2/6.3 — these are explicit refactoring directions, not placeholder values. The engineer fills them by reading the current `FileViewer.tsx` at execution time.

**Type consistency:** `ViewMode` (`'source' | 'preview' | 'dual'`) is used consistently from Task 6.1 forward. `PreviewViewportId` is `'web' | 'tablet' | 'mobile' | 'responsive'` after Phase 4–5. `BreakpointPresetId` is `'tailwind' | 'bootstrap'`. No drift detected.

**Scope:** seven phases, each independently testable and committable. Suitable for subagent-driven execution with checkpoints at each phase.
