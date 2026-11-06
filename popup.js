document.getElementById("pingBtn").addEventListener("click", async () => {
  const statusBox = document.getElementById("status-box");
  statusBox.className = "";
  statusBox.textContent = "Probing active tab...";

  try {
    // 1. Resolve active tab in the current window
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      throw new Error("No active tab identified.");
    }

    if (!tab.url || !tab.url.startsWith("https://search.google.com/")) {
      statusBox.className = "err";
      statusBox.textContent = `Target mismatch:\nActive tab is not Google Search Console.\nCurrent URL:\n${tab.url || "unknown"}`;
      return;
    }

    statusBox.textContent = `Probing Tab #${tab.id}...\nURL: ${tab.url.substring(0, 45)}...`;

    // 2. Attempt message transmission
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    } catch (sendErr) {
      // 3. Fallback: If content script was not pre-injected, inject it on-the-fly
      statusBox.textContent += "\nScript not responding. Attempting on-demand injection via chrome.scripting...";

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });

      // Brief delay to allow content script evaluation
      await new Promise(r => setTimeout(r, 200));

      // Retry ping
      response = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    }

    // 4. Output validation
    if (response && response.status === "PONG") {
      statusBox.className = "ok";
      statusBox.textContent = `SUCCESS: Handshake verified!\n\nDetails:\n- Response: ${response.status}\n- Tab ID: ${tab.id}\n- Page Title: "${response.title}"\n- URL Detected in DOM: ${response.url}`;
    } else {
      statusBox.className = "err";
      statusBox.textContent = `WARNING: Unexpected response payload received:\n${JSON.stringify(response, null, 2)}`;
    }
  } catch (error) {
    statusBox.className = "err";
    statusBox.textContent = `ERROR:\n${error.message || error}\n\nTip: Hard-refresh (Ctrl+F5) the GSC tab and verify the extension was reloaded in chrome://extensions.`;
  }
});
