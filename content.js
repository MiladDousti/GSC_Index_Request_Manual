(() => {
  if (globalThis.__GSC_SINGLE_URL_RUNNER__) return;
  globalThis.__GSC_SINGLE_URL_RUNNER__ = true;

  let running = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function searchInput() {
    return (
      document.querySelector('input[role="combobox"][aria-label*="Inspect any URL"]') ||
      document.querySelector('input[role="combobox"][jsname="dSO9oc"]')
    );
  }

  function parseProperty(value) {
    let text = decodeURIComponent(value).trim();
    if (text.toLowerCase().startsWith("sc-domain:")) {
      return { type: "domain", value: text.slice(10).toLowerCase().replace(/\/+$/, "") };
    }
    if (/^https?:\/\//i.test(text)) {
      return { type: "prefix", value: new URL(text).href };
    }
    text = text.replace(/["']/g, "");
    if (/^[a-z0-9.-]+$/i.test(text)) {
      return { type: "domain", value: text.toLowerCase().replace(/\/+$/, "") };
    }
    throw new Error(`Unrecognized GSC property: ${text}`);
  }

  function checkedProperty(targetUrl) {
    const input = searchInput();
    if (!input) throw new Error("GSC inspection input was not found.");

    const urlParams = new URL(location.href).searchParams;
    const fromAddress = urlParams.get("resource_id");

    const label = input.getAttribute("aria-label") || "";
    const match = label.match(/Inspect any URL in\s+["']?([^"']+)["']?/i);
    const fromInput = match ? match[1].trim() : null;

    if (!fromAddress && !fromInput) {
      throw new Error("Could not identify the selected GSC property.");
    }

    const property = fromAddress ? parseProperty(fromAddress) : parseProperty(fromInput);
    const target = new URL(targetUrl);

    let matches = false;
    if (property.type === "domain") {
      const targetHost = target.hostname.toLowerCase();
      matches = targetHost === property.value || targetHost.endsWith(`.${property.value}`);
    } else {
      matches = target.origin === new URL(property.value).origin && target.href.startsWith(property.value);
    }

    if (!matches) {
      throw new Error(`URL (${target.hostname}) does not belong to active GSC property (${property.value}).`);
    }

    return { input, property };
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function getActiveBlockingDialog() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]')).filter(isElementVisible);
    for (const d of dialogs) {
      const text = (d.innerText || "").toLowerCase();
      if (
        text.includes("url not in property") ||
        text.includes("currently selected property") ||
        text.includes("added to a priority crawl queue") ||
        text.includes("indexing requested") ||
        text.includes("quota exceeded") ||
        text.includes("failed")
      ) {
        return d;
      }
    }
    return null;
  }

  function requestButton() {
    return [...document.querySelectorAll('button, div[role="button"], span[role="button"]')].find(el => {
      const text = (el.innerText || el.textContent || "").trim();
      const label = (el.getAttribute("aria-label") || "").trim();
      return isElementVisible(el) && (/^request indexing$/i.test(text) || /^request indexing$/i.test(label));
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
    if (!button) return false;
    clickElement(button);
    return true;
  }

  function submitInspection(input, url) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    input.focus();
    input.click();

    if (setter) setter.call(input, url);
    else input.value = url;

    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };

    for (const t of ["keydown", "keypress", "keyup"]) {
      input.dispatchEvent(new KeyboardEvent(t, opts));
    }
  }

  async function waitForInspection(url) {
    const deadline = Date.now() + 45000;

    while (Date.now() < deadline) {
      await pause(800);

      const dialog = getActiveBlockingDialog();
      if (dialog) {
        const text = dialog.innerText || "";
        if (/url not in property/i.test(text)) {
          dismissDialog(dialog);
          throw new Error("GSC rejected the URL as outside this property.");
        }
      }

      const button = requestButton();
      if (button) {
        if (button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") {
          continue;
        }
        return button;
      }
    }

    throw new Error("Inspection results timed out (45s). 'Request Indexing' button did not appear.");
  }

  async function waitForIndexingResult() {
    const deadline = Date.now() + 75000;

    while (Date.now() < deadline) {
      await pause(1000);

      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]')).filter(isElementVisible);

      for (const d of dialogs) {
        const text = (d.innerText || "").trim();
        const lower = text.toLowerCase();

        // Ignore transient loading/retrieving dialogs
        if (lower.includes("retrieving data") || lower.includes("submitting")) {
          continue;
        }

        if (lower.includes("added to a priority crawl queue") || lower.includes("indexing requested")) {
          const dismissed = dismissDialog(d);
          return { success: true, message: text, dismissed };
        }

        if (/quota|limit reached|failed|could not be indexed/i.test(lower)) {
          dismissDialog(d);
          throw new Error(`GSC rejected request: ${text}`);
        }
      }
    }

    throw new Error("Timeout: No confirmation dialog detected from GSC within 75 seconds.");
  }

  async function runWorkflow({ runId, tabId, url }) {
    const key = `gscRun_${tabId}`;

    async function update(line, status) {
      const state = (await chrome.storage.local.get(key))[key];
      if (!state || state.runId !== runId) return;

      state.lines.push(line);
      if (status) state.status = status;
      await chrome.storage.local.set({ [key]: state });
    }

    try {
      const target = new URL(url);
      const { input, property } = checkedProperty(target.href);

      const lingeringModal = getActiveBlockingDialog();
      if (lingeringModal) {
        dismissDialog(lingeringModal);
        await pause(300);
      }

      await update(`2. OK — Target URL belongs to verified property: ${property.value}`);

      submitInspection(input, target.href);
      await update("3. Inspection dispatched. Awaiting GSC inspection results & Request Indexing button...");

      const button = await waitForInspection(target.href);
      await update("3. OK — URL inspection complete. Request Indexing button found.");

      await pause(800);
      clickElement(button);
      await update("4. Clicked 'Request Indexing'. Awaiting GSC priority queue confirmation...");

      const result = await waitForIndexingResult();
      await update(
        `5. SUCCESS — URL submitted to priority crawl queue (Modal closed: ${result.dismissed}).`,
        "SUCCESS"
      );
    } catch (err) {
      await update(`STOPPED: ${err.message}`, "FAILED");
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GSC_PING") {
      sendResponse({ reply: "PONG" });
      return true;
    }

    if (message?.type === "GSC_RUN_STATUS") {
      sendResponse({ running });
      return true;
    }

    if (message?.type === "GSC_START") {
      if (running) {
        sendResponse({ ok: false, error: "A run is already active in this tab." });
        return true;
      }

      running = true;
      sendResponse({ ok: true });
      void runWorkflow(message);
      return true;
    }
  });
})();
