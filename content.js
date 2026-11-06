(() => {
  if (window.__GSC_INSPECTOR_RUNNER_LOADED__) return;
  window.__GSC_INSPECTOR_RUNNER_LOADED__ = true;

  console.log("[GSC-Diagnostic] content.js initialized.");

  function findGscSearchInput() {
    let input = document.querySelector('input[role="combobox"][aria-label*="Inspect any URL"]');
    if (input) return { element: input, selector: 'input[role="combobox"][aria-label*="Inspect any URL"]' };

    input = document.querySelector('input[role="combobox"][jsname="dSO9oc"]');
    if (input) return { element: input, selector: 'input[role="combobox"][jsname="dSO9oc"]' };

    return null;
  }

  function setInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchEnter(input) {
    const enterParams = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };

    input.dispatchEvent(new KeyboardEvent("keydown", enterParams));
    input.dispatchEvent(new KeyboardEvent("keypress", enterParams));
    input.dispatchEvent(new KeyboardEvent("keyup", enterParams));
  }

  function isLoaderVisible() {
    // Check if the "Retrieving data from Google index" dialog or progress bar is currently visible
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="progressbar"], div'));
    return dialogs.some(el => {
      const text = (el.innerText || "").toLowerCase();
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== "none";
      return isVisible && (text.includes("retrieving data") || text.includes("testing live url"));
    });
  }

  function findRequestIndexingButton() {
    // Scan buttons and div/span elements with role="button"
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));

    for (const el of candidates) {
      const text = (el.innerText || el.textContent || "").trim();
      const aria = (el.getAttribute("aria-label") || "").trim();

      // Look for the exact button phrase
      if (/request indexing/i.test(text) || /request indexing/i.test(aria)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== "none") {
          return el;
        }
      }
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "SUBMIT_INSPECTION_URL") {
      try {
        const found = findGscSearchInput();
        if (!found) {
          sendResponse({ ok: false, error: "INPUT_NOT_FOUND" });
          return true;
        }

        const input = found.element;
        input.focus();
        input.click();

        setInputValue(input, message.url);
        dispatchEnter(input);

        sendResponse({
          ok: true,
          appliedValue: input.value
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
      return true;
    }

    if (message.type === "FIND_REQUEST_INDEXING_BUTTON") {
      const loaderActive = isLoaderVisible();
      const button = findRequestIndexingButton();

      if (!button) {
        sendResponse({
          found: false,
          loaderActive,
          reason: loaderActive ? "Page is still loading inspection data." : "No button with text 'Request Indexing' found."
        });
        return true;
      }

      const rect = button.getBoundingClientRect();
      sendResponse({
        found: true,
        text: button.innerText.trim(),
        tag: button.tagName.toLowerCase(),
        role: button.getAttribute("role") || "native-button",
        ariaDisabled: button.getAttribute("aria-disabled") || "false",
        disabledAttr: button.hasAttribute("disabled"),
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        }
      });
      return true;
    }
  });
})();
