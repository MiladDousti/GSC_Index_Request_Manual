(() => {
  if (window.__GSC_INSPECTION_TESTER_LOADED__) return;
  window.__GSC_INSPECTION_TESTER_LOADED__ = true;

  console.log("[GSC-Tester] content.js active.");

  function findGscSearchInput() {
    // 1. Primary selector targeting the aria-label pattern discovered
    let input = document.querySelector('input[role="combobox"][aria-label*="Inspect any URL"]');
    if (input) return { element: input, selector: 'input[role="combobox"][aria-label*="Inspect any URL"]' };

    // 2. Secondary fallback via jsaction attribute signature
    input = document.querySelector('input[role="combobox"][jsname="dSO9oc"]');
    if (input) return { element: input, selector: 'input[role="combobox"][jsname="dSO9oc"]' };

    // 3. Fallback: Any visible combobox input in top area
    const candidates = Array.from(document.querySelectorAll('input[type="text"], input[role="combobox"]'));
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      if (rect.top < 150 && aria.includes("inspect")) {
        return { element: el, selector: 'input[top<150][inspect]' };
      }
    }

    return null;
  }

  function setInputValue(input, value) {
    // Invoke prototype setter to trigger Google Closure/Wiz reactivity
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    // Fire standard input and change events
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

    // Also attempt form submission if wrapped in a <form>
    const form = input.closest("form");
    if (form) {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "PING") {
      sendResponse({
        status: "PONG",
        title: document.title,
        url: window.location.href
      });
      return true;
    }

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
          matchedSelector: found.selector,
          appliedValue: input.value
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
      return true;
    }
  });
})();
