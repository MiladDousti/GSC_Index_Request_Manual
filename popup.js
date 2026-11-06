const input = document.getElementById("urls");
const counter = document.getElementById("counter");
const startButton = document.getElementById("start");
const report = document.getElementById("report");

let tabId = null;
let runKey = null;

function updateCounter() {
  const count = input.value.split(/\r?\n/).filter(line => line.trim()).length;
  counter.textContent = `${count} / 14 URLs`;
}

function parseUrls() {
  const lines = input.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  if (lines.length < 1 || lines.length > 14) {
    throw new Error("Enter between 1 and 14 URLs, one per line.");
  }

  const urls = lines.map((line, index) => {
    let url;
    try {
      url = new URL(line);
    } catch {
      throw new Error(`Line ${index + 1} is not a valid absolute URL.`);
    }

    if (!["http:", "https:"].includes(url.protocol) || !url.hostname ||
        url.username || url.password || url.hash) {
      throw new Error(`Line ${index + 1} must be an HTTP(S) URL without credentials or a fragment.`);
    }

    return url.href;
  });

  if (new Set(urls).size !== urls.length) {
    throw new Error("Remove duplicate URLs before starting.");
  }

  return urls;
}

function render(state) {
  if (!state) {
    report.textContent = "No run started.";
    startButton.disabled = false;
    return;
  }

  const progress = `${state.index} / ${state.urls.length} completed`;
  report.textContent = [
    `Status: ${state.status} — ${progress}`,
    ...state.lines
  ].join("\n");

  startButton.disabled = state.status === "RUNNING";
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url?.startsWith("https://search.google.com/")) {
    report.textContent = "Open a Google Search Console tab first.";
    startButton.disabled = true;
    return;
  }

  tabId = tab.id;
  runKey = `gscRun_${tabId}`;

  const saved = await chrome.storage.local.get(["gscUrlDraft", runKey]);
  input.value = saved.gscUrlDraft || "";
  updateCounter();
  render(saved[runKey]);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[runKey]) {
      render(changes[runKey].newValue);
    }
  });
}

input.addEventListener("input", () => {
  updateCounter();
  void chrome.storage.local.set({ gscUrlDraft: input.value });
});

startButton.addEventListener("click", async () => {
  try {
    const urls = parseUrls();
    const existing = (await chrome.storage.local.get(runKey))[runKey];

    if (existing?.status === "RUNNING") {
      throw new Error("A queue is already running in this tab.");
    }

    const ping = await chrome.tabs.sendMessage(tabId, { type: "GSC_PING" });
    if (ping?.reply !== "PONG") {
      throw new Error("GSC content script did not respond. Refresh the GSC tab.");
    }

    const runId = crypto.randomUUID();
    const state = {
      runId,
      tabId,
      urls,
      index: 0,
      phase: "ready",
      status: "RUNNING",
      lines: ["1. OK — GSC tab and content script are responding."]
    };

    await chrome.storage.local.set({ [runKey]: state });
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "GSC_START",
      tabId,
      runId
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not start the queue.");
    }
  } catch (error) {
    // A GSC navigation immediately after starting can interrupt this reply.
    // The content script will resume from the saved state on the new page.
    const state = runKey && (await chrome.storage.local.get(runKey))[runKey];
    report.textContent = state?.status === "RUNNING"
      ? `${state.lines.join("\n")}\nStart acknowledged or navigation in progress. Reopen this popup to check progress.`
      : `STOPPED: ${error.message}`;
  }
});

void init().catch(error => {
  report.textContent = `STOPPED: ${error.message}`;
});
