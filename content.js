(() => {
  if (window.__GSC_INSPECTOR_DIAGNOSTIC_LOADED__) return;
  window.__GSC_INSPECTOR_DIAGNOSTIC_LOADED__ = true;

  console.log("[GSC-Diagnostic] content.js active and initialized.");

  function scanForInspectInput() {
    // Strategy 1: Targeted aria-label pattern from GSC HTML
    const ariaMatch = document.querySelector('input[role="combobox"][aria-label*="Inspect any URL"]');
    if (ariaMatch) {
      return { element: ariaMatch, selector: 'input[role="combobox"][aria-label*="Inspect any URL"]' };
    }

    // Strategy 2: Google internal jsname matching
    const jsnameMatch = document.querySelector('input[role="combobox"][jsname="dSO9oc"]');
    if (jsnameMatch) {
      return { element: jsnameMatch, selector: 'input[role="combobox"][jsname="dSO9oc"]' };
    }

    // Strategy 3: Heuristic scan of top navigation comboboxes
    const candidates = Array.from(document.querySelectorAll('input[type="text"], input[role="combobox"]'));
    for (const el of candidates) {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const rect = el.getBoundingClientRect();
      if (rect.top < 150 && (aria.includes("inspect") || aria.includes("url"))) {
        return { element: el, selector: 'input[top<150][aria*="inspect|url"]' };
      }
    }

    return null;
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

    if (message.type === "FIND_INSPECT_INPUT") {
      const result = scanForInspectInput();

      if (!result) {
        const totalInputs = document.querySelectorAll("input").length;
        sendResponse({
          found: false,
          reason: "No matching element met the inspection criteria.",
          candidatesScanned: totalInputs
        });
        return true;
      }

      const el = result.element;
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== "none";

      sendResponse({
        found: true,
        matchedSelector: result.selector,
        tagName: el.tagName,
        role: el.getAttribute("role") || "none",
        ariaLabel: el.getAttribute("aria-label") || "none",
        classList: Array.from(el.classList),
        isVisible,
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
