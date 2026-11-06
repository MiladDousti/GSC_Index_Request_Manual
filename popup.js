async function getActiveGscTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error("No active tab identified.");
  }
  if (!tab.url || !tab.url.startsWith("https://search.google.com/")) {
    throw new Error(`Target tab is not Google Search Console:\n${tab.url || "unknown"}`);
  }
  return tab;
}

async function sendTabMessage(tab, payload) {
  try {
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (err) {
    // Dynamic injection fallback if content script was not loaded yet
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    return await chrome.tabs.sendMessage(tab.id, payload);
  }
}

// Handshake verification
document.getElementById("pingBtn").addEventListener("click", async () => {
  const statusBox = document.getElementById("status-box");
  statusBox.className = "";
  statusBox.textContent = "Probing connection...";

  try {
    const tab = await getActiveGscTab();
    const res = await sendTabMessage(tab, { type: "PING" });
    if (res?.status === "PONG") {
      statusBox.className = "ok";
      statusBox.textContent = `SUCCESS: Handshake verified!\n\nTab ID: ${tab.id}\nPage Title: "${res.title}"\nURL: ${res.url}`;
    }
  } catch (err) {
    statusBox.className = "err";
    statusBox.textContent = `Ping failed:\n${err.message}`;
  }
});

// Element detection verification
document.getElementById("findInputBtn").addEventListener("click", async () => {
  const statusBox = document.getElementById("status-box");
  statusBox.className = "";
  statusBox.textContent = "Scanning active DOM for Inspect URL input element...";

  try {
    const tab = await getActiveGscTab();
    const res = await sendTabMessage(tab, { type: "FIND_INSPECT_INPUT" });

    if (res?.found) {
      statusBox.className = "ok";
      statusBox.textContent = [
        "SUCCESS: Input Element Found!",
        "",
        `Matched Selector: ${res.matchedSelector}`,
        `Tag Name: <${res.tagName.toLowerCase()}>`,
        `Role: ${res.role}`,
        `Aria-Label: "${res.ariaLabel}"`,
        `Classes: .${res.classList.join(".")}`,
        `Visible on Screen: ${res.isVisible}`,
        `Position: Top=${Math.round(res.rect.top)}px, Left=${Math.round(res.rect.left)}px, Width=${Math.round(res.rect.width)}px`
      ].join("\n");
    } else {
      statusBox.className = "err";
      statusBox.textContent = [
        "FAILED: Element not located.",
        "",
        `Reason: ${res?.reason || "Unknown"}`,
        `Candidates Evaluated: ${res?.candidatesScanned ?? 0}`,
        "Ensure the active tab is an open GSC property view."
      ].join("\n");
    }
  } catch (err) {
    statusBox.className = "err";
    statusBox.textContent = `Execution Error:\n${err.message}`;
  }
});
