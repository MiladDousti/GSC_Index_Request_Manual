(() => {
  if (window.__GSC_INSPECTOR_RUNNER_LOADED__) return;
  window.__GSC_INSPECTOR_RUNNER_LOADED__ = true;

  console.log("[GSC-Diagnostic] content.js initialized with property mismatch handler.");

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

  function simulateUserClick(element) {
    element.focus();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    element.dispatchEvent(new MouseEvent("mousedown", opts));
    element.dispatchEvent(new MouseEvent("mouseup", opts));
    element.dispatchEvent(new MouseEvent("click", opts));
  }

  function findPropertyMismatchModal() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]'));
    for (const d of dialogs) {
      const text = (d.innerText || "").toLowerCase();
      if (text.includes("url not in property") || text.includes("currently selected property")) {
        return d;
      }
    }
    return null;
  }

  function findDismissButton(dialog) {
    const buttons = Array.from(dialog.querySelectorAll('button, div[role="button"], span[role="button"]'));
    for (const b of buttons) {
      const text = (b.innerText || b.textContent || "").trim().toLowerCase();
      if (text === "dismiss" || text === "ok" || text === "close") {
        return b;
      }
    }
    return null;
  }

  function findRequestIndexingButton() {
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
    for (const el of candidates) {
      const text = (el.innerText || el.textContent || "").trim();
      const aria = (el.getAttribute("aria-label") || "").trim();

      if (/^request indexing$/i.test(text) || /request indexing/i.test(aria)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== "none") {
          return el;
        }
      }
    }
    return null;
  }

  function findConfirmationDialog() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]'));
    for (const d of dialogs) {
      const text = (d.innerText || "").toLowerCase();
      if (
        text.includes("indexing requested") ||
        text.includes("quota exceeded") ||
        text.includes("indexing failed") ||
        text.includes("can't be indexed") ||
        text.includes("could not be indexed")
      ) {
        return d;
      }
    }
    return null;
  }

  function findGotItButton(dialog) {
    const buttons = Array.from(dialog.querySelectorAll('button, div[role="button"], span[role="button"]'));
    for (const b of buttons) {
      const text = (b.innerText || b.textContent || "").trim().toLowerCase();
      if (text === "got it" || text === "ok" || text === "dismiss" || text === "close") {
        return b;
      }
    }
    return null;
  }

  async function executeRequestIndexingWorkflow() {
    const button = findRequestIndexingButton();
    if (!button) {
      return { ok: false, error: "REQUEST_INDEXING_BUTTON_NOT_FOUND" };
    }

    if (button.getAttribute("aria-disabled") === "true") {
      return { ok: false, error: "BUTTON_IS_DISABLED_BY_GSC" };
    }

    simulateUserClick(button);

    const startTime = Date.now();
    const timeoutMs = 75000;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, 1000));

      const dialog = findConfirmationDialog();
      if (dialog) {
        const dialogText = dialog.innerText || "";
        const lines = dialogText.split("\n").map(s => s.trim()).filter(Boolean);
        const header = lines[0] || "Unknown Dialog";
        const body = lines.slice(1).join(" ");

        let outcome = "NOTICE";
        const lower = dialogText.toLowerCase();
        if (lower.includes("indexing requested") || lower.includes("added to a priority crawl queue")) {
          outcome = "SUCCESS";
        } else if (lower.includes("quota exceeded")) {
          outcome = "QUOTA_EXCEEDED";
        }

        const gotItBtn = findGotItButton(dialog);
        let dismissed = false;
        if (gotItBtn) {
          simulateUserClick(gotItBtn);
          dismissed = true;
        }

        return {
          ok: true,
          outcome,
          dialogHeader: header,
          dialogBody: body,
      dismissed
        };
      }
    }

    return { ok: false, error: "TIMEOUT_WAITING_FOR_INDEXING_MODAL" };
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

        // Check quickly if a property mismatch modal pops up
        setTimeout(() => {
          const mismatchModal = findPropertyMismatchModal();
          if (mismatchModal) {
            const dismissBtn = findDismissButton(mismatchModal);
            if (dismissBtn) simulateUserClick(dismissBtn);
          }
        }, 1500);

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
      // Check if property mismatch modal is blocking
      const mismatchModal = findPropertyMismatchModal();
      if (mismatchModal) {
        sendResponse({
          found: false,
          reason: "URL_NOT_IN_PROPERTY: The URL does not belong to the active GSC property."
        });
        return true;
      }

      const button = findRequestIndexingButton();
      if (!button) {
        sendResponse({
          found: false,
          reason: "No button with text 'Request Indexing' found."
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

    if (message.type === "EXECUTE_REQUEST_INDEXING") {
      executeRequestIndexingWorkflow()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }
  });
})();
