import {
  captureFromReact,
  findBookworkCodeFromDom,
  findSelectedAnswerFromDom,
  getAnswerPageRoot,
  getAnswerSnapshotHtml,
  getQuestionContext,
  getQuestionRoot,
  getReadableText,
  getVisibleText,
  sanitizeAnswerHtml
} from "./capture";
import {
  HISTORY_KEY,
  MAX_HISTORY,
  SETTINGS_KEY,
  SUCCESS_PATTERN,
  api,
  csvEscape,
  getDisplayAnswer,
  isLikelyCode,
  normalizeAnswer,
  normalizeQuestionId,
  uniqueAnswers
} from "./shared";
import type { CaptureAnswer, CaptureResult, HistoryEntry, Settings } from "./types";

const PHI_ICON =
  '<svg class="sparx-phi-menu-button__icon" viewBox="0 0 84 96" aria-hidden="true" focusable="false"><path d="M 47.4691 94.8742 V 67.8693 L 47.9534 67.8537 C 52.3122 67.7166 56.6259 66.839 60.8958 65.2189 V 65.2199 C 64.8929 63.6903 68.4645 61.5771 71.6146 58.882 L 72.2396 58.3351 L 72.2454 58.3302 C 75.575 55.4373 78.2558 51.7818 80.2845 47.3546 V 47.3537 C 82.3061 42.928 83.3226 37.9032 83.3226 32.2697 C 83.3226 26.9517 82.5356 22.4635 80.9818 18.7882 L 80.6615 18.0636 L 80.6605 18.0627 C 79.0043 14.4679 76.8897 11.4427 74.3197 8.97964 L 73.7991 8.49429 L 73.7943 8.48941 C 71.3117 6.17323 68.5439 4.39348 65.4896 3.14664 L 64.8743 2.90445 L 64.8724 2.90347 C 61.5635 1.6319 58.291 0.999176 55.0521 0.999176 C 53.2704 0.999176 51.3345 1.22294 49.2425 1.67398 L 48.3363 1.88101 L 48.3333 1.88199 L 47.8841 1.99234 C 45.8085 2.52369 44.0577 3.2689 42.6224 4.22086 L 42.3197 4.42886 H 42.3187 C 40.5189 5.69142 39.0689 7.28919 37.9661 9.22574 H 37.9652 C 36.8915 11.1217 36.3441 13.4147 36.3441 16.1242 V 63.8459 L 35.8304 63.8322 C 29.1364 63.6535 23.7544 61.0487 19.7269 56.0246 L 19.3411 55.5314 V 55.5304 C 15.2859 50.1848 13.2816 43.2011 13.2816 34.6242 C 13.2816 26.5123 14.5431 20.091 17.1136 15.4044 C 19.6172 10.8398 23.2947 7.648 28.1283 5.84195 L 27.3236 1.50894 C 18.4518 3.72283 11.836 7.6445 7.42415 13.2462 H 7.42317 C 2.93466 18.9632 0.677078 26.0783 0.677078 34.6242 C 0.677079 44.2236 3.85313 52.0186 10.1888 58.0539 C 16.5273 64.0918 25.0701 67.3717 35.8665 67.8537 L 36.3441 67.8752 V 94.8742 H 47.4691 Z M 47.4691 13.1447 C 47.4691 10.8408 48.1377 8.9429 49.5091 7.50113 L 49.7923 7.2189 C 51.3473 5.75275 53.2424 5.01976 55.4476 5.01968 C 59.9233 5.01968 63.5868 7.49382 66.4398 12.2628 L 66.4388 12.2638 C 69.3084 17.0377 70.7191 23.5482 70.7191 31.7492 C 70.7191 40.5992 68.9526 47.9197 65.3841 53.6779 L 65.0335 54.2306 C 61.218 60.0959 55.5202 63.2933 48.0042 63.8312 L 47.4691 63.8693 V 13.1447 Z"></path></svg>';

let scanTimer = 0;
let dismissTimer = 0;
let panel: HTMLElement | null = null;
let phiMenu: HTMLElement | null = null;
let phiMenuButton: HTMLButtonElement | null = null;
let activePreviewEntryKey = "";
let lastSavedFingerprint = "";
let pendingCapture: CaptureResult | null = null;
let pendingCaptureAt = 0;

async function getSettings(): Promise<Settings> {
  const result = await api.storage.local.get(SETTINGS_KEY);
  return (result[SETTINGS_KEY] || {}) as Settings;
}

async function getHistory(): Promise<HistoryEntry[]> {
  const result = await api.storage.local.get(HISTORY_KEY);
  return Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
}

async function applySettings() {
  const settings = await getSettings();
  document.documentElement.classList.toggle("sparx-phi-theme", settings.themeEnabled === true);
}

function isCorrectVisible(): boolean {
  return Array.from(document.querySelectorAll("main, section, article, div, span, p, strong, button")).some((element) =>
    SUCCESS_PATTERN.test(getVisibleText(element))
  );
}

function isAnswerReviewVisible(): boolean {
  return Boolean(
    document.querySelector(
      "[class*='AnswerScreen'], [class*='QuestionAnswerOnly'], [class*='AnswerPart'][class*='IsCorrect'], [class*='WACContainer']"
    )
  );
}

function shouldCommitCapture(): boolean {
  return isCorrectVisible() || isAnswerReviewVisible();
}

function answersFromText(value: string): CaptureAnswer[] {
  const answer = normalizeAnswer(value);
  return answer ? [{ id: "dom_1", value: answer, kind: "unknown" }] : [];
}

function buildCapture(options: { includeDomAnswers: boolean } = { includeDomAnswers: false }): CaptureResult {
  const root = getQuestionRoot();
  const reactCapture = captureFromReact();
  const domAnswer = options.includeDomAnswers ? findSelectedAnswerFromDom(root) : "";
  const selectedAnswerHtml = getAnswerSnapshotHtml(root);
  const answerPageHtml = sanitizeAnswerHtml(getAnswerPageRoot());
  const code = reactCapture?.code && isLikelyCode(reactCapture.code) ? reactCapture.code : findBookworkCodeFromDom();
  const answers = uniqueAnswers([...(reactCapture?.answers || []), ...(reactCapture?.answers?.length ? [] : answersFromText(domAnswer))]);
  const selectedAnswer = answers.length > 0 ? answers.map((answer) => answer.value).join("; ") : domAnswer;
  const questionText = reactCapture?.questionText || getReadableText(root).slice(0, 1800);
  const questionId = reactCapture?.questionId || normalizeQuestionId(questionText || getQuestionContext());

  return {
    code,
    questionId,
    questionText,
    answers,
    selectedAnswer,
    selectedAnswerHtml,
    answerPageHtml,
    source: reactCapture?.answers?.length ? "react" : domAnswer ? "dom" : "mixed"
  };
}

function isRicherCapture(next: CaptureResult, current: CaptureResult | null): boolean {
  if (!current) return true;
  if (next.answers.length > current.answers.length) return true;
  if (next.source === "react" && current.source !== "react") return true;
  if (next.selectedAnswer && !current.selectedAnswer) return true;
  if (next.code && !current.code) return true;
  return false;
}

function rememberCurrentCapture() {
  window.setTimeout(() => {
    const next = buildCapture({ includeDomAnswers: false });
    if (!next.selectedAnswer && next.answers.length === 0 && !next.code) return;
    if (isRicherCapture(next, pendingCapture)) {
      pendingCapture = next;
      pendingCaptureAt = Date.now();
    }
  }, 0);
}

function mergeWithPending(current: CaptureResult): CaptureResult {
  if (!pendingCapture || Date.now() - pendingCaptureAt > 90000) return current;
  const sameQuestion = !current.questionId || !pendingCapture.questionId || current.questionId === pendingCapture.questionId;
  if (!sameQuestion && current.answers.length > 0) return current;

  const answers = uniqueAnswers([...(current.answers || []), ...(pendingCapture.answers || [])]);
  return {
    ...current,
    code: current.code || pendingCapture.code,
    questionId: current.questionId || pendingCapture.questionId,
    questionText: current.questionText || pendingCapture.questionText,
    answers,
    selectedAnswer: current.selectedAnswer || pendingCapture.selectedAnswer || answers.map((answer) => answer.value).join("; "),
    selectedAnswerHtml: current.selectedAnswerHtml || pendingCapture.selectedAnswerHtml,
    answerPageHtml: current.answerPageHtml || pendingCapture.answerPageHtml,
    source: current.source === "react" || pendingCapture.source === "react" ? "react" : "mixed"
  };
}

function captureFingerprint(capture: CaptureResult): string {
  return JSON.stringify({
    code: capture.code,
    questionId: capture.questionId,
    answers: capture.answers,
    selectedAnswer: capture.selectedAnswer,
    source: capture.source
  });
}

function historyKey(entry: Partial<HistoryEntry>): string {
  return [entry.code || "", entry.questionId || normalizeQuestionId(entry.questionContext || entry.url || "")].join("\u0001");
}

function shouldReplaceEntry(existing: HistoryEntry | undefined, next: HistoryEntry): boolean {
  if (!existing) return true;
  const existingAnswers = existing.answers?.length || (existing.selectedAnswer ? 1 : 0);
  const nextAnswers = next.answers?.length || (next.selectedAnswer ? 1 : 0);
  if (nextAnswers === 0 && existingAnswers > 0) return false;
  if (next.answerSource === "react" && existing.answerSource !== "react") return true;
  if (nextAnswers > existingAnswers) return true;
  return true;
}

async function saveCapture(capture: CaptureResult) {
  const answer = normalizeAnswer(capture.selectedAnswer || capture.answers.map((item) => item.value).join("; "));
  const entry: HistoryEntry = {
    code: capture.code,
    questionId: capture.questionId,
    questionText: capture.questionText,
    answers: capture.answers,
    answerSource: capture.source,
    selectedAnswer: answer,
    selectedAnswerHtml: String(capture.selectedAnswerHtml || "").slice(0, 120000),
    answerPageHtml: String(capture.answerPageHtml || "").slice(0, 180000),
    pageTitle: document.title || "Sparx Maths",
    url: location.href,
    questionContext: getQuestionContext(),
    detectedAt: new Date().toISOString()
  };

  const history = await getHistory();
  const key = historyKey(entry);
  const existingIndex = history.findIndex((item) => historyKey(item) === key);
  const existing = existingIndex >= 0 ? history[existingIndex] : undefined;
  if (!shouldReplaceEntry(existing, entry)) return;
  if (existingIndex >= 0) history.splice(existingIndex, 1);
  history.unshift({
    ...existing,
    ...entry,
    selectedAnswer: entry.selectedAnswer || existing?.selectedAnswer || "",
    selectedAnswerHtml: entry.selectedAnswerHtml || existing?.selectedAnswerHtml || "",
    answerPageHtml: entry.answerPageHtml || existing?.answerPageHtml || "",
    answers: entry.answers?.length ? entry.answers : existing?.answers || []
  });

  const nextHistory = history.slice(0, MAX_HISTORY);
  await api.storage.local.set({ [HISTORY_KEY]: nextHistory, latestBookworkCode: nextHistory[0] || null });
  renderPhiMenu(nextHistory);
}

async function scan() {
  if (!shouldCommitCapture()) return;

  const current = mergeWithPending(buildCapture({ includeDomAnswers: true }));
  if (!current.code || !isLikelyCode(current.code)) return;
  if (current.answers.length === 0 && !current.selectedAnswer) return;

  const fingerprint = captureFingerprint(current);
  if (fingerprint === lastSavedFingerprint) return;
  lastSavedFingerprint = fingerprint;
  await saveCapture(current);
  showCode(current.code);
}

function scheduleScan() {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, 250);
}

function closePhiExpandedView() {
  if (!phiMenu) return;
  activePreviewEntryKey = "";
  phiMenu.classList.remove("sparx-phi-menu--expanded");
  const code = phiMenu.querySelector(".sparx-phi-menu__preview-code");
  const body = phiMenu.querySelector(".sparx-phi-menu__preview-body");
  if (code) code.textContent = "";
  if (body) body.textContent = "";
}

function getEntryKey(entry: HistoryEntry): string {
  return [entry.code || "", entry.questionId || "", entry.detectedAt || ""].join("\u0001");
}

function fitExpandedPreview() {
  if (!phiMenu?.classList.contains("sparx-phi-menu--expanded")) return;
  const card = phiMenu.querySelector<HTMLElement>(".sparx-phi-menu__preview-card");
  const body = phiMenu.querySelector<HTMLElement>(".sparx-phi-menu__preview-body");
  const content = phiMenu.querySelector<HTMLElement>(".sparx-phi-menu__preview-fit");
  if (!card || !body || !content) return;

  body.style.setProperty("--sparx-phi-preview-scale", "1");
  body.style.removeProperty("--sparx-phi-preview-height");
  window.requestAnimationFrame(() => {
    const availableWidth = Math.max(1, card.clientWidth);
    const availableHeight = Math.max(1, card.clientHeight);
    const contentWidth = Math.max(content.scrollWidth, 1);
    const contentHeight = Math.max(content.scrollHeight, 1);
    const scale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight) * 0.98;
    body.style.setProperty("--sparx-phi-preview-scale", String(scale));
    body.style.setProperty("--sparx-phi-preview-height", `${contentHeight * scale}px`);
  });
}

function openPhiAnswer(entry: HistoryEntry): boolean {
  ensurePhiMenu();
  const previewBody = phiMenu?.querySelector(".sparx-phi-menu__preview-body");
  if (!phiMenu || !phiMenuButton || !previewBody) return false;

  activePreviewEntryKey = getEntryKey(entry);
  const code = phiMenu.querySelector(".sparx-phi-menu__preview-code");
  if (code) code.textContent = entry.code || "";
  previewBody.textContent = "";

  if (entry.answerPageHtml || entry.selectedAnswerHtml) {
    const fit = document.createElement("div");
    fit.className = "sparx-phi-menu__preview-fit";
    fit.innerHTML = entry.answerPageHtml || entry.selectedAnswerHtml;
    previewBody.append(fit);
  } else {
    const fallback = document.createElement("p");
    fallback.className = "sparx-phi-menu__preview-fallback";
    fallback.textContent = getDisplayAnswer(entry) || "No answer captured.";
    previewBody.append(fallback);
  }

  phiMenu.classList.add("sparx-phi-menu--open", "sparx-phi-menu--expanded");
  phiMenuButton.classList.add("sparx-phi-menu-button--open");
  phiMenuButton.setAttribute("aria-expanded", "true");
  fitExpandedPreview();
  return true;
}

function createAnswerPreview(entry: HistoryEntry): HTMLElement {
  const answer = document.createElement("div");
  answer.className = "sparx-phi-menu__answer";
  answer.setAttribute("role", "button");
  answer.setAttribute("tabindex", "0");
  answer.setAttribute("aria-label", `Open answer for ${entry.code || "bookwork code"}`);
  answer.textContent = getDisplayAnswer(entry) || "No answer captured.";
  answer.addEventListener("click", (event) => {
    event.stopPropagation();
    openPhiAnswer(entry);
  });
  answer.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    openPhiAnswer(entry);
  });
  return answer;
}

function createHistoryItem(entry: HistoryEntry, isLatest: boolean): HTMLElement {
  const item = document.createElement("li");
  const code = document.createElement("strong");
  item.className = isLatest ? "sparx-phi-menu__item sparx-phi-menu__item--latest" : "sparx-phi-menu__item";
  code.textContent = entry.code;
  item.append(code, createAnswerPreview(entry));
  item.addEventListener("click", (event) => {
    event.stopPropagation();
    openPhiAnswer(entry);
  });
  return item;
}

function renderPhiMenu(history: HistoryEntry[]) {
  if (!phiMenu) return;
  const list = phiMenu.querySelector(".sparx-phi-menu__history");
  const empty = phiMenu.querySelector<HTMLElement>(".sparx-phi-menu__empty");
  if (!list || !empty) return;
  list.textContent = "";
  empty.hidden = history.length > 0;
  history.forEach((entry, index) => list.append(createHistoryItem(entry, index === 0)));
}

async function refreshPhiMenu() {
  renderPhiMenu(await getHistory());
}

async function exportHistoryCsv() {
  const history = await getHistory();
  const rows = [
    ["code", "question_id", "answers", "answer_source", "detected_at", "question_context", "page_title", "url"].map(csvEscape).join(","),
    ...history.map((entry) =>
      [
        entry.code,
        entry.questionId,
        getDisplayAnswer(entry),
        entry.answerSource,
        entry.detectedAt,
        entry.questionContext,
        entry.pageTitle,
        entry.url
      ]
        .map(csvEscape)
        .join(",")
    )
  ];

  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sparx-bookwork-codes.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function clearHistory() {
  await api.storage.local.remove([HISTORY_KEY, "latestBookworkCode"]);
  closePhiExpandedView();
  await refreshPhiMenu();
}

async function deleteActivePreviewEntry() {
  if (!activePreviewEntryKey) return;
  const history = await getHistory();
  const nextHistory = history.filter((entry) => getEntryKey(entry) !== activePreviewEntryKey);
  await api.storage.local.set({ [HISTORY_KEY]: nextHistory, latestBookworkCode: nextHistory[0] || null });
  closePhiExpandedView();
  renderPhiMenu(nextHistory);
}

async function requestAiHelp() {
  ensurePhiMenu();
  const helpButton = phiMenu?.querySelector<HTMLButtonElement>(".sparx-phi-menu__help");
  const helpStatus = phiMenu?.querySelector<HTMLElement>(".sparx-phi-menu__help-status");
  if (!helpButton || !helpStatus || !phiMenu || !phiMenuButton) return;
  const settings = await getSettings();
  const provider = settings.aiProvider === "chatgpt" || settings.aiProvider === "claude" ? settings.aiProvider : "gauth";
  const providerNames = { chatgpt: "ChatGPT", claude: "Claude", gauth: "Gauth" };

  helpButton.disabled = true;
  helpStatus.textContent = `Sending screenshot to ${providerNames[provider]}...`;
  try {
    phiMenu.classList.add("sparx-phi-menu--capture-hidden");
    phiMenuButton.classList.add("sparx-phi-menu-button--capture-hidden");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const response = await api.runtime.sendMessage({ type: "SPARX_HELP_WITH_QUESTION", provider });
    if (!response?.ok) throw new Error(response?.error || `${providerNames[provider]} handoff failed.`);
    helpStatus.textContent = `Sent to ${providerNames[provider]}.`;
  } catch (error) {
    helpStatus.textContent = error instanceof Error ? error.message : "Could not send screenshot.";
  } finally {
    phiMenu.classList.remove("sparx-phi-menu--capture-hidden");
    phiMenuButton.classList.remove("sparx-phi-menu-button--capture-hidden");
    window.setTimeout(() => {
      helpButton.disabled = false;
      helpStatus.textContent = "";
    }, 2200);
  }
}

function setPhiMenuOpen(isOpen: boolean) {
  ensurePhiMenu();
  if (!phiMenu || !phiMenuButton) return;
  if (!isOpen) closePhiExpandedView();
  phiMenu.classList.toggle("sparx-phi-menu--open", isOpen);
  phiMenuButton.classList.toggle("sparx-phi-menu-button--open", isOpen);
  phiMenuButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) refreshPhiMenu();
}

function ensurePhiMenu(): HTMLElement {
  if (phiMenu) return phiMenu;

  phiMenuButton = document.createElement("button");
  phiMenuButton.id = "sparx-phi-menu-button";
  phiMenuButton.className = "sparx-phi-menu-button";
  phiMenuButton.type = "button";
  phiMenuButton.innerHTML = PHI_ICON;
  phiMenuButton.title = "Open Phi menu";
  phiMenuButton.setAttribute("aria-label", "Open Phi menu");
  phiMenuButton.setAttribute("aria-expanded", "false");
  phiMenuButton.addEventListener("click", () => setPhiMenuOpen(!phiMenu?.classList.contains("sparx-phi-menu--open")));

  phiMenu = document.createElement("aside");
  phiMenu.id = "sparx-phi-menu";
  phiMenu.className = "sparx-phi-menu";
  phiMenu.innerHTML = [
    '<div class="sparx-phi-menu__header">',
    "<strong>Phi Menu</strong>",
    '<div class="sparx-phi-menu__header-actions">',
    '<button class="sparx-phi-menu__help" type="button" title="Send screenshot for AI help">Help</button>',
    '<button class="sparx-phi-menu__close" type="button" title="Close">x</button>',
    "</div>",
    "</div>",
    '<div class="sparx-phi-menu__body">',
    '<p class="sparx-phi-menu__help-status" aria-live="polite"></p>',
    '<details class="sparx-phi-menu__settings">',
    "<summary>Settings</summary>",
    '<label class="sparx-phi-menu__setting-row"><input class="sparx-phi-menu__theme-toggle" type="checkbox"><span>Enable Phi theme (looks ASS right now)</span></label>',
    '<label class="sparx-phi-menu__setting-row"><span>Help target</span><select class="sparx-phi-menu__ai-provider-select"><option value="gauth">Gauth</option><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option></select></label>',
    '<div class="sparx-phi-menu__actions"><button class="sparx-phi-menu__export" type="button">Export CSV</button><button class="sparx-phi-menu__clear" type="button">Clear</button></div>',
    "</details>",
    '<ol class="sparx-phi-menu__history"></ol>',
    '<p class="sparx-phi-menu__empty">No bookwork codes captured yet.</p>',
    "</div>",
    '<section class="sparx-phi-menu__preview">',
    '<button class="sparx-phi-menu__preview-delete" type="button" title="Delete selected item">Delete</button>',
    '<button class="sparx-phi-menu__preview-close" type="button" title="Close">x</button>',
    '<strong class="sparx-phi-menu__preview-code"></strong>',
    '<div class="sparx-phi-menu__preview-card"><div class="sparx-phi-menu__preview-body"></div></div>',
    "</section>"
  ].join("");

  phiMenu.querySelector(".sparx-phi-menu__close")?.addEventListener("click", () => setPhiMenuOpen(false));
  phiMenu.querySelector(".sparx-phi-menu__help")?.addEventListener("click", requestAiHelp);
  phiMenu.querySelector(".sparx-phi-menu__preview-close")?.addEventListener("click", closePhiExpandedView);
  phiMenu.querySelector(".sparx-phi-menu__preview-delete")?.addEventListener("click", deleteActivePreviewEntry);
  phiMenu.querySelector(".sparx-phi-menu__export")?.addEventListener("click", exportHistoryCsv);
  phiMenu.querySelector(".sparx-phi-menu__clear")?.addEventListener("click", clearHistory);
  phiMenu.querySelector<HTMLInputElement>(".sparx-phi-menu__theme-toggle")?.addEventListener("change", async (event) => {
    const target = event.currentTarget as HTMLInputElement;
    const settings = await getSettings();
    await api.storage.local.set({ [SETTINGS_KEY]: { ...settings, themeEnabled: target.checked } });
  });
  phiMenu.querySelector<HTMLSelectElement>(".sparx-phi-menu__ai-provider-select")?.addEventListener("change", async (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    const settings = await getSettings();
    await api.storage.local.set({ [SETTINGS_KEY]: { ...settings, aiProvider: target.value || "gauth" } });
  });

  document.documentElement.append(phiMenuButton, phiMenu);
  applySettings().then(async () => {
    const settings = await getSettings();
    const themeToggle = phiMenu?.querySelector<HTMLInputElement>(".sparx-phi-menu__theme-toggle");
    if (themeToggle) themeToggle.checked = settings.themeEnabled === true;
    const providerSelect = phiMenu?.querySelector<HTMLSelectElement>(".sparx-phi-menu__ai-provider-select");
    if (providerSelect) providerSelect.value = settings.aiProvider === "chatgpt" || settings.aiProvider === "claude" ? settings.aiProvider : "gauth";
  });
  refreshPhiMenu();
  return phiMenu;
}

function ensurePanel(): HTMLElement {
  if (panel) return panel;
  panel = document.createElement("aside");
  panel.id = "sparx-code-detector";
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = [
    '<button class="sparx-code-detector__surface" type="button" title="Open Phi menu">',
    '<span class="sparx-code-detector__mark">',
    PHI_ICON.replace("sparx-phi-menu-button__icon", "sparx-code-detector__icon"),
    "</span>",
    '<span class="sparx-code-detector__body"><div class="sparx-code-detector__code"></div><span class="sparx-code-detector__meta">Bookwork code captured</span></span>',
    "</button>",
    '<div class="sparx-code-detector__progress"></div>'
  ].join("");
  panel.querySelector("button")?.addEventListener("click", () => {
    window.clearTimeout(dismissTimer);
    if (panel) panel.hidden = true;
    setPhiMenuOpen(true);
  });
  document.documentElement.appendChild(panel);
  return panel;
}

function showCode(code: string) {
  const node = ensurePanel();
  window.clearTimeout(dismissTimer);
  node.classList.remove("sparx-code-detector--visible", "sparx-code-detector--dismissing");
  void node.offsetWidth;
  const codeNode = node.querySelector(".sparx-code-detector__code");
  if (codeNode) codeNode.textContent = code;
  node.hidden = false;
  node.classList.add("sparx-code-detector--visible");
  dismissTimer = window.setTimeout(() => {
    node.classList.remove("sparx-code-detector--visible");
    node.classList.add("sparx-code-detector--dismissing");
    window.setTimeout(() => {
      if (!node.classList.contains("sparx-code-detector--dismissing")) return;
      node.hidden = true;
      node.classList.remove("sparx-code-detector--dismissing");
    }, 320);
  }, 3000);
}

const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

api.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SETTINGS_KEY]) applySettings();
  if (areaName === "local" && changes[HISTORY_KEY]) refreshPhiMenu();
});

for (const eventName of ["pointerdown", "keydown", "input", "change"] as const) {
  document.addEventListener(
    eventName,
    () => {
      rememberCurrentCapture();
      scheduleScan();
    },
    true
  );
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setPhiMenuOpen(false);
});

document.addEventListener("click", (event) => {
  if (!phiMenu?.classList.contains("sparx-phi-menu--expanded")) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#sparx-phi-menu") || target.closest("#sparx-phi-menu-button")) return;
  setPhiMenuOpen(false);
});

window.addEventListener("resize", fitExpandedPreview);
applySettings();
ensurePhiMenu();
rememberCurrentCapture();
scheduleScan();
