(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const CHATGPT_URL = "https://chatgpt.com/";
  const GAUTH_URL = "https://www.gauthmath.com/";
  const CLAUDE_URL = "https://claude.ai/new";

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(",", 2)[1] || "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return Array.from(bytes);
  }

  async function captureVisibleTab(windowId) {
    return api.tabs.captureVisibleTab(windowId, { format: "png" });
  }

  async function queryTabs(queryInfo) {
    return api.tabs.query(queryInfo);
  }

  async function updateTab(tabId, updateProperties) {
    return api.tabs.update(tabId, updateProperties);
  }

  async function createTab(createProperties) {
    return api.tabs.create(createProperties);
  }

  async function updateWindow(windowId, updateProperties) {
    return api.windows.update(windowId, updateProperties);
  }

  async function executeScript(tabId, details) {
    return api.tabs.executeScript(tabId, details);
  }

  function pickMostRecentChatGptTab(tabs) {
    return tabs
      .filter((tab) => /https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || ""))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }

  function pickMostRecentGauthTab(tabs) {
    return tabs
      .filter((tab) => /https:\/\/(?:www\.)?gauthmath\.com\//i.test(tab.url || ""))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }

  function pickMostRecentClaudeTab(tabs) {
    return tabs
      .filter((tab) => /https:\/\/claude\.ai\//i.test(tab.url || ""))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }

  async function findOrOpenChatGptTab(options = {}) {
    const tabs = await queryTabs({});
    const existing = pickMostRecentChatGptTab(tabs);
    if (existing) return existing;
    const tab = await createTab({ url: CHATGPT_URL, active: true });
    await new Promise((resolve) => setTimeout(resolve, 2800));
    return tab;
  }

  async function findOrOpenGauthTab() {
    const tabs = await queryTabs({});
    const existing = pickMostRecentGauthTab(tabs);
    if (existing) return existing;
    return createTab({ url: GAUTH_URL, active: true });
  }

  async function findOrOpenClaudeTab() {
    const tabs = await queryTabs({});
    const existing = pickMostRecentClaudeTab(tabs);
    if (existing) return existing;
    const tab = await createTab({ url: CLAUDE_URL, active: true });
    await new Promise((resolve) => setTimeout(resolve, 2800));
    return tab;
  }

  async function helpWithSparxQuestion(sender, options = {}) {
    if (!sender.tab?.windowId) throw new Error("No Sparx tab is available to capture.");

    const screenshotDataUrl = await captureVisibleTab(sender.tab.windowId);
    const chatTab = await findOrOpenChatGptTab();
    const prompt = "Help me solve this Sparx Maths question. Use the screenshot and explain the answer clearly.";

    if (chatTab.windowId) await updateWindow(chatTab.windowId, { focused: true });
    await updateTab(chatTab.id, { active: true });

    await executeScript(chatTab.id, {
      code: `(${pasteSparxScreenshotIntoChatGpt.toString()})(${JSON.stringify({
        dataUrl: screenshotDataUrl,
        bytes: dataUrlToBytes(screenshotDataUrl),
        prompt,
        sparxTabId: sender.tab.id
      })});`
    });

    return { ok: true };
  }

  async function helpWithGauth(sender) {
    if (!sender.tab?.windowId) throw new Error("No Sparx tab is available to capture.");

    const screenshotDataUrl = await captureVisibleTab(sender.tab.windowId);
    const gauthTab = await findOrOpenGauthTab();

    if (gauthTab.windowId) await updateWindow(gauthTab.windowId, { focused: true });
    await updateTab(gauthTab.id, { active: true });

    await executeScript(gauthTab.id, {
      code: `(${pasteSparxScreenshotIntoGauth.toString()})(${JSON.stringify({
        dataUrl: screenshotDataUrl,
        bytes: dataUrlToBytes(screenshotDataUrl)
      })});`
    });

    return { ok: true };
  }

  async function helpWithClaude(sender) {
    if (!sender.tab?.windowId) throw new Error("No Sparx tab is available to capture.");

    const screenshotDataUrl = await captureVisibleTab(sender.tab.windowId);
    const claudeTab = await findOrOpenClaudeTab();
    const prompt = "Help me solve this Sparx Maths question. Use the screenshot and explain the answer clearly.";

    if (claudeTab.windowId) await updateWindow(claudeTab.windowId, { focused: true });
    await updateTab(claudeTab.id, { active: true });

    await executeScript(claudeTab.id, {
      code: `(${pasteSparxScreenshotIntoClaude.toString()})(${JSON.stringify({
        dataUrl: screenshotDataUrl,
        bytes: dataUrlToBytes(screenshotDataUrl),
        prompt
      })});`
    });

    return { ok: true };
  }

  function pasteSparxScreenshotIntoClaude(payload) {
    const bytes = new Uint8Array(payload.bytes || []);
    const blob = new Blob([bytes], { type: "image/png" });
    const file = new File([blob], "sparx-question.png", { type: "image/png" });

    function findComposer() {
      return (
        document.querySelector("[contenteditable='true'][data-placeholder]") ||
        document.querySelector("[contenteditable='true'][role='textbox']") ||
        document.querySelector("div.ProseMirror[contenteditable='true']") ||
        document.querySelector("textarea") ||
        document.querySelector("[contenteditable='true']")
      );
    }

    function findSendButton() {
      return (
        document.querySelector("button[aria-label*='Send' i]") ||
        document.querySelector("button[data-testid*='send' i]") ||
        Array.from(document.querySelectorAll("button")).find((button) =>
          /send/i.test(button.textContent || button.ariaLabel || button.className || "")
        )
      );
    }

    function isSendReady(button) {
      if (!button) return false;
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      const style = getComputedStyle(button);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0.35;
    }

    async function waitForSendReady() {
      const start = Date.now();
      while (Date.now() - start < 30000) {
        const button = findSendButton();
        if (isSendReady(button)) return button;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      return null;
    }

    function attachToFileInput() {
      const fileInput = Array.from(document.querySelectorAll("input[type='file']")).find(
        (input) => !input.disabled && !input.closest("[aria-hidden='true']")
      );
      if (!fileInput) return false;

      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    async function pasteAndSend() {
      const composer = findComposer();
      if (!composer) return false;

      composer.focus();
      const attachedByInput = attachToFileInput();
      const clipboardData = new DataTransfer();
      clipboardData.items.add(file);
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData
      });
      const pasteAccepted = composer.dispatchEvent(pasteEvent);

      if (composer.isContentEditable) {
        composer.textContent = payload.prompt;
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: payload.prompt }));
      } else {
        composer.value = payload.prompt;
        composer.dispatchEvent(new Event("input", { bubbles: true }));
      }

      const sendButton = await waitForSendReady();
      if (sendButton) {
        sendButton.click();
      } else {
        composer.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })
        );
      }

      return attachedByInput || pasteAccepted;
    }

    pasteAndSend().then((ok) => {
      if (ok) return;

      const link = document.createElement("a");
      link.href = payload.dataUrl;
      link.download = "sparx-question.png";
      link.textContent = "Sparx screenshot ready. Drop this image into Claude if upload was blocked.";
      link.style.cssText =
        "position:fixed;z-index:2147483647;left:16px;bottom:16px;padding:12px 14px;color:#0f1014;background:#ffe38a;border:1px solid #d6b84d;border-radius:10px;font:14px Arial,sans-serif;";
      document.documentElement.appendChild(link);
    });
  }


  function pasteSparxScreenshotIntoGauth(payload) {
    const bytes = new Uint8Array(payload.bytes || []);
    const blob = new Blob([bytes], { type: "image/png" });
    const file = new File([blob], "sparx-question.png", { type: "image/png" });

    function findQuestionInput() {
      return (
        document.querySelector("input[placeholder*='question' i]") ||
        document.querySelector("input[type='search']") ||
        document.querySelector("textarea") ||
        document.querySelector("[contenteditable='true']")
      );
    }

    function findSubmitButton() {
      return (
        document.querySelector("[class*='submit' i]") ||
        document.querySelector("button[type='submit']") ||
        document.querySelector("button[aria-label*='send' i], button[aria-label*='submit' i]") ||
        Array.from(document.querySelectorAll("button, [role='button']")).find((button) =>
          /send|submit|solve|arrow|search/i.test(button.textContent || button.ariaLabel || button.className || "")
        )
      );
    }

    function findFileInput() {
      return Array.from(document.querySelectorAll("input[type='file']")).find(
        (input) => !input.disabled && !input.closest("[aria-hidden='true']")
      );
    }

    function attachToFileInput() {
      const fileInput = findFileInput();
      if (!fileInput) return false;

      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    async function pasteIntoInput() {
      const input = findQuestionInput();
      if (!input) return false;

      input.focus();
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      });
      input.dispatchEvent(pasteEvent);
      return true;
    }

    async function uploadAndSubmit() {
      const attached = attachToFileInput();
      const pasted = attached ? false : await pasteIntoInput();

      await new Promise((resolve) => setTimeout(resolve, 900));
      const submitButton = findSubmitButton();
      if (submitButton && !submitButton.disabled && submitButton.getAttribute("aria-disabled") !== "true") {
        submitButton.click();
      }

      return attached || pasted;
    }

    uploadAndSubmit().then((ok) => {
      if (ok) return;

      const link = document.createElement("a");
      link.href = payload.dataUrl;
      link.download = "sparx-question.png";
      link.textContent = "Sparx screenshot ready. Drop this image into Gauth if upload was blocked.";
      link.style.cssText =
        "position:fixed;z-index:2147483647;left:16px;bottom:16px;padding:12px 14px;color:#0f1014;background:#ffe38a;border:1px solid #d6b84d;border-radius:10px;font:14px Arial,sans-serif;";
      document.documentElement.appendChild(link);
    });
  }

  function pasteSparxScreenshotIntoChatGpt(payload) {
    const bytes = new Uint8Array(payload.bytes || []);
    const blob = new Blob([bytes], { type: "image/png" });
    const file = new File([blob], "sparx-question.png", { type: "image/png" });

    function findComposer() {
      return (
        document.querySelector("#prompt-textarea") ||
        document.querySelector("[contenteditable='true'][data-testid*='prompt']") ||
        document.querySelector("textarea") ||
        document.querySelector("[contenteditable='true']")
      );
    }

    function findSendButton() {
      return (
        document.querySelector("[data-testid='send-button']") ||
        document.querySelector("#composer-submit-button[aria-label*='Send' i]") ||
        document.querySelector("button[aria-label*='Send' i]") ||
        Array.from(document.querySelectorAll("button")).find((button) => /send/i.test(button.textContent || button.ariaLabel || ""))
      );
    }

    function isSendReady(button) {
      if (!button) return false;
      const label = button.getAttribute("aria-label") || button.ariaLabel || "";
      if (!/send/i.test(label) && !button.matches("[data-testid='send-button']")) return false;
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      const style = getComputedStyle(button);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0.35;
    }

    async function waitForSendReady() {
      const start = Date.now();
      while (Date.now() - start < 30000) {
        const sendButton = findSendButton();
        if (isSendReady(sendButton)) return sendButton;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      return null;
    }

    function attachToFileInput() {
      const fileInput = Array.from(document.querySelectorAll("input[type='file']")).find(
        (input) => !input.disabled && !input.closest("[aria-hidden='true']")
      );
      if (!fileInput) return false;

      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    async function pasteAndSend() {
      const composer = findComposer();
      if (!composer) return false;

      composer.focus();

      const attachedByInput = attachToFileInput();
      const clipboardData = new DataTransfer();
      clipboardData.items.add(file);
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData
      });
      const pasteAccepted = composer.dispatchEvent(pasteEvent);

      if (composer.isContentEditable) {
        composer.textContent = payload.prompt;
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: payload.prompt }));
      } else {
        composer.value = payload.prompt;
        composer.dispatchEvent(new Event("input", { bubbles: true }));
      }

      const sendButton = await waitForSendReady();
      if (sendButton) {
        sendButton.click();
      } else {
        composer.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })
        );
      }

      return attachedByInput || pasteAccepted;
    }

    pasteAndSend().then((ok) => {
      if (ok) return;

      const link = document.createElement("a");
      link.href = payload.dataUrl;
      link.download = "sparx-question.png";
      link.textContent = "Sparx screenshot ready. Drop this image into ChatGPT if paste was blocked.";
      link.style.cssText =
        "position:fixed;z-index:2147483647;left:16px;bottom:16px;padding:12px 14px;color:#0f1014;background:#ffe38a;border:1px solid #d6b84d;border-radius:10px;font:14px Arial,sans-serif;";
      document.documentElement.appendChild(link);
    });
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "SPARX_HELP_WITH_QUESTION") return false;

    const provider = ["chatgpt", "claude"].includes(message.provider) ? message.provider : "gauth";
    const task =
      provider === "chatgpt" ? helpWithSparxQuestion(sender) : provider === "claude" ? helpWithClaude(sender) : helpWithGauth(sender);

    task
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
