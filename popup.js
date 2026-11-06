const urlInput = document.getElementById("targetUrl");
const startButton = document.getElementById("startBtn");
const reportBox = document.getElementById("report");

let currentKey = null;
let starting = false;

function render(state) {
  reportBox.textContent = state.lines.join("\n");
  startButton.disabled = starting || state.status === "RUNNING";
}

function showError(message) {
  reportBox.textContent = `FAILED: ${message}`;
  startButton.disabled = false;
}

async function saveState(key, state) {
  await chrome.storage.local.set({ [key]: state });
  if (key === currentKey) render(state);
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    // Inject only when there is no content-script receiver.
    if (!/Receiving end does not exist/i.test(error.message)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function getGscTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) throw new Error("No active tab found.");

  const page = new URL(tab.url || "about:blank");
  if (
    page.origin !== "https://search.google.com" ||
    !page.pathname.includes("/search-console")
  ) {
    throw new Error("Open the intended Google Search Console tab first.");
  }

  return tab;
}

async function restoreReport() {
  try {
    const tab = await getGscTab();
    currentKey = `gscRun_${tab.id}`;

    const stored = (await chrome.storage.local.get(currentKey))[currentKey];
    if (!stored) return;

    urlInput.value = stored.url;
    render(stored);

    // A tab reload can terminate an in-progress content script.
    if (stored.status === "RUNNING") {
      const response = await sendToTab(tab.id, { type: "GSC_RUN_STATUS" });

      if (!response?.running) {
        stored.status = "INTERRUPTED";
        stored.lines.push(
          "STOPPED: The previous run is no longer active. Check GSC before starting again."
        );
        await saveState(currentKey, stored);
      }
    }
  } catch {
    // The popup can still display a fresh error when Start is clicked.
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && currentKey && changes[currentKey]?.newValue) {
    render(changes[currentKey].newValue);
  }
});

startButton.addEventListener("click", async () => {
  if (starting) return;
  starting = true;
  startButton.disabled = true;

  let state;

  try {
    const target = new URL(urlInput.value.trim());

    if (!["http:", "https:"].includes(target.protocol)) {
      throw new Error("Enter an HTTP or HTTPS URL.");
    }

    reportBox.textContent = "1. Checking the GSC tab and content script...";

    const tab = await getGscTab();
    currentKey = `gscRun_${tab.id}`;

    const existing = (await chrome.storage.local.get(currentKey))[currentKey];
    if (existing?.status === "RUNNING") {
      const status = await sendToTab(tab.id, { type: "GSC_RUN_STATUS" });
      if (status?.running) {
        throw new Error("A run is already active in this GSC tab.");
      }
    }

    state = {
      runId: crypto.randomUUID(),
      tabId: tab.id,
      url: target.href,
      status: "RUNNING",
      lines: ["1. Checking the GSC tab and content script..."]
    };
    await saveState(currentKey, state);

    const ping = await sendToTab(tab.id, { type: "GSC_PING" });
    if (ping?.reply !== "PONG") {
      throw new Error("GSC tab is open, but the content script did not respond.");
    }

    state.lines[0] = "1. OK — GSC tab and content script are responding.";
    await saveState(currentKey, state);

    const started = await sendToTab(tab.id, {
      type: "GSC_START",
      runId: state.runId,
      tabId: tab.id,
      url: target.href
    });

    if (!started?.ok) {
      throw new Error(started?.error || "Could not start the workflow.");
    }
  } catch (error) {
    if (state && currentKey) {
      state.status = "FAILED";
      state.lines.push(`STOPPED: ${error.message}`);
      await saveState(currentKey, state);
    } else {
      showError(error.message);
    }
  } finally {
    starting = false;
    if (currentKey) {
      const saved = (await chrome.storage.local.get(currentKey))[currentKey];
      if (saved) render(saved);
    } else {
      startButton.disabled = false;
    }
  }
});

restoreReport();
