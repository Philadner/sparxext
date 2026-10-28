import type { CaptureAnswer, CaptureResult } from "./types";
import {
  BOOKWORK_CODE_PATTERN,
  BOOKWORK_PATTERN,
  CODE_PATTERN,
  cleanAnswerText,
  cleanMathText,
  isLikelyCode,
  isUsefulAnswer,
  normalizeAnswer,
  normalizeCode,
  normalizeQuestionId,
  uniqueAnswers
} from "./shared";

type AnyRecord = Record<string, any>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null;
}

export function findInTree(
  tree: unknown,
  filter: (value: any) => boolean,
  options: { walkable?: string[]; ignore?: string[]; maxNodes?: number } = {}
): any {
  const walkable = options.walkable || [];
  const ignore = new Set(options.ignore || []);
  const stack: unknown[] = [tree];
  let remaining = options.maxNodes ?? 500;

  while (stack.length > 0 && remaining > 0) {
    remaining -= 1;
    const node = stack.shift();
    try {
      if (filter(node)) return node;
    } catch {
      // Sparx trees contain varied component values; bad predicates should not stop capture.
    }

    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }

    if (!isRecord(node)) continue;
    for (const key of Object.keys(node)) {
      if (ignore.has(key)) continue;
      if (walkable.length > 0 && !walkable.includes(key)) continue;
      stack.push(node[key]);
    }
  }

  return null;
}

export function findInReactTree(tree: unknown, filter: (value: any) => boolean, maxNodes = 500): any {
  return findInTree(tree, filter, { walkable: ["props", "children"], maxNodes });
}

export function findReactFiber(element: Element | null, traverseUp = 0): any {
  if (!element) return null;
  const key = Object.keys(element).find(
    (item) =>
      item.startsWith("__reactFiber$") ||
      item.startsWith("__reactInternalInstance$") ||
      item.startsWith("__reactContainer$")
  );
  if (!key) return null;

  const fiber = (element as any)[key];
  if (!fiber) return null;
  if (key.startsWith("__reactContainer$")) return fiber;

  if (fiber._currentElement) {
    let computedFiber = fiber._currentElement._owner;
    for (let index = 0; index < traverseUp; index += 1) {
      computedFiber = computedFiber?._currentElement?._owner;
    }
    return computedFiber?._instance || null;
  }

  const getComputedFiber = (input: any) => {
    let parentFiber = input?.return;
    while (parentFiber && typeof parentFiber.type === "string") {
      parentFiber = parentFiber.return;
    }
    return parentFiber;
  };

  let computedFiber = getComputedFiber(fiber);
  for (let index = 0; index < traverseUp; index += 1) {
    computedFiber = getComputedFiber(computedFiber);
  }

  return computedFiber || null;
}

function getContentText(content: any): string {
  if (!content) return "";
  if (typeof content === "string" || typeof content === "number") return cleanAnswerText(content);
  if (Array.isArray(content)) return cleanAnswerText(content.map(getContentText).filter(Boolean).join(" "));
  if (!isRecord(content)) return "";

  if (content.element === "image" && content.src) return String(content.src);
  if (typeof content.text === "string") return cleanMathText(content.text);
  if (typeof content.markup === "string") return cleanMathText(content.markup.replace(/<[^>]+>/g, ""));
  if (content.content) return getContentText(content.content);
  if (content.children) return getContentText(content.children);
  return "";
}

function assetUrl(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  const base = (window as any).__sparxweb?.urls?.contentAssets;
  return base ? `${String(base).replace(/\/$/, "")}/${src.replace(/^\//, "")}` : src;
}

function answerFromContent(id: string, content: any, kind: CaptureAnswer["kind"]): CaptureAnswer | null {
  const first = Array.isArray(content) ? content[0] : content;
  if (isRecord(first) && first.element === "image" && first.src) {
    return { id, value: assetUrl(String(first.src)), kind: "image" };
  }

  const value = normalizeAnswer(getContentText(content));
  return isUsefulAnswer(value) ? { id, value, kind } : null;
}

function processReactAnswers(input: AnyRecord): CaptureAnswer[] {
  const answers: CaptureAnswer[] = [];
  const numberFields = isRecord(input.number_fields) ? input.number_fields : {};
  const cards = isRecord(input.cards) ? input.cards : {};
  const choices = isRecord(input.choices) ? input.choices : {};

  for (const [id, field] of Object.entries(numberFields)) {
    const value = normalizeAnswer((field as AnyRecord)?.value);
    if (isUsefulAnswer(value)) answers.push({ id, value, kind: "number" });
  }

  for (const [id, card] of Object.entries(cards)) {
    const cardRecord = card as AnyRecord;
    if (!cardRecord.slot_ref && !cardRecord.selected && !cardRecord.value) continue;
    const answer = answerFromContent(id, cardRecord.content || cardRecord.value || cardRecord.text, "card");
    if (answer) answers.push(answer);
  }

  for (const [id, choice] of Object.entries(choices)) {
    const choiceRecord = choice as AnyRecord;
    if (!choiceRecord.selected) continue;
    const answer = answerFromContent(id, choiceRecord.content || choiceRecord.value || choiceRecord.text, "choice");
    if (answer) answers.push(answer);
  }

  return uniqueAnswers(answers);
}

function questionIdFromLayout(layout: unknown): string {
  const questionTextNode = findInTree(
    layout,
    (node) => isRecord(node) && typeof node.type === "string" && node.type.includes("question-text"),
    { walkable: ["content"], maxNodes: 300 }
  );
  const textNode = findInTree(
    questionTextNode || layout,
    (node) => isRecord(node) && node.element === "text" && typeof node.text === "string",
    { walkable: ["content"], maxNodes: 300 }
  );
  return cleanAnswerText(textNode?.text || getContentText(questionTextNode || layout));
}

export function captureFromReact(): Partial<CaptureResult> | null {
  const questionWrapper = document.querySelector("[class*='_QuestionWrapper_'], [class*='QuestionWrapper']");
  const questionInfo = document.querySelector("[class*='_QuestionInfo_'], [class*='QuestionInfo']");
  const wrapperFiber = findReactFiber(questionWrapper);
  const infoFiber = findReactFiber(questionInfo);

  if (!wrapperFiber && !infoFiber) return null;

  const wrapperChildren = wrapperFiber?.memoizedProps?.children || wrapperFiber?.pendingProps?.children;
  const endpoint = findInReactTree(wrapperChildren, (node) => isRecord(node) && node.layout && node.input, 800);
  const questionText = endpoint?.layout ? questionIdFromLayout(endpoint.layout) : "";
  const answers = endpoint?.input && isRecord(endpoint.input) ? processReactAnswers(endpoint.input) : [];
  const code = normalizeCode(
    infoFiber?.memoizedProps?.bookworkCode ||
      infoFiber?.pendingProps?.bookworkCode ||
      findInTree(infoFiber, (node) => typeof node === "string" && isLikelyCode(node), { maxNodes: 200 }) ||
      ""
  );

  return {
    code: isLikelyCode(code) ? code : "",
    questionId: normalizeQuestionId(questionText),
    questionText,
    answers,
    selectedAnswer: answers.map((answer) => answer.value).join("; "),
    source: "react"
  };
}

export function getVisibleText(element: Element | null): string {
  if (!element) return "";
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return "";
  return (element as HTMLElement).innerText || element.textContent || "";
}

export function getReadableText(element: Element | null): string {
  if (!element) return "";
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("script, style, svg, img").forEach((node) => node.remove());
  clone.querySelectorAll("input, textarea, select").forEach((node) => {
    const input = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const value =
      input instanceof HTMLSelectElement && input.selectedOptions?.[0]
        ? input.selectedOptions[0].textContent || input.value
        : input.value || input.getAttribute("value") || "";
    input.replaceWith(document.createTextNode(` ${value} `));
  });
  clone.querySelectorAll(".katex").forEach((node) => {
    const tex = node.querySelector("annotation[encoding='application/x-tex']")?.textContent;
    node.replaceWith(document.createTextNode(cleanMathText(tex || node.textContent)));
  });
  clone.querySelectorAll("[aria-hidden='true'], annotation").forEach((node) => node.remove());
  return cleanAnswerText(clone.textContent || "");
}

export function sanitizeAnswerHtml(element: Element | null): string {
  if (!element) return "";
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());
  clone.querySelectorAll("*").forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  });
  return clone.outerHTML;
}

export function getQuestionRoot(): Element {
  return (
    document.querySelector("[class*='QuestionWrapper']") ||
    document.querySelector("[class*='Question_']") ||
    document.querySelector("main") ||
    document.body ||
    document.documentElement
  );
}

export function getAnswerPageRoot(): Element {
  return (
    document.querySelector("[class*='QuestionScrollableContent']") ||
    document.querySelector("[class*='QuestionContainer']") ||
    document.querySelector("[class*='Activity']") ||
    document.querySelector("main") ||
    document.body ||
    document.documentElement
  );
}

export function getCandidateFromText(text: string): string {
  if (!text) return "";
  const directMatch = text.match(BOOKWORK_CODE_PATTERN);
  if (directMatch) {
    const directCode = normalizeCode(directMatch[1]);
    if (isLikelyCode(directCode)) return directCode;
  }

  BOOKWORK_PATTERN.lastIndex = 0;
  let labelMatch: RegExpExecArray | null;
  while ((labelMatch = BOOKWORK_PATTERN.exec(text)) !== null) {
    const start = Math.max(0, labelMatch.index - 90);
    const end = Math.min(text.length, labelMatch.index + 140);
    const matches = text.slice(start, end).match(CODE_PATTERN) || [];
    const usable = matches.map(normalizeCode).filter(isLikelyCode);
    if (usable[0]) return usable[0];
  }

  return "";
}

export function findBookworkCodeFromDom(): string {
  if (!document.documentElement) return "";
  const elements = Array.from(document.querySelectorAll("main, section, article, div, span, p, h1, h2, h3, strong, label"));
  for (const element of elements) {
    const directMatch = getVisibleText(element).match(BOOKWORK_CODE_PATTERN);
    if (!directMatch) continue;
    const code = normalizeCode(directMatch[1]);
    if (isLikelyCode(code)) return code;
  }

  const focusedText = getCandidateFromText(document.body?.innerText || document.documentElement.innerText || "");
  if (focusedText) return focusedText;

  for (const element of elements) {
    const code = getCandidateFromText(getVisibleText(element));
    if (code) return code;
  }

  return "";
}

function isInsideSparxTaskNav(element: Element | null): boolean {
  return Boolean(element?.closest("[class*='TaskItemsContainer'], [data-tutorial-spotlight-key*='TaskItem']"));
}

function getElementAnswerText(element: Element | null): string {
  if (!element) return "";
  const input = element as HTMLInputElement;
  const text = normalizeAnswer(
    element.getAttribute("aria-label") ||
      getReadableText(element) ||
      input.value ||
      element.getAttribute("value") ||
      ""
  );
  return isUsefulAnswer(text) ? text : "";
}

function getInputAnswer(input: Element | null): string {
  if (!input) return "";
  const field = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (field instanceof HTMLSelectElement) {
    const option = field.selectedOptions?.[0];
    return getElementAnswerText(option) || normalizeAnswer(field.value);
  }
  if (field.matches("textarea, input:not([type='radio']):not([type='checkbox'])")) return normalizeAnswer(field.value);
  const label = field.closest("label") || (field.id ? document.querySelector(`label[for="${CSS.escape(field.id)}"]`) : null);
  return getElementAnswerText(label) || normalizeAnswer(field.value);
}

function getAnswerFieldElements(container: Element | null): Element[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll("input, textarea, select")).filter((element) => {
    if (element.matches("input[type='hidden'], input[type='button'], input[type='submit'], input[type='reset']")) return false;
    if (element.closest("[hidden], [aria-hidden='true']")) return false;
    return true;
  });
}

function getFieldAnswers(container: Element | null): string[] {
  return getAnswerFieldElements(container).map(getInputAnswer).filter(Boolean);
}

function isSelectedOrCorrectAnswerElement(element: Element): boolean {
  if (isInsideSparxTaskNav(element)) return false;
  const className = String((element as HTMLElement).className || "");
  if (/OptionSelected|IsCorrect|Selected/i.test(className)) return true;
  return element.matches("[aria-checked='true'], [aria-selected='true'], [aria-pressed='true']");
}

function getSelectedAnswerElements(root: Element | null): Element[] {
  if (!root) return [];
  const answerParts = Array.from(root.querySelectorAll("[class*='AnswerPart'][class*='IsCorrect']")).filter(
    (element) => !isInsideSparxTaskNav(element)
  );
  if (answerParts.length > 0) return answerParts;

  return Array.from(root.querySelectorAll("[data-ref][class*='CardContent'], [role='button'][data-ref], [role='option'], button, label")).filter(
    isSelectedOrCorrectAnswerElement
  );
}

export function findSelectedAnswerFromDom(root = getQuestionRoot()): string {
  const answerParts = Array.from(root.querySelectorAll("[class*='AnswerPart'][class*='IsCorrect']"));
  const answerPartAnswers = answerParts.map(getElementAnswerText).filter(Boolean);
  if (answerPartAnswers.length > 0) return answerPartAnswers.join("; ");

  const answerScreen = root.querySelector("[class*='AnswerScreen'], [class*='QuestionAnswerOnly']");
  if (answerScreen) {
    const selectedValues = getSelectedAnswerElements(answerScreen).map(getElementAnswerText).filter(Boolean);
    if (selectedValues.length > 0) return selectedValues.join("; ");
    const fieldValues = getFieldAnswers(answerScreen);
    if (fieldValues.length > 0) return fieldValues.join("; ");
  }

  const fieldAnswers = getFieldAnswers(root);
  if (fieldAnswers.length > 0) return fieldAnswers.join("; ");

  const selectedAnswers = getSelectedAnswerElements(root).map(getElementAnswerText).filter(Boolean);
  if (selectedAnswers.length > 0) return selectedAnswers.join("; ");

  const checkedAnswer = getInputAnswer(root.querySelector("input[type='radio']:checked, input[type='checkbox']:checked"));
  if (checkedAnswer) return checkedAnswer;

  const optionAnswer = getInputAnswer(root.querySelector("select"));
  if (optionAnswer) return optionAnswer;

  return "";
}

export function getAnswerSnapshotHtml(root = getQuestionRoot()): string {
  const selectedOptions = getSelectedAnswerElements(root);
  if (selectedOptions.length > 0) return selectedOptions.map(sanitizeAnswerHtml).join("");

  const fieldElements = getAnswerFieldElements(root)
    .map((element) => element.closest("[class*='TextFieldWrapper']") || element)
    .filter(Boolean);
  if (fieldElements.length > 0) return fieldElements.map(sanitizeAnswerHtml).join("");
  return "";
}

export function getQuestionContext(): string {
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, [role='heading']"))
    .map((element) => getVisibleText(element).trim())
    .filter(Boolean);
  if (headings[0]) return headings[0].slice(0, 220);

  return getVisibleText(document.querySelector("main") || document.body || document.documentElement)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}
