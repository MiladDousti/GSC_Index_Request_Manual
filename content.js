(() => {
  if (globalThis.__GSC_QUEUE_RUNNER__) return;
  globalThis.__GSC_QUEUE_RUNNER__ = true;

  let running = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function searchInput() {
    return (
      document.querySelector('input[role="combobox"][aria-label*="Inspect any URL"]') ||
      document.querySelector('input[role="combobox"][jsname="dSO9oc"]')
    );
  }

  function parseProperty(value) {
    const text = value.trim().replace(/^["']|["']$/g, "");
    if (text.toLowerCase().startsWith("sc-domain:")) {
      return { type: "domain", value: text.slice(10).toLowerCase().replace(/\/+$/, "") };
    }
    if (/^https?:\/\//i.test(text)) return { type: "prefix", value: new URL(text).href };
    if (/^[a-z0-9.-]+$/i.test(text)) return { type: "domain", value: text.toLowerCase() };
    throw new Error(`Unrecognized GSC property: ${text}`);
  }

  function checkedProperty(targetUrl) {
    const input = searchInput();
    if (!input) throw new Error("GSC inspection input was not found.");
    const resourceId = new URL(location.href).searchParams.get("resource_id");
    const label = input.getAttribute("aria-label") || "";
    const labelMatch = label.match(/Inspect any URL in\s+["']?(.+?)["']?$/i);
    const propertyText = resourceId || labelMatch?.[1];
    if (!propertyText) throw new Error("Could not identify the selected GSC property.");
    const property = parseProperty(propertyText);
    const target = new URL(targetUrl);
    let matches;
    if (property.type === "domain") {
      const host = target.hostname.toLowerCase();
      matches = host === property.value || host.endsWith(`.${property.value}`);
    } else {
      matches = target.href.startsWith(property.value);
    }
    if (!matches) throw new Error(`${target.href} does not belong to the selected property (${property.value}).`);
    return { input, property };
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || node.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  }

  function dialogs() {
    return [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(isVisible);
  }

  function isLoading() {
    const text = document.body.innerText || "";
    return dialogs().some(d => /retrieving data|inspecting url|submitting|testing if live url/i.test(d.innerText || "")) ||
           /retrieving data|testing if live url/i.test(text);
  }

  function requestButton() {
    return [...document.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]')].find(element => {
      const text = (element.innerText || element.textContent || "").trim();
      const label = (element.getAttribute("aria-label") || "").trim();
      return isVisible(element) && (/^request indexing$/i.test(text) || /^request indexing$/i.test(label) || text.toLowerCase().includes("request indexing"));
    });
  }

  function clickElement(element) {
    element.focus();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    element.dispatchEvent(new MouseEvent("mousedown", opts));
    element.dispatchEvent(new MouseEvent("mouseup", opts));
    element.dispatchEvent(new MouseEvent("click", opts));
  }

  function dismissDialog(dialog) {
    const button = [...dialog.querySelectorAll('button, div[role="button"], span[role="button"]')].find(el =>
      /^(got it|dismiss|ok|close)$/i.test((el.innerText || el.textContent || "").trim())
    );
    if (!button || !isVisible(button)) return false;
    clickElement(button);
    return true;
  }

  function submitInspection(input, url) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    input.focus(); input.click();
    if (setter) setter.call(input, url); else input.value = url;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    ["keydown", "keypress", "keyup"].forEach(t => input.dispatchEvent(new KeyboardEvent(t, opts)));
  }

  async function waitForInspection(startedAt) {
    const deadline = startedAt + 120000;
    while (Date.now() < deadline) {
      await pause(1000);
      if (isLoading()) continue;
      const button = requestButton();
      if (button && !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true") return button;
    }
    throw new Error("Inspection timed out (120s). Request Indexing button did not appear.");
  }

  async function waitForIndexingResult(startedAt) {
    const deadline = startedAt + 120000;
    while (Date.now() < deadline) {
      await pause(1000);
      if (isLoading()) continue;
      for (const dialog of dialogs()) {
        const text = (dialog.innerText || "").toLowerCase();
        if (text.includes("indexing requested") || text.includes("priority crawl queue")) return { dialog, text };
        if (/quota|limit reached|failed|could not|not eligible|something went wrong/i.test(text)) throw new Error(`GSC Error: ${text}`);
      }
    }
    throw new Error("No priority-crawl-queue confirmation appeared within 120s.");
  }

  async function runQueue(tabId, runId) {
    const key = `gscRun_${tabId}`;
    async function load() {
      const state = (await chrome.storage.local.get(key))[key];
      if (!state || state.runId !== runId || state.status !== "RUNNING") throw new Error("Run inactive.");
      return state;
    }
    async function save(state, patch, line) {
      const current = await load();
      const next = { ...current, ...patch, lines: line ? [...current.lines, line] : current.lines };
      await chrome.storage.local.set({ [key]: next });
      return next;
    }

    try {
      let state = await load();
      while (state.index < state.urls.length) {
        const number = state.index + 1;
        const total = state.urls.length;
        const url = state.urls[state.index];

        if (state.phase === "ready") {
          const { input, property } = checkedProperty(url);
          state = await save(state, { phase: "inspecting", phaseAt: Date.now() }, `${number}/${total} — Inspecting ${url}`);
          submitInspection(input, url);
          continue;
        }

        if (state.phase === "inspecting") {
          const button = await waitForInspection(state.phaseAt);
          state = await save(state, { phase: "await_confirmation", phaseAt: Date.now() }, `${number}/${total} — Inspection complete; submitting request...`);
          clickElement(button);
          continue;
        }

        if (state.phase === "await_confirmation") {
          const result = await waitForIndexingResult(state.phaseAt);
          dismissDialog(result.dialog);
          await pause(2000); // Wait for modal to clear
          const completed = number === total;
          state = await save(state, { index: number, phase: "ready", status: completed ? "COMPLETED" : "RUNNING" }, `${number}/${total} — SUCCESS: Submitted ${url}`);
          if (completed) return;
          continue;
        }
      }
    } catch (error) {
      const current = (await chrome.storage.local.get(key))[key];
      if (current?.runId === runId) {
        await chrome.storage.local.set({ [key]: { ...current, status: "STOPPED", lines: [...current.lines, `STOPPED: ${error.message}`] } });
      }
    } finally { running = false; }
  }

  function start(tabId, runId) {
    if (running) return false;
    running = true;
    void runQueue(tabId, runId);
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "GSC_PING") sendResponse({ reply: "PONG" });
    if (msg?.type === "GSC_START") sendResponse(start(msg.tabId, msg.runId) ? { ok: true } : { ok: false });
  });

  void (async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GSC_GET_TAB_ID" });
      const state = (await chrome.storage.local.get(`gscRun_${res.tabId}`))[`gscRun_${res.tabId}`];
      if (state?.status === "RUNNING") start(res.tabId, state.runId);
    } catch {}
  })();
})();
