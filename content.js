(() => {
  if (globalThis.__GSC_SINGLE_URL_RUNNER__) return;
  globalThis.__GSC_SINGLE_URL_RUNNER__ = true;

  let running = false;

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function searchInput() {
    return document.querySelector(
      'input[role="combobox"][aria-label*="Inspect any URL"]'
    ) || document.querySelector(
      'input[role="combobox"][jsname="dSO9oc"]'
    );
  }

  function parseProperty(value) {
    const text = value.trim();

    if (text.toLowerCase().startsWith("sc-domain:")) {
      return { type: "domain", value: text.slice(10).toLowerCase() };
    }

    if (/^https?:\/\//i.test(text)) {
      return { type: "prefix", value: new URL(text).href };
    }

    // The input label may display a domain property without "sc-domain:".
    if (/^[a-z0-9.-]+$/i.test(text)) {
      return { type: "domain", value: text.toLowerCase() };
    }

    throw new Error(`Unrecognized GSC property: ${text}`);
  }

  function propertyKey(property) {
    return `${property.type}:${property.value}`;
  }

  function checkedProperty(targetUrl) {
    const input = searchInput();
    if (!input) throw new Error("GSC inspection input was not found.");

    const fromAddress = new URL(location.href).searchParams.get("resource_id");
    const label = input.getAttribute("aria-label") || "";
    const fromInput = label.match(/^Inspect any URL in\s+(.+)$/i)?.[1];

    if (!fromAddress && !fromInput) {
      throw new Error("Could not identify the selected GSC property.");
    }

    const addressProperty = fromAddress && parseProperty(fromAddress);
    const inputProperty = fromInput && parseProperty(fromInput);

    if (
      addressProperty &&
      inputProperty &&
      propertyKey(addressProperty) !== propertyKey(inputProperty)
    ) {
      throw new Error(
        "The property shown in the GSC input differs from the page property."
      );
    }

    const property = addressProperty || inputProperty;
    const target = new URL(targetUrl);

    const matches = property.type === "domain"
      ? (
          target.hostname.toLowerCase() === property.value ||
          target.hostname.toLowerCase().endsWith(`.${property.value}`)
        )
      : (
          target.origin === new URL(property.value).origin &&
          target.href.startsWith(property.value)
        );

    if (!matches) {
      throw new Error(
        `URL does not belong to the selected property (${property.value}).`
      );
    }

    return { input, property };
  }

  function visible(element) {
    if (!element || !element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function requestButton() {
    return [...document.querySelectorAll(
      'button, [role="button"]'
    )].find(element => {
      const text = (element.innerText || element.textContent || "").trim();
      const label = (element.getAttribute("aria-label") || "").trim();

      return visible(element) && (
        /^request indexing$/i.test(text) ||
        /^request indexing$/i.test(label)
      );
    });
  }

  function activeDialog() {
    return [...document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"]'
    )].find(visible);
  }

  function clickElement(element) {
    element.focus();

    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    };

    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.dispatchEvent(new MouseEvent("click", options));
  }

  function dismissDialog(dialog) {
    const button = [...dialog.querySelectorAll(
      'button, [role="button"]'
    )].find(element =>
      /^(got it|dismiss|ok|close)$/i.test(
        (element.innerText || element.textContent || "").trim()
      )
    );

    if (!button) return false;
    clickElement(button);
    return true;
  }

  function submitInspection(input, url) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;

    input.focus();
    input.click();

    if (setter) setter.call(input, url);
    else input.value = url;

    input.dispatchEvent(new Event("input", {
      bubbles: true,
      composed: true
    }));

    input.dispatchEvent(new Event("change", {
      bubbles: true
    }));

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
      input.dispatchEvent(new KeyboardEvent(type, options));
    }
  }

  function resultShowsUrl(url) {
    const resultArea = document.querySelector('main, [role="main"]')
      || document.body;

    return (resultArea.innerText || "").includes(url);
  }

  async function waitForInspection(url, previousPage, hadButton) {
    const deadline = Date.now() + 60000;
    let observedLoading = false;
    let buttonDisappeared = false;

    while (Date.now() < deadline) {
      await pause(500);

      const dialog = activeDialog();
      const dialogText = dialog?.innerText || "";

      if (/url not in property|currently selected property/i.test(dialogText)) {
        dismissDialog(dialog);
        throw new Error("GSC rejected the URL as outside this property.");
      }

      const button = requestButton();
      if (hadButton && !button) buttonDisappeared = true;

      if (/retrieving data|inspecting url/i.test(
        document.body.innerText || ""
      )) {
        observedLoading = true;
      }

      const freshResult = (
        location.href !== previousPage ||
        observedLoading ||
        buttonDisappeared ||
        !hadButton
      );

      if (button && freshResult && resultShowsUrl(url)) {
        if (
          button.hasAttribute("disabled") ||
          button.getAttribute("aria-disabled") === "true"
        ) {
          throw new Error("GSC's Request Indexing button is disabled.");
        }

        return button;
      }
    }

    throw new Error(
      "Inspection was not confirmed for this exact URL within 60 seconds; indexing was not requested."
    );
  }

  async function waitForIndexingResult() {
    const deadline = Date.now() + 90000;

    while (Date.now() < deadline) {
      await pause(750);

      const dialog = activeDialog();
      if (!dialog) continue;

      const text = (dialog.innerText || "").trim();
      const lower = text.toLowerCase();

      if (lower.includes("added to a priority crawl queue")) {
        const dismissed = dismissDialog(dialog);
        return { success: true, message: text, dismissed };
      }

      if (
        /quota|limit reached|indexing failed|can't be indexed|could not be indexed/i
          .test(text)
      ) {
        dismissDialog(dialog);
        throw new Error(`GSC did not accept the request: ${text}`);
      }
    }

    throw new Error(
      "No GSC indexing confirmation appeared within 90 seconds."
    );
  }

  async function runWorkflow({ runId, tabId, url }) {
    const key = `gscRun_${tabId}`;

    async function update(line, status) {
      const state = (await chrome.storage.local.get(key))[key];

      // Do not let an older run overwrite a newer run's report.
      if (!state || state.runId !== runId) {
        throw new Error("This run was replaced by another run.");
      }

      state.lines.push(line);
      if (status) state.status = status;
      await chrome.storage.local.set({ [key]: state });
    }

    try {
      const target = new URL(url);
      if (!["http:", "https:"].includes(target.protocol)) {
        throw new Error("Only HTTP and HTTPS URLs are supported.");
      }

      const { input, property } = checkedProperty(target.href);

      if (activeDialog()) {
        throw new Error(
          "A GSC dialog is already open. Close it and start again."
        );
      }

      await update(
        `2. OK — URL matches the selected ${property.type} property: ` +
        property.value
      );

      const previousPage = location.href;
      const hadButton = Boolean(requestButton());

      submitInspection(input, target.href);
      await update("3. Inspection submitted; waiting for this URL's result...");

      const button = await waitForInspection(
        target.href,
        previousPage,
        hadButton
      );

      await update(
        "3. OK — GSC inspection result and enabled indexing button " +
        "found for the requested URL."
      );

      if (activeDialog()) {
        throw new Error("A GSC dialog appeared before indexing could start.");
      }

      clickElement(button);
      await update("4. Request Indexing clicked; waiting for GSC...");

      const result = await waitForIndexingResult();

      await update(
        `5. SUCCESS — GSC added the URL to its priority crawl queue. ` +
        `Confirmation dismissed: ${result.dismissed}.`,
        "SUCCESS"
      );
    } catch (error) {
      try {
        await update(`STOPPED: ${error.message}`, "FAILED");
      } catch (reportError) {
        console.error("Could not save GSC run report:", reportError);
      }
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GSC_PING") {
      sendResponse({ reply: "PONG" });
      return;
    }

    if (message?.type === "GSC_RUN_STATUS") {
      sendResponse({ running });
      return;
    }

    if (message?.type === "GSC_START") {
      if (running) {
        sendResponse({ ok: false, error: "A run is already active." });
        return;
      }

      running = true;
      sendResponse({ ok: true });

      // Continue in the tab; the popup does not need to remain open.
      void runWorkflow(message);
    }
  });
})();
