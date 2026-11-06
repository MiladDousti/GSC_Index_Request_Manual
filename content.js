(() => {
  if (globalThis.__GSC_QUEUE_RUNNER__) return;
  globalThis.__GSC_QUEUE_RUNNER__ = true;

  const INSPECTION_TIMEOUT_MS = 120_000;
  const CONFIRMATION_TIMEOUT_MS = 120_000;
  const POLL_MS = 500;

  let running = false;

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function searchInput() {
    return (
      document.querySelector(
        'input[role="combobox"][aria-label*="Inspect any URL"]'
      ) ||
      document.querySelector(
        'input[role="combobox"][jsname="dSO9oc"]'
      )
    );
  }

  function parseProperty(value) {
    const text = value.trim().replace(/^["']|["']$/g, "");

    if (text.toLowerCase().startsWith("sc-domain:")) {
      return {
        type: "domain",
        value: text.slice(10).toLowerCase().replace(/\/+$/, "")
      };
    }

    if (/^https?:\/\//i.test(text)) {
      return { type: "prefix", value: new URL(text).href };
    }

    if (/^[a-z0-9.-]+$/i.test(text)) {
      return { type: "domain", value: text.toLowerCase() };
    }

    throw new Error(`Unrecognized GSC property: ${text}`);
  }

  function checkedProperty(targetUrl) {
    const input = searchInput();

    if (!input) {
      throw new Error("GSC inspection input was not found.");
    }

    const resourceId = new URL(location.href).searchParams.get(
      "resource_id"
    );

    const label = input.getAttribute("aria-label") || "";
    const labelMatch = label.match(
      /Inspect any URL in\s+["']?(.+?)["']?$/i
    );

    const propertyText = resourceId || labelMatch?.[1];

    if (!propertyText) {
      throw new Error(
        "Could not identify the selected GSC property."
      );
    }

    const property = parseProperty(propertyText);
    const target = new URL(targetUrl);

    const matches =
      property.type === "domain"
        ? target.hostname.toLowerCase() === property.value ||
          target.hostname
            .toLowerCase()
            .endsWith(`.${property.value}`)
        : target.href.startsWith(property.value);

    if (!matches) {
      throw new Error(
        `${target.href} does not belong to the selected property (${property.value}).`
      );
    }

    return { input, property };
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    for (
      let node = element;
      node instanceof Element;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        node.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }
    }

    return true;
  }

  function visibleDialogs() {
    return [
      ...document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"], [aria-modal="true"]'
      )
    ].filter(isVisible);
  }

  function isLoading() {
    const loadingText =
      /retrieving data|inspecting url|submitting|testing if live url/i;

    if (
      visibleDialogs().some(dialog =>
        loadingText.test(dialog.innerText || "")
      )
    ) {
      return true;
    }

    return loadingText.test(document.body?.innerText || "");
  }

  function requestButton() {
    return [
      ...document.querySelectorAll(
        'button, a, div[role="button"], span[role="button"]'
      )
    ].find(element => {
      if (!isVisible(element)) return false;

      const text = (
        element.innerText ||
        element.textContent ||
        ""
      ).trim();

      const label = (
        element.getAttribute("aria-label") || ""
      ).trim();

      return (
        /request indexing/i.test(text) ||
        /request indexing/i.test(label)
      );
    });
  }

  function isEnabled(element) {
    return (
      element &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-disabled") !== "true"
    );
  }

  function clickElement(element) {
    element.focus?.();
    element.click();
  }

  function inspectedUrl() {
    const id = new URL(location.href).searchParams.get("id");

    if (!id) return null;

    try {
      return new URL(id).href;
    } catch {
      return null;
    }
  }

  function sameUrl(a, b) {
    if (!a || !b) return false;

    try {
      return new URL(a).href === new URL(b).href;
    } catch {
      return false;
    }
  }

  /*
   * Find the visible confirmation itself, rather than searching all
   * page text. The heading and crawl-queue message must occur inside
   * the same reasonably small UI container.
   */
  function successOverlay() {
    if (!document.body) return null;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;

      if (
        !/^\s*indexing requested\s*$/i.test(
          node.textContent || ""
        )
      ) {
        continue;
      }

      let element = node.parentElement;

      if (!isVisible(element)) continue;

      while (
        element &&
        element !== document.body &&
        element !== document.documentElement
      ) {
        const text = element.innerText || "";

        if (
          text.length <= 1200 &&
          /indexing requested/i.test(text) &&
          /priority crawl queue/i.test(text) &&
          isVisible(element)
        ) {
          return element;
        }

        element = element.parentElement;
      }
    }

    return null;
  }

  function dismissSuccess(overlay) {
    const control = [
      ...overlay.querySelectorAll(
        'button, a, [role="button"]'
      )
    ].find(element => {
      const text = (
        element.innerText ||
        element.textContent ||
        element.getAttribute("aria-label") ||
        ""
      ).trim();

      return (
        isVisible(element) &&
        /^(dismiss|got it|ok|close)$/i.test(text)
      );
    });

    if (!control) return false;

    clickElement(control);
    return true;
  }

  async function waitForSuccessToClose() {
    const deadline = Date.now() + 8000;

    while (Date.now() < deadline) {
      if (!successOverlay()) return true;
      await pause(250);
    }

    return !successOverlay();
  }

  function blockingError() {
    const errorPattern =
      /quota|limit reached|request failed|failed to send|couldn't be sent|could not be sent|something went wrong|url not in property/i;

    for (const dialog of visibleDialogs()) {
      const text = (dialog.innerText || "").trim();

      if (errorPattern.test(text)) {
        return text.slice(0, 350);
      }
    }

    return null;
  }

  function submitInspection(input, url) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;

    input.focus();
    input.click();

    if (setter) {
      setter.call(input, url);
    } else {
      input.value = url;
    }

    input.dispatchEvent(
      new Event("input", {
        bubbles: true,
        composed: true
      })
    );

    input.dispatchEvent(
      new Event("change", { bubbles: true })
    );

    const options = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };

    for (const type of ["keydown", "keypress", "keyup"]) {
      input.dispatchEvent(
        new KeyboardEvent(type, options)
      );
    }
  }

  async function waitForInspection(startedAt, url) {
    const deadline = startedAt + INSPECTION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const error = blockingError();

      if (error) {
        throw new Error(`GSC error: ${error}`);
      }

      const button = requestButton();
      const displayedUrl = inspectedUrl();

      if (
        !isLoading() &&
        button &&
        isEnabled(button) &&
        (!displayedUrl || sameUrl(displayedUrl, url))
      ) {
        return button;
      }

      await pause(POLL_MS);
    }

    throw new Error(
      "Inspection timed out (120s). Request Indexing button did not appear for this URL."
    );
  }

  async function waitForIndexingResult(startedAt) {
    const deadline = startedAt + CONFIRMATION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      // Check success FIRST: GSC may still display a loading phrase
      // elsewhere when its success confirmation becomes visible.
      const success = successOverlay();
      if (success) return success;

      const error = blockingError();
      if (error) {
        throw new Error(`GSC error: ${error}`);
      }

      await pause(POLL_MS);
    }

    throw new Error(
      "No indexing-request confirmation appeared within 120s."
    );
  }

  async function runQueue(tabId, runId) {
    const key = `gscRun_${tabId}`;

    async function load() {
      const stored = (await chrome.storage.local.get(key))[key];

      if (
        !stored ||
        stored.runId !== runId ||
        stored.status !== "RUNNING"
      ) {
        throw new Error("Run inactive.");
      }

      return stored;
    }

    async function save(patch, line) {
      const current = await load();

      const next = {
        ...current,
        ...patch,
        lines: line
          ? [...(current.lines || []), line]
          : current.lines || []
      };

      await chrome.storage.local.set({ [key]: next });
      return next;
    }

    async function recordConfirmed(state, number, total, url) {
      const completed = number === total;

      // Persist confirmation before trying to dismiss it.
      const next = await save(
        {
          index: number,
          phase: "ready",
          status: completed ? "COMPLETED" : "RUNNING"
        },
        `${number}/${total} — SUCCESS: GSC confirmed indexing request for ${url}`
      );

      const overlay = successOverlay();

      if (overlay) {
        dismissSuccess(overlay);
      }

      if (!completed && !(await waitForSuccessToClose())) {
        throw new Error(
          "Request confirmed, but the confirmation could not be dismissed. Queue paused before the next URL."
        );
      }

      return next;
    }

    try {
      let state = await load();

      while (state.index < state.urls.length) {
        const number = state.index + 1;
        const total = state.urls.length;
        const url = state.urls[state.index];

        if (state.phase === "ready") {
          const { input, property } =
            checkedProperty(url);

          const existingSuccess = successOverlay();

          if (existingSuccess) {
            if (sameUrl(inspectedUrl(), url)) {
              // A previous run may have timed out after GSC
              // confirmed this exact URL. Don't submit it twice
              // while that confirmation is still visible.
              state = await recordConfirmed(
                state,
                number,
                total,
                url
              );
              continue;
            }

            dismissSuccess(existingSuccess);

            if (!(await waitForSuccessToClose())) {
              throw new Error(
                "A previous URL's confirmation is still open. Dismiss it before continuing."
              );
            }
          }

          state = await save(
            {
              phase: "inspecting",
              phaseAt: Date.now()
            },
            `${number}/${total} — Property OK (${property.value}); inspecting ${url}`
          );

          submitInspection(input, url);
          continue;
        }

        if (state.phase === "inspecting") {
          const button = await waitForInspection(
            state.phaseAt,
            url
          );

          state = await save(
            {
              phase: "await_confirmation",
              phaseAt: Date.now()
            },
            `${number}/${total} — Inspection complete; submitting request...`
          );

          clickElement(button);
          continue;
        }

        if (state.phase === "await_confirmation") {
          await waitForIndexingResult(state.phaseAt);

          state = await recordConfirmed(
            state,
            number,
            total,
            url
          );

          continue;
        }

        throw new Error(
          `Unknown queue phase: ${state.phase}`
        );
      }
    } catch (error) {
      try {
        const current =
          (await chrome.storage.local.get(key))[key];

        if (
          current?.runId === runId &&
          current.status === "RUNNING"
        ) {
          await chrome.storage.local.set({
            [key]: {
              ...current,
              status: "STOPPED",
              lines: [
                ...(current.lines || []),
                `STOPPED: ${error.message}`
              ]
            }
          });
        }
      } catch (storageError) {
        console.error(
          "Could not save GSC queue error:",
          storageError
        );
      }
    } finally {
      running = false;
    }
  }

  function start(tabId, runId) {
    if (running) return false;

    running = true;
    void runQueue(tabId, runId);
    return true;
  }

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message?.type === "GSC_PING") {
        sendResponse({ reply: "PONG" });
      }

      if (message?.type === "GSC_START") {
        sendResponse(
          start(message.tabId, message.runId)
            ? { ok: true }
            : { ok: false }
        );
      }
    }
  );

  void (async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GSC_GET_TAB_ID"
      });

      if (response?.tabId == null) return;

      const key = `gscRun_${response.tabId}`;
      const state =
        (await chrome.storage.local.get(key))[key];

      if (state?.status === "RUNNING") {
        start(response.tabId, state.runId);
      }
    } catch (error) {
      console.error(
        "Could not resume GSC queue:",
        error
      );
    }
  })();
})();
