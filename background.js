// Lets a content script identify its own tab after a GSC page navigation.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GSC_GET_TAB_ID") {
    sendResponse({ tabId: sender.tab?.id ?? null });
  }
});
