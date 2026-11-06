/**
 * Diagnostic content script for Google Search Console handshake verification.
 */
(() => {
  // Prevent duplicate execution if re-injected
  if (window.__GSC_DIAGNOSTIC_LOADED__) {
    return;
  }
  window.__GSC_DIAGNOSTIC_LOADED__ = true;

  console.log("[GSC-Diagnostic] content.js loaded on:", window.location.href);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "PING") {
      sendResponse({
        status: "PONG",
        title: document.title,
        url: window.location.href,
        readyState: document.readyState
      });
      return true; // Keep message channel open for async response
    }
  });
})();
