async function getActiveGscTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab identified.");
  if (!tab.url || !tab.url.startsWith("https://search.google.com/")) {
    throw new Error(`Target tab is not GSC:\n${tab.url || "unknown"}`);
  }
  return tab;
}

async function sendTabMessage(tab, payload) {
  try {
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (err) {
    // Dynamic injection if script isn't running
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await new Promise(r => setTimeout(r, 200));
    return await chrome.tabs.sendMessage(tab.id, payload);
  }
}

// Check Handshake
document.getElementById("pingBtn").addEventListener("click", async () => {
  const statusBox = document.getElementById("status-box");
  statusBox.className = "";
  statusBox.textContent = "Probing connection...";

  try {
    const tab = await getActiveGscTab();
    const res = await sendTabMessage(tab, { type: "PING" });
    if (res?.status === "PONG") {
      statusBox.className = "ok";
      statusBox.textContent = `SUCCESS: Handshake verified!\nTab: ${tab.id}\nPage: "${res.title}"`;
    }
  } catch (err) {
    statusBox.className = "err";
    statusBox.textContent = `Ping failed:\n${err.message}`;
  }
});

// Run Step 1: Type URL and Submit
document.getElementById("inspectBtn").addEventListener("click", async () => {
  const statusBox = document.getElementById("status-box");
  const url = document.getElementById("targetUrl").value.trim();

  if (!url) {
    statusBox.className = "err";
    statusBox.textContent = "Please enter a valid URL.";
    return;
  }

  statusBox.className = "";
  statusBox.textContent = `Targeting input for:\n${url}...`;

  try {
    const tab = await getActiveGscTab();
    const res = await sendTabMessage(tab, { type: "SUBMIT_INSPECTION_URL", url });

    if (res?.ok) {
      statusBox.className = "ok";
      statusBox.textContent = `SUCCESS:\n- Element Found: ${res.matchedSelector}\n- Value Applied: ${res.appliedValue}\n- Enter Dispatched: true\n\nObserve GSC tab to verify if the retrieval loader/animation started!`;
    } else {
      statusBox.className = "err";
      statusBox.textContent = `FAILED:\n${res?.error || "Unknown error"}`;
    }
  } catch (err) {
    statusBox.className = "err";
    statusBox.textContent = `Execution Error:\n${err.message}`;
  }
});
