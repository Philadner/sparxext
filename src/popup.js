(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const HISTORY_KEY = "bookworkHistory";
  const SETTINGS_KEY = "settings";

  const historyNode = document.getElementById("history");
  const emptyNode = document.getElementById("empty");
  const latestNode = document.getElementById("latest");
  const latestCodeNode = document.getElementById("latest-code");
  const clearButton = document.getElementById("clear");
  const exportButton = document.getElementById("export");
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsNode = document.getElementById("settings");
  const themeEnabledInput = document.getElementById("theme-enabled");

  const answerOverlay = document.createElement("div");
  answerOverlay.className = "answer-overlay";
  answerOverlay.hidden = true;
  answerOverlay.innerHTML = [
    '<div class="answer-dialog" role="dialog" aria-modal="true">',
    '<button class="answer-dialog__close" type="button" title="Close">×</button>',
    '<strong class="answer-dialog__code"></strong>',
    '<p class="answer-dialog__answer"></p>',
    "</div>"
  ].join("");
  document.body.append(answerOverlay);

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function csvEscape(value) {
    return `"${String(value || "").replace(/"/g, '""')}"`;
  }

  function getDisplayAnswer(entry) {
    const answer = String(entry.selectedAnswer || "")
      .replace(/\d{1,3}(?:,\d{3})*\s+XP[\s\S]*$/i, "")
      .replace(/\s+Sparx Maths\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return /^(check|submit|submit answer|next|continue|try again|show working)$/i.test(answer) ? "" : answer;
  }

  function openAnswer(entry) {
    answerOverlay.querySelector(".answer-dialog__code").textContent = entry.code || "";
    answerOverlay.querySelector(".answer-dialog__answer").textContent = getDisplayAnswer(entry) || "No answer captured.";
    answerOverlay.hidden = false;
  }

  function closeAnswer() {
    answerOverlay.hidden = true;
  }

  function createAnswerBox(entry) {
    const answer = document.createElement("button");
    answer.className = "answer-box";
    answer.type = "button";
    answer.textContent = getDisplayAnswer(entry) || "No answer captured.";
    answer.addEventListener("click", (event) => {
      event.stopPropagation();
      openAnswer(entry);
    });
    return answer;
  }

  function createHistoryItem(entry) {
    const item = document.createElement("li");
    const code = document.createElement("strong");
    const answer = createAnswerBox(entry);

    item.className = "history-item";
    code.textContent = entry.code;
    item.append(code, answer);
    item.addEventListener("click", () => {
      item.classList.toggle("history-item--expanded");
    });

    return item;
  }

  function render(history) {
    historyNode.textContent = "";
    emptyNode.hidden = history.length > 0;
    latestNode.hidden = history.length === 0;
    exportButton.disabled = history.length === 0;
    clearButton.disabled = history.length === 0;

    if (history.length > 0) {
      latestCodeNode.textContent = history[0].code;
      latestNode.querySelector(".latest-answer")?.remove();
      const latestAnswer = createAnswerBox(history[0]);
      latestAnswer.classList.add("latest-answer");
      latestAnswer.title = `Captured ${formatDate(history[0].detectedAt)}`;
      latestNode.append(latestAnswer);
    }

    for (const entry of history.slice(1)) {
      historyNode.append(createHistoryItem(entry));
    }
  }

  async function getHistory() {
    const result = await api.storage.local.get(HISTORY_KEY);
    return Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
  }

  async function getSettings() {
    const result = await api.storage.local.get(SETTINGS_KEY);
    return result[SETTINGS_KEY] || {};
  }

  async function refresh() {
    render(await getHistory());
  }

  async function refreshSettings() {
    const settings = await getSettings();
    themeEnabledInput.checked = settings.themeEnabled === true;
  }

  clearButton.addEventListener("click", async () => {
    await api.storage.local.remove([HISTORY_KEY, "latestBookworkCode"]);
    closeAnswer();
    await refresh();
  });

  answerOverlay.addEventListener("click", (event) => {
    if (event.target === answerOverlay || event.target.closest(".answer-dialog__close")) {
      closeAnswer();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAnswer();
  });

  settingsToggle.addEventListener("click", () => {
    const shouldShow = settingsNode.hidden;
    settingsNode.hidden = !shouldShow;
    settingsToggle.setAttribute("aria-expanded", String(shouldShow));
  });

  themeEnabledInput.addEventListener("change", async () => {
    const settings = await getSettings();
    await api.storage.local.set({
      [SETTINGS_KEY]: {
        ...settings,
        themeEnabled: themeEnabledInput.checked
      }
    });
  });

  exportButton.addEventListener("click", async () => {
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
  });

  refresh();
  refreshSettings();
})();
