(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const HISTORY_KEY = "bookworkHistory";
  const SETTINGS_KEY = "settings";
  const MAX_HISTORY = 80;
  const CODE_PATTERN = /\b[A-Z]{1,3}\s?[-.]?\s?\d{1,4}[A-Z]?\b|\b\d{1,4}\s?[-.]?\s?[A-Z]{1,3}\b/g;
  const BOOKWORK_CODE_PATTERN = /book\s*work\s*code\s*:\s*([A-Z0-9][A-Z0-9\s.-]{0,10})/i;
  const BOOKWORK_PATTERN = /book\s*work|bookwork|code/gi;
  const SUCCESS_PATTERN = /\bcorrect!?\b|your hard work has paid off/i;

  let lastSavedCode = "";
  let lastSavedAnswer = "";
  let lastSavedAnswerHtml = "";
  let lastSavedAnswerPageHtml = "";
  let lastSelectedAnswer = "";
  let scanTimer = 0;
  let dismissTimer = 0;
  let panel;
  let phiMenu;
  let phiMenuButton;
  let activePreviewEntryKey = "";

  async function getSettings() {
    const result = await api.storage.local.get(SETTINGS_KEY);
    return result[SETTINGS_KEY] || {};
  }

  async function applySettings() {
    const settings = await getSettings();
    document.documentElement.classList.toggle("sparx-phi-theme", settings.themeEnabled === true);
  }

  function normalizeCode(value) {
    return value.replace(/[\s.-]+/g, "").toUpperCase();
  }

  function isLikelyCode(value) {
    const code = normalizeCode(value);
    if (code.length < 2 || code.length > 8) return false;
    if (!/[A-Z]/.test(code) || !/\d/.test(code)) return false;
    if (/^(H1|H2|H3|H4|H5|H6|CSS|HTML|HTTP|HTTPS)$/i.test(code)) return false;
    if (/XP$/i.test(code) || /^XP/i.test(code)) return false;
    return true;
  }

  function getCandidateFromText(text) {
    if (!text) return "";

    const directMatch = text.match(BOOKWORK_CODE_PATTERN);
    if (directMatch) {
      const directCode = normalizeCode(directMatch[1]);
      if (isLikelyCode(directCode)) return directCode;
    }

    BOOKWORK_PATTERN.lastIndex = 0;
    let labelMatch;
    while ((labelMatch = BOOKWORK_PATTERN.exec(text)) !== null) {
      const start = Math.max(0, labelMatch.index - 90);
      const end = Math.min(text.length, labelMatch.index + 140);
      const nearbyText = text.slice(start, end);
      const matches = nearbyText.match(CODE_PATTERN) || [];
      const usable = matches.map(normalizeCode).filter(isLikelyCode);
      if (usable[0]) return usable[0];
    }

    return "";
  }

  function getVisibleText(element) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return "";
    return element.innerText || element.textContent || "";
  }

  function cleanMathText(value) {
    return String(value || "")
      .replace(/\\bigg\s*\(/g, "(")
      .replace(/\\bigg\s*\)/g, ")")
      .replace(/[{}]/g, "")
      .replace(/\\circ\b/g, "°")
      .replace(/\^°/g, "°")
      .replace(/\\text\{([^}]*)\}/g, "$1")
      .replace(/\\,/g, " ")
      .replace(/\\/g, "")
      .trim();
  }

  function cleanAnswerText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:)])/g, "$1")
      .replace(/([(])\s+/g, "$1")
      .replace(/\s+°/g, "°")
      .trim();
  }

  function getReadableText(element) {
    if (!element) return "";

    const clone = element.cloneNode(true);
    clone.querySelectorAll("script, style, svg, img").forEach((node) => node.remove());
    clone.querySelectorAll("input, textarea, select").forEach((node) => {
      const value =
        node.matches("select") && node.selectedOptions?.[0]
          ? node.selectedOptions[0].textContent || node.value
          : node.value || node.getAttribute("value") || "";
      node.replaceWith(document.createTextNode(` ${value} `));
    });

    clone.querySelectorAll(".katex").forEach((node) => {
      const tex = node.querySelector("annotation[encoding='application/x-tex']")?.textContent;
      node.replaceWith(document.createTextNode(cleanMathText(tex || node.textContent)));
    });

    clone.querySelectorAll("[aria-hidden='true'], annotation").forEach((node) => node.remove());
    return cleanAnswerText(clone.textContent || "");
  }

  function sanitizeAnswerHtml(element) {
    if (!element) return "";

    const clone = element.cloneNode(true);
    clone.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());
    clone.querySelectorAll("*").forEach((node) => {
      for (const attribute of Array.from(node.attributes)) {
        if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
      }
    });

    return clone.outerHTML;
  }

  function normalizeAnswer(value) {
    return cleanAnswerText(value)
      .trim()
      .slice(0, 500);
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function getDisplayAnswer(entry) {
    const answer = String(entry.selectedAnswer || "")
      .replace(/\d{1,3}(?:,\d{3})*\s+XP[\s\S]*$/i, "")
      .replace(/\s+Sparx Maths\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return /^(check|submit|submit answer|next|continue|try again|show working)$/i.test(answer) ? "" : answer;
  }

  async function getHistory() {
    const result = await api.storage.local.get(HISTORY_KEY);
    return Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
  }

  function isUsefulAnswer(value) {
    const text = normalizeAnswer(value);
    if (!text) return false;
    if (/^(check|submit|submit answer|next|continue|try again|show working)$/i.test(text)) return false;
    if (SUCCESS_PATTERN.test(text)) return false;
    return true;
  }

  function mentionsBookwork(value) {
    BOOKWORK_PATTERN.lastIndex = 0;
    return BOOKWORK_PATTERN.test(value);
  }

  function getElementAnswerText(element) {
    if (!element) return "";

    const text = normalizeAnswer(
      element.getAttribute("aria-label") ||
        getReadableText(element) ||
        element.value ||
        element.getAttribute("value")
    );

    return isUsefulAnswer(text) ? text : "";
  }

  function getInputAnswer(input) {
    if (!input) return "";

    if (input.matches("select")) {
      const option = input.selectedOptions && input.selectedOptions[0];
      return getElementAnswerText(option) || normalizeAnswer(input.value);
    }

    if (input.matches("textarea, input:not([type='radio']):not([type='checkbox'])")) {
      return normalizeAnswer(input.value);
    }

    const label = input.closest("label") || (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null);
    return getElementAnswerText(label) || normalizeAnswer(input.value);
  }

  function getFieldAnswers(container) {
    if (!container) return [];

    return getAnswerFieldElements(container)
      .map(getInputAnswer)
      .filter(Boolean);
  }

  function getAnswerFieldElements(container) {
    if (!container) return [];

    return Array.from(container.querySelectorAll("input, textarea, select"))
      .filter((element) => {
        if (element.matches("input[type='hidden'], input[type='button'], input[type='submit'], input[type='reset']")) return false;
        if (element.closest("[hidden], [aria-hidden='true']")) return false;
        return true;
      });
  }

  function getFieldKey(element, index) {
    return element.dataset?.ref || element.name || element.id || String(index + 1);
  }

  function describeAnswerField(element, index) {
    const wrapper = element.closest("[data-number-field], [data-ref], label, [class*='TextFieldWrapper'], [class*='InlineSlot']");
    const fieldType = element.matches("select")
      ? "choice"
      : element.matches("textarea")
        ? "text"
        : element.matches("input[type='number'], input[inputmode='decimal'], input[inputmode='numeric'], input[pattern*='0-9']")
          ? "number"
          : "text";
    const options = element.matches("select")
      ? Array.from(element.options).map((option) => getElementAnswerText(option) || normalizeAnswer(option.value)).filter(Boolean)
      : [];

    return {
      id: getFieldKey(element, index),
      type: fieldType,
      options,
      context: getElementAnswerText(wrapper) || getElementAnswerText(element) || element.placeholder || ""
    };
  }

  function getChoiceAnswerElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll("[data-ref][class*='CardContent'], [role='button'][data-ref], [role='option']")).filter(
      (element) => !isInsideSparxTaskNav(element)
    );
  }

  function describeChoiceGroup(elements) {
    const options = elements
      .map((element) => ({
        id: element.dataset?.ref || element.getAttribute("data-ref") || getElementAnswerText(element),
        text: getElementAnswerText(element)
      }))
      .filter((option) => option.id || option.text);

    return options.length > 0
      ? {
          id: "choice_1",
          type: "choice",
          options: options.map((option) => option.text || option.id),
          optionIds: options.map((option) => option.id),
          context: "Select one answer option"
        }
      : null;
  }

  function buildAnswerScheme() {
    const root = getQuestionRoot();
    const fields = getAnswerFieldElements(root).map(describeAnswerField);
    const choiceGroup = describeChoiceGroup(getChoiceAnswerElements(root));
    if (fields.length === 0 && choiceGroup) fields.push(choiceGroup);

    const schemeText = getReadableText(root)
      .replace(/Bookwork code:\s*[A-Z0-9.-]+/i, "")
      .replace(/\bCalculator (not )?allowed\b/i, "")
      .slice(0, 1800);

    return {
      questionText: schemeText,
      fields,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["answers"],
        properties: {
          answers: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(fields.map((field) => [field.id, { type: "string" }]))
          }
        }
      }
    };
  }

  function setNativeValue(element, value) {
    const descriptor =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value") ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function applyAnswerValues(answers) {
    const root = getQuestionRoot();
    const fields = getAnswerFieldElements(root);
    const choiceElements = getChoiceAnswerElements(root);

    fields.forEach((field, index) => {
      const key = getFieldKey(field, index);
      if (!Object.prototype.hasOwnProperty.call(answers, key)) return;

      const value = String(answers[key] ?? "");
      if (field.matches("select")) {
        const matchingOption = Array.from(field.options).find((option) => {
          const text = getElementAnswerText(option) || normalizeAnswer(option.value);
          return text.toLowerCase() === value.toLowerCase() || option.value === value;
        });
        field.value = matchingOption ? matchingOption.value : value;
      } else {
        setNativeValue(field, value);
      }

      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const choiceValue = answers.choice_1;
    if (choiceValue && choiceElements.length > 0) {
      const normalizedChoice = String(choiceValue).trim().toLowerCase();
      const choice = choiceElements.find((element) => {
        const text = getElementAnswerText(element).toLowerCase();
        const ref = String(element.dataset?.ref || element.getAttribute("data-ref") || "").toLowerCase();
        return text === normalizedChoice || ref === normalizedChoice;
      });
      choice?.click();
    }
  }

  function isInsideSparxTaskNav(element) {
    return Boolean(element?.closest("[class*='TaskItemsContainer'], [data-tutorial-spotlight-key*='TaskItem']"));
  }

  function isSelectedOrCorrectAnswerElement(element) {
    if (!element || isInsideSparxTaskNav(element)) return false;
    const className = String(element.className || "");
    if (/OptionSelected|IsCorrect|Selected/i.test(className)) return true;
    return element.matches("[aria-checked='true'], [aria-selected='true'], [aria-pressed='true']");
  }

  function getSelectedAnswerElements(root) {
    if (!root) return [];

    const answerParts = Array.from(root.querySelectorAll("[class*='AnswerPart'][class*='IsCorrect']")).filter(
      (element) => !isInsideSparxTaskNav(element)
    );
    if (answerParts.length > 0) return answerParts;

    return Array.from(
      root.querySelectorAll("[data-ref][class*='CardContent'], [role='button'][data-ref], [role='option'], button, label")
    ).filter(isSelectedOrCorrectAnswerElement);
  }

  function classContains(element, token) {
    return element && String(element.className || "").toLowerCase().includes(token.toLowerCase());
  }

  function getQuestionRoot() {
    return (
      document.querySelector("[class*='QuestionWrapper']") ||
      document.querySelector("[class*='Question_']") ||
      document.querySelector("main") ||
      document.body
    );
  }

  function getAnswerPageRoot() {
    return (
      document.querySelector("[class*='QuestionScrollableContent']") ||
      document.querySelector("[class*='QuestionContainer']") ||
      document.querySelector("[class*='Activity']") ||
      document.querySelector("main") ||
      document.body
    );
  }

  function findSparxSelectedAnswers(root) {
    const selectedOptions = getSelectedAnswerElements(root);

    const answers = selectedOptions
      .map((element) => element.querySelector("[class*='AnswerTextElement'], [class*='TextElement']") || element)
      .map(getElementAnswerText)
      .filter(Boolean);
    return answers.join("; ");
  }

  function findSparxAnswerScreenAnswers(root) {
    const answerParts = Array.from(root.querySelectorAll("[class*='AnswerPart'][class*='IsCorrect']"));
    const answers = answerParts.map(getElementAnswerText).filter(Boolean);
    if (answers.length > 0) return answers.join("; ");

    const answerScreen = root.querySelector("[class*='AnswerScreen'], [class*='QuestionAnswerOnly']");
    if (!answerScreen) return "";

    const selectedValues = getSelectedAnswerElements(answerScreen).map(getElementAnswerText).filter(Boolean);
    if (selectedValues.length > 0) return selectedValues.join("; ");

    const fieldValues = getFieldAnswers(answerScreen);
    if (fieldValues.length > 0) return fieldValues.join("; ");

    return "";
  }

  function findSparxAnswerSnapshotHtml(root) {
    const selectedOptions = getSelectedAnswerElements(root);
    if (selectedOptions.length > 0) {
      return selectedOptions.map(sanitizeAnswerHtml).join("");
    }

    const fieldElements = getAnswerFieldElements(root)
      .map((element) => element.closest("[class*='TextFieldWrapper']") || element)
      .filter(Boolean);
    if (fieldElements.length > 0) return fieldElements.map(sanitizeAnswerHtml).join("");

    return "";
  }

  function findSparxAnswerPageSnapshotHtml() {
    const root = getAnswerPageRoot();
    return root ? sanitizeAnswerHtml(root) : "";
  }

  function findSelectedAnswer() {
    const root = getQuestionRoot();
    if (!root) return "";

    const answerScreenAnswer = findSparxAnswerScreenAnswers(root);
    if (answerScreenAnswer) return answerScreenAnswer;

    const fieldAnswers = getFieldAnswers(root);
    if (fieldAnswers.length > 0) return fieldAnswers.join("; ");

    const sparxAnswer = findSparxSelectedAnswers(root);
    if (sparxAnswer) return sparxAnswer;

    const checkedInput = root.querySelector("input[type='radio']:checked, input[type='checkbox']:checked");
    const checkedAnswer = getInputAnswer(checkedInput);
    if (checkedAnswer) return checkedAnswer;

    const selectedOption = root.querySelector("select");
    const optionAnswer = getInputAnswer(selectedOption);
    if (optionAnswer) return optionAnswer;

    const semanticSelected = root.querySelector("[aria-checked='true'], [aria-selected='true'], [aria-pressed='true']");
    const semanticAnswer = getElementAnswerText(semanticSelected);
    if (semanticAnswer) return semanticAnswer;

    const selectedByClass = Array.from(root.querySelectorAll("button, label, li, div, span"))
      .map((element) => ({ element, text: getVisibleText(element), className: String(element.className || "") }))
      .filter(
        (item) =>
          /\b(selected|checked|chosen|active)\b/i.test(item.className) &&
          !classContains(item.element, "QuestionAnswerOnly") &&
          !item.element.closest("[class*='TaskItemsContainer']") &&
          !mentionsBookwork(item.text) &&
          isUsefulAnswer(item.text)
      )
      .sort((a, b) => normalizeAnswer(a.text).length - normalizeAnswer(b.text).length)[0];

    return getElementAnswerText(selectedByClass && selectedByClass.element);
  }

  function rememberSelectedAnswer(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    window.setTimeout(() => {
      const selectedAnswer =
        findSelectedAnswer() ||
        getInputAnswer(target.closest("input, textarea, select")) ||
        getElementAnswerText(target.closest("label, button, [role='button'], [role='option']"));

      if (selectedAnswer) lastSelectedAnswer = selectedAnswer;
    }, 0);
  }

  function isCorrectVisible() {
    const elements = Array.from(document.querySelectorAll("main, section, article, div, span, p, strong, button"));
    return elements.some((element) => SUCCESS_PATTERN.test(getVisibleText(element)));
  }

  function getQuestionContext() {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, [role='heading']"))
      .map((element) => getVisibleText(element).trim())
      .filter(Boolean);

    if (headings[0]) return headings[0].slice(0, 220);

    const mainText = getVisibleText(document.querySelector("main") || document.body)
      .replace(/\s+/g, " ")
      .trim();

    return mainText.slice(0, 220);
  }

  function findBookworkCode() {
    if (!document.body) return "";

    const elements = Array.from(document.querySelectorAll("main, section, article, div, span, p, h1, h2, h3, strong, label"));
    for (const element of elements) {
      const directMatch = getVisibleText(element).match(BOOKWORK_CODE_PATTERN);
      if (!directMatch) continue;

      const code = normalizeCode(directMatch[1]);
      if (isLikelyCode(code)) return code;
    }

    const focusedText = getCandidateFromText(document.body.innerText || "");
    if (focusedText) return focusedText;

    for (const element of elements) {
      const text = getVisibleText(element);
      const code = getCandidateFromText(text);
      if (code) return code;
    }

    return "";
  }

  async function saveCode(code, selectedAnswer, selectedAnswerHtml, answerPageHtml) {
    const now = new Date().toISOString();
    const pageTitle = document.title || "Sparx Maths";
    const url = location.href;
    const questionContext = getQuestionContext();
    const answer = normalizeAnswer(selectedAnswer);
    const answerHtml = String(selectedAnswerHtml || "").slice(0, 120000);
    const pageHtml = String(answerPageHtml || "").slice(0, 180000);
    const result = await api.storage.local.get(HISTORY_KEY);
    const history = Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
    const existingIndex = history.findIndex((entry) => entry.code === code && entry.url === url);
    const existingAnswer = existingIndex >= 0 ? history[existingIndex].selectedAnswer : "";
    const existingAnswerHtml = existingIndex >= 0 ? history[existingIndex].selectedAnswerHtml : "";
    const existingPageHtml = existingIndex >= 0 ? history[existingIndex].answerPageHtml : "";
    const entry = {
      code,
      selectedAnswer: answer || existingAnswer || "",
      selectedAnswerHtml: answerHtml || existingAnswerHtml || "",
      answerPageHtml: pageHtml || existingPageHtml || "",
      pageTitle,
      url,
      questionContext,
      detectedAt: now
    };

    if (existingIndex >= 0) {
      history.splice(existingIndex, 1);
    }

    history.unshift(entry);
    await api.storage.local.set({ [HISTORY_KEY]: history.slice(0, MAX_HISTORY), latestBookworkCode: entry });
    renderPhiMenu(history.slice(0, MAX_HISTORY));
  }

  function closePhiExpandedView() {
    if (!phiMenu) return;
    activePreviewEntryKey = "";
    phiMenu.classList.remove("sparx-phi-menu--expanded");
    phiMenu.querySelector(".sparx-phi-menu__preview-code").textContent = "";
    phiMenu.querySelector(".sparx-phi-menu__preview-body").textContent = "";
  }

  function getEntryKey(entry) {
    return [entry.code || "", entry.url || "", entry.detectedAt || ""].join("\u0001");
  }

  function fitExpandedPreview() {
    if (!phiMenu?.classList.contains("sparx-phi-menu--expanded")) return;

    const card = phiMenu.querySelector(".sparx-phi-menu__preview-card");
    const body = phiMenu.querySelector(".sparx-phi-menu__preview-body");
    const content = phiMenu.querySelector(".sparx-phi-menu__preview-fit");
    if (!card || !body || !content) return;

    body.style.setProperty("--sparx-phi-preview-scale", "1");
    body.style.removeProperty("--sparx-phi-preview-height");

    window.requestAnimationFrame(() => {
      const availableWidth = Math.max(1, card.clientWidth);
      const availableHeight = Math.max(1, card.clientHeight);
      const contentRect = content.getBoundingClientRect();
      const childRects = Array.from(content.querySelectorAll("*"))
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      const bounds = childRects.reduce(
        (current, rect) => ({
          left: Math.min(current.left, rect.left),
          top: Math.min(current.top, rect.top),
          right: Math.max(current.right, rect.right),
          bottom: Math.max(current.bottom, rect.bottom)
        }),
        {
          left: contentRect.left,
          top: contentRect.top,
          right: contentRect.right,
          bottom: contentRect.bottom
        }
      );
      const contentWidth = Math.max(content.scrollWidth, bounds.right - bounds.left, 1);
      const contentHeight = Math.max(content.scrollHeight, bounds.bottom - bounds.top, 1);
      const scale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight) * 0.98;

      body.style.setProperty("--sparx-phi-preview-scale", String(scale));
      body.style.setProperty("--sparx-phi-preview-height", `${contentHeight * scale}px`);
    });
  }

  function openPhiAnswer(entry) {
    ensurePhiMenu();
    const previewBody = phiMenu.querySelector(".sparx-phi-menu__preview-body");
    if (!previewBody) return false;

    activePreviewEntryKey = getEntryKey(entry);
    phiMenu.querySelector(".sparx-phi-menu__preview-code").textContent = entry.code || "";
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

  function openPhiEntryFromItem(item, entry) {
    if (!phiMenu || !item) return;

    phiMenu.querySelectorAll(".sparx-phi-menu__item--expanded").forEach((node) => {
      node.classList.remove("sparx-phi-menu__item--expanded");
    });

    try {
      if (!openPhiAnswer(entry)) {
        item.classList.remove("sparx-phi-menu__item--expanded");
      }
    } catch (error) {
      item.classList.remove("sparx-phi-menu__item--expanded");
      console.warn("Failed to open Phi answer preview", error);
    }
  }

  function createPhiAnswerPreview(entry) {
    const answer = document.createElement("div");
    answer.className = "sparx-phi-menu__answer";
    answer.setAttribute("role", "button");
    answer.setAttribute("tabindex", "0");
    answer.setAttribute("aria-label", `Open answer for ${entry.code || "bookwork code"}`);
    if (entry.selectedAnswerHtml) {
      answer.innerHTML = entry.selectedAnswerHtml;
    }
    answer.addEventListener("click", (event) => {
      event.stopPropagation();
      openPhiEntryFromItem(answer.closest(".sparx-phi-menu__item"), entry);
    });
    answer.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      openPhiEntryFromItem(answer.closest(".sparx-phi-menu__item"), entry);
    });
    return answer;
  }

  function createPhiHistoryItem(entry, isLatest) {
    const item = document.createElement("li");
    const code = document.createElement("strong");
    const answer = createPhiAnswerPreview(entry);

    item.className = isLatest ? "sparx-phi-menu__item sparx-phi-menu__item--latest" : "sparx-phi-menu__item";
    code.textContent = entry.code;
    item.append(code, answer);
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      openPhiEntryFromItem(item, entry);
    });

    return item;
  }

  function renderPhiMenu(history) {
    if (!phiMenu) return;

    const list = phiMenu.querySelector(".sparx-phi-menu__history");
    const empty = phiMenu.querySelector(".sparx-phi-menu__empty");
    list.textContent = "";
    empty.hidden = history.length > 0;

    history.forEach((entry, index) => {
      list.append(createPhiHistoryItem(entry, index === 0));
    });
  }

  async function refreshPhiMenu() {
    renderPhiMenu(await getHistory());
  }

  function csvEscape(value) {
    return `"${String(value || "").replace(/"/g, '""')}"`;
  }

  async function exportHistoryCsv() {
    const history = await getHistory();
    const rows = [
      ["code", "selected_answer", "detected_at", "question_context", "page_title", "url"].map(csvEscape).join(","),
      ...history.map((entry) => [
        entry.code,
        getDisplayAnswer(entry),
        entry.detectedAt,
        entry.questionContext,
        entry.pageTitle,
        entry.url
      ].map(csvEscape).join(","))
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
    const latestBookworkCode = nextHistory[0] || null;
    await api.storage.local.set({ [HISTORY_KEY]: nextHistory, latestBookworkCode });
    closePhiExpandedView();
    renderPhiMenu(nextHistory);
  }

  async function requestAiHelp() {
    ensurePhiMenu();
    const helpButton = phiMenu.querySelector(".sparx-phi-menu__help");
    const helpStatus = phiMenu.querySelector(".sparx-phi-menu__help-status");
    const settings = await getSettings();
    const provider = ["chatgpt", "claude"].includes(settings.aiProvider) ? settings.aiProvider : "gauth";
    const providerNames = { chatgpt: "ChatGPT", claude: "Claude", gauth: "Gauth" };
    const providerName = providerNames[provider];

    helpButton.disabled = true;
    helpStatus.textContent = `Sending screenshot to ${providerName}...`;

    try {
      phiMenu.classList.add("sparx-phi-menu--capture-hidden");
      phiMenuButton.classList.add("sparx-phi-menu-button--capture-hidden");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const response = await api.runtime.sendMessage({
        type: "SPARX_HELP_WITH_QUESTION",
        provider
      });
      if (!response?.ok) throw new Error(response?.error || `${providerName} handoff failed.`);
      helpStatus.textContent = `Sent to ${providerName}.`;
    } catch (error) {
      helpStatus.textContent = error.message || "Could not send screenshot.";
    } finally {
      phiMenu.classList.remove("sparx-phi-menu--capture-hidden");
      phiMenuButton.classList.remove("sparx-phi-menu-button--capture-hidden");
      window.setTimeout(() => {
        helpButton.disabled = false;
        helpStatus.textContent = "";
      }, 2200);
    }
  }

  function setPhiMenuOpen(isOpen) {
    ensurePhiMenu();
    if (!isOpen) {
      closePhiExpandedView();
      phiMenu.querySelectorAll(".sparx-phi-menu__item--expanded").forEach((node) => {
        node.classList.remove("sparx-phi-menu__item--expanded");
      });
    }
    phiMenu.classList.toggle("sparx-phi-menu--open", isOpen);
    phiMenuButton.classList.toggle("sparx-phi-menu-button--open", isOpen);
    phiMenuButton.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) refreshPhiMenu();
  }

  function ensurePhiMenu() {
    if (phiMenu) return phiMenu;

    phiMenuButton = document.createElement("button");
    phiMenuButton.id = "sparx-phi-menu-button";
    phiMenuButton.className = "sparx-phi-menu-button";
    phiMenuButton.type = "button";
    phiMenuButton.innerHTML =
      '<svg class="sparx-phi-menu-button__icon" viewBox="0 0 84 96" aria-hidden="true" focusable="false"><path d="M 47.4691 94.8742 V 67.8693 L 47.9534 67.8537 C 52.3122 67.7166 56.6259 66.839 60.8958 65.2189 V 65.2199 C 64.8929 63.6903 68.4645 61.5771 71.6146 58.882 L 72.2396 58.3351 L 72.2454 58.3302 C 75.575 55.4373 78.2558 51.7818 80.2845 47.3546 V 47.3537 C 82.3061 42.928 83.3226 37.9032 83.3226 32.2697 C 83.3226 26.9517 82.5356 22.4635 80.9818 18.7882 L 80.6615 18.0636 L 80.6605 18.0627 C 79.0043 14.4679 76.8897 11.4427 74.3197 8.97964 L 73.7991 8.49429 L 73.7943 8.48941 C 71.3117 6.17323 68.5439 4.39348 65.4896 3.14664 L 64.8743 2.90445 L 64.8724 2.90347 C 61.5635 1.6319 58.291 0.999176 55.0521 0.999176 C 53.2704 0.999176 51.3345 1.22294 49.2425 1.67398 L 48.3363 1.88101 L 48.3333 1.88199 L 47.8841 1.99234 C 45.8085 2.52369 44.0577 3.2689 42.6224 4.22086 L 42.3197 4.42886 H 42.3187 C 40.5189 5.69142 39.0689 7.28919 37.9661 9.22574 H 37.9652 C 36.8915 11.1217 36.3441 13.4147 36.3441 16.1242 V 63.8459 L 35.8304 63.8322 C 29.1364 63.6535 23.7544 61.0487 19.7269 56.0246 L 19.3411 55.5314 V 55.5304 C 15.2859 50.1848 13.2816 43.2011 13.2816 34.6242 C 13.2816 26.5123 14.5431 20.091 17.1136 15.4044 C 19.6172 10.8398 23.2947 7.648 28.1283 5.84195 L 27.3236 1.50894 C 18.4518 3.72283 11.836 7.6445 7.42415 13.2462 H 7.42317 C 2.93466 18.9632 0.677078 26.0783 0.677078 34.6242 C 0.677079 44.2236 3.85313 52.0186 10.1888 58.0539 C 16.5273 64.0918 25.0701 67.3717 35.8665 67.8537 L 36.3441 67.8752 V 94.8742 H 47.4691 Z M 47.4691 13.1447 C 47.4691 10.8408 48.1377 8.9429 49.5091 7.50113 L 49.7923 7.2189 C 51.3473 5.75275 53.2424 5.01976 55.4476 5.01968 C 59.9233 5.01968 63.5868 7.49382 66.4398 12.2628 L 66.4388 12.2638 C 69.3084 17.0377 70.7191 23.5482 70.7191 31.7492 C 70.7191 40.5992 68.9526 47.9197 65.3841 53.6779 L 65.0335 54.2306 C 61.218 60.0959 55.5202 63.2933 48.0042 63.8312 L 47.4691 63.8693 V 13.1447 Z"></path></svg>';
    phiMenuButton.title = "Open Phi menu";
    phiMenuButton.setAttribute("aria-label", "Open Phi menu");
    phiMenuButton.setAttribute("aria-expanded", "false");
    phiMenuButton.addEventListener("click", () => {
      setPhiMenuOpen(!phiMenu.classList.contains("sparx-phi-menu--open"));
    });

    phiMenu = document.createElement("aside");
    phiMenu.id = "sparx-phi-menu";
    phiMenu.className = "sparx-phi-menu";
    phiMenu.innerHTML = [
      '<div class="sparx-phi-menu__header">',
      "<strong>Phi Menu</strong>",
      '<div class="sparx-phi-menu__header-actions">',
      '<button class="sparx-phi-menu__help" type="button" title="Send screenshot for AI help">Help</button>',
      '<button class="sparx-phi-menu__close" type="button" title="Close">×</button>',
      "</div>",
      "</div>",
      '<div class="sparx-phi-menu__body">',
      '<p class="sparx-phi-menu__help-status" aria-live="polite"></p>',
      '<details class="sparx-phi-menu__settings">',
      "<summary>Settings</summary>",
      '<label class="sparx-phi-menu__setting-row">',
      '<input class="sparx-phi-menu__theme-toggle" type="checkbox">',
      "<span>Enable Phi theme (looks ASS right now)</span>",
      "</label>",
      '<label class="sparx-phi-menu__setting-row">',
      '<span>Help target</span>',
      '<select class="sparx-phi-menu__ai-provider-select">',
      '<option value="gauth">Gauth</option>',
      '<option value="chatgpt">ChatGPT</option>',
      '<option value="claude">Claude</option>',
      "</select>",
      "</label>",
      '<div class="sparx-phi-menu__actions">',
      '<button class="sparx-phi-menu__export" type="button">Export CSV</button>',
      '<button class="sparx-phi-menu__clear" type="button">Clear</button>',
      "</div>",
      "</details>",
      '<ol class="sparx-phi-menu__history"></ol>',
      '<p class="sparx-phi-menu__empty">No bookwork codes captured yet.</p>',
      "</div>",
      '<section class="sparx-phi-menu__preview">',
      '<button class="sparx-phi-menu__preview-delete" type="button" title="Delete selected item">Delete</button>',
      '<button class="sparx-phi-menu__preview-close" type="button" title="Close">×</button>',
      '<strong class="sparx-phi-menu__preview-code"></strong>',
      '<div class="sparx-phi-menu__preview-card"><div class="sparx-phi-menu__preview-body"></div></div>',
      "</section>"
    ].join("");
    phiMenu.querySelector(".sparx-phi-menu__close").addEventListener("click", () => setPhiMenuOpen(false));
    phiMenu.querySelector(".sparx-phi-menu__help").addEventListener("click", requestAiHelp);
    phiMenu.querySelector(".sparx-phi-menu__preview-close").addEventListener("click", closePhiExpandedView);
    phiMenu.querySelector(".sparx-phi-menu__preview-delete").addEventListener("click", deleteActivePreviewEntry);
    phiMenu.querySelector(".sparx-phi-menu__export").addEventListener("click", exportHistoryCsv);
    phiMenu.querySelector(".sparx-phi-menu__clear").addEventListener("click", clearHistory);
    phiMenu.querySelector(".sparx-phi-menu__theme-toggle").addEventListener("change", async (event) => {
      const settings = await getSettings();
      await api.storage.local.set({ [SETTINGS_KEY]: { ...settings, themeEnabled: event.target.checked } });
    });
    phiMenu.querySelector(".sparx-phi-menu__ai-provider-select").addEventListener("change", async (event) => {
      const settings = await getSettings();
      await api.storage.local.set({
        [SETTINGS_KEY]: { ...settings, aiProvider: event.target.value || "gauth" }
      });
    });
    document.documentElement.append(phiMenuButton, phiMenu);
    applySettings().then(() => {
      getSettings().then((settings) => {
        const themeToggle = phiMenu?.querySelector(".sparx-phi-menu__theme-toggle");
        if (themeToggle) themeToggle.checked = settings.themeEnabled === true;
        const aiProviderSelect = phiMenu?.querySelector(".sparx-phi-menu__ai-provider-select");
        if (aiProviderSelect) aiProviderSelect.value = ["chatgpt", "claude"].includes(settings.aiProvider) ? settings.aiProvider : "gauth";
      });
    });
    refreshPhiMenu();
    return phiMenu;
  }

  function ensurePanel() {
    if (panel) return panel;

    panel = document.createElement("aside");
    panel.id = "sparx-code-detector";
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = [
      '<button class="sparx-code-detector__surface" type="button" title="Open Phi menu">',
      '<span class="sparx-code-detector__mark">',
      '<svg class="sparx-code-detector__icon" viewBox="0 0 84 96" aria-hidden="true" focusable="false"><path d="M 47.4691 94.8742 V 67.8693 L 47.9534 67.8537 C 52.3122 67.7166 56.6259 66.839 60.8958 65.2189 V 65.2199 C 64.8929 63.6903 68.4645 61.5771 71.6146 58.882 L 72.2396 58.3351 L 72.2454 58.3302 C 75.575 55.4373 78.2558 51.7818 80.2845 47.3546 V 47.3537 C 82.3061 42.928 83.3226 37.9032 83.3226 32.2697 C 83.3226 26.9517 82.5356 22.4635 80.9818 18.7882 L 80.6615 18.0636 L 80.6605 18.0627 C 79.0043 14.4679 76.8897 11.4427 74.3197 8.97964 L 73.7991 8.49429 L 73.7943 8.48941 C 71.3117 6.17323 68.5439 4.39348 65.4896 3.14664 L 64.8743 2.90445 L 64.8724 2.90347 C 61.5635 1.6319 58.291 0.999176 55.0521 0.999176 C 53.2704 0.999176 51.3345 1.22294 49.2425 1.67398 L 48.3363 1.88101 L 48.3333 1.88199 L 47.8841 1.99234 C 45.8085 2.52369 44.0577 3.2689 42.6224 4.22086 L 42.3197 4.42886 H 42.3187 C 40.5189 5.69142 39.0689 7.28919 37.9661 9.22574 H 37.9652 C 36.8915 11.1217 36.3441 13.4147 36.3441 16.1242 V 63.8459 L 35.8304 63.8322 C 29.1364 63.6535 23.7544 61.0487 19.7269 56.0246 L 19.3411 55.5314 V 55.5304 C 15.2859 50.1848 13.2816 43.2011 13.2816 34.6242 C 13.2816 26.5123 14.5431 20.091 17.1136 15.4044 C 19.6172 10.8398 23.2947 7.648 28.1283 5.84195 L 27.3236 1.50894 C 18.4518 3.72283 11.836 7.6445 7.42415 13.2462 H 7.42317 C 2.93466 18.9632 0.677078 26.0783 0.677078 34.6242 C 0.677079 44.2236 3.85313 52.0186 10.1888 58.0539 C 16.5273 64.0918 25.0701 67.3717 35.8665 67.8537 L 36.3441 67.8752 V 94.8742 H 47.4691 Z M 47.4691 13.1447 C 47.4691 10.8408 48.1377 8.9429 49.5091 7.50113 L 49.7923 7.2189 C 51.3473 5.75275 53.2424 5.01976 55.4476 5.01968 C 59.9233 5.01968 63.5868 7.49382 66.4398 12.2628 L 66.4388 12.2638 C 69.3084 17.0377 70.7191 23.5482 70.7191 31.7492 C 70.7191 40.5992 68.9526 47.9197 65.3841 53.6779 L 65.0335 54.2306 C 61.218 60.0959 55.5202 63.2933 48.0042 63.8312 L 47.4691 63.8693 V 13.1447 Z"></path></svg>',
      "</span>",
      '<span class="sparx-code-detector__body">',
      '<div class="sparx-code-detector__code"></div>',
      '<span class="sparx-code-detector__meta">Bookwork code captured</span>',
      "</span>",
      "</button>",
      '<div class="sparx-code-detector__progress"></div>'
    ].join("");

    panel.querySelector("button").addEventListener("click", () => {
      window.clearTimeout(dismissTimer);
      panel.hidden = true;
      setPhiMenuOpen(true);
    });

    document.documentElement.appendChild(panel);
    return panel;
  }

  function showCode(code, selectedAnswer) {
    const node = ensurePanel();
    window.clearTimeout(dismissTimer);
    node.classList.remove("sparx-code-detector--visible", "sparx-code-detector--dismissing");
    void node.offsetWidth;
    node.querySelector(".sparx-code-detector__code").textContent = code;
    node.hidden = false;
    node.classList.add("sparx-code-detector--visible");
    dismissTimer = window.setTimeout(() => {
      node.classList.remove("sparx-code-detector--visible");
      node.classList.add("sparx-code-detector--dismissing");
      window.setTimeout(() => {
        if (node.classList.contains("sparx-code-detector--dismissing")) {
          node.hidden = true;
          node.classList.remove("sparx-code-detector--dismissing");
        }
      }, 320);
    }, 3000);
  }

  async function scan() {
    if (!isCorrectVisible()) return;

    const questionRoot = getQuestionRoot();
    const selectedAnswer = findSelectedAnswer() || lastSelectedAnswer;
    const selectedAnswerHtml = questionRoot ? findSparxAnswerSnapshotHtml(questionRoot) : "";
    const answerPageHtml = findSparxAnswerPageSnapshotHtml();
    const code = findBookworkCode();
    if (!code) return;
    if (
      code === lastSavedCode &&
      selectedAnswer === lastSavedAnswer &&
      selectedAnswerHtml === lastSavedAnswerHtml &&
      answerPageHtml === lastSavedAnswerPageHtml
    ) {
      return;
    }

    lastSavedCode = code;
    lastSavedAnswer = selectedAnswer;
    lastSavedAnswerHtml = selectedAnswerHtml;
    lastSavedAnswerPageHtml = answerPageHtml;
    await saveCode(code, selectedAnswer, selectedAnswerHtml, answerPageHtml);
    showCode(code, selectedAnswer);
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 350);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  api.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[SETTINGS_KEY]) {
      applySettings();
      const themeToggle = phiMenu?.querySelector(".sparx-phi-menu__theme-toggle");
      if (themeToggle) themeToggle.checked = changes[SETTINGS_KEY].newValue?.themeEnabled === true;
      const aiProviderSelect = phiMenu?.querySelector(".sparx-phi-menu__ai-provider-select");
      if (aiProviderSelect) {
        const provider = changes[SETTINGS_KEY].newValue?.aiProvider;
        aiProviderSelect.value = ["chatgpt", "claude"].includes(provider) ? provider : "gauth";
      }
    }
    if (areaName === "local" && changes[HISTORY_KEY]) refreshPhiMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setPhiMenuOpen(false);
    }
  });
  document.addEventListener("click", (event) => {
    if (!phiMenu?.classList.contains("sparx-phi-menu--expanded")) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#sparx-phi-menu") || target.closest("#sparx-phi-menu-button")) return;
    setPhiMenuOpen(false);
  });
  document.addEventListener("click", rememberSelectedAnswer, true);
  document.addEventListener("input", rememberSelectedAnswer, true);
  document.addEventListener("change", rememberSelectedAnswer, true);
  window.addEventListener("resize", fitExpandedPreview);
  applySettings();
  ensurePhiMenu();
  scheduleScan();
})();
