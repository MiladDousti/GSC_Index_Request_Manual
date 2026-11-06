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
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await new Promise(r => setTimeout(r, 150));
    return await chrome.tabs.sendMessage(tab.id, payload);
  }
}

// Step 1: Type URL and Submit
document.getElementById("inspectBtn").addEventListener("click", async () => {
  const statusBox = document.getElementById("status-box");
  const url = document.getElementById("targetUrl").value.trim();

  if (!url) {
    statusBox.className = "err";
    statusBox.textContent = "Please enter a valid URL.";
    return;
  }

  statusBox.className = "";
  statusBox.textContent = `Submitting:\n${url}...`;

  try {
    const tab = await getActiveGscTab();
    const res = await sendTabMessage(tab, { type: "SUBMIT_INSPECTION_URL", url });

    if (res?.ok) {
      statusBox.className = "ok";
      statusBox.textContent = `SUCCESS: Inspection Triggered!\nTarget: ${res.appliedValue}\n\nWait until GSC finishes loading, then check button or request indexing.`;
    } else {
      statusBox.className = "err";
      statusBox.textContent = `FAILED:\n${res?.error || "Unknown error"}`;
    }
  } catch (err) {
    statusBox.className = "err";
    statusBox.textContent = `Error:\n${err.message}`;
  }
});

// Step 2: Check "Request Indexing" Button
document.getElementById("findRequestBtn").addEventListener("click", async () => {
  const statusBox = document.getElementById("status-box");
  statusBox.className = "";
  statusBox.textContent = "Scanning active DOM for 'Request Indexing' button...";

  try {
    const tab = await getActiveGscTab();
    const res = await sendTabMessage(tab, { type: "FIND_REQUEST_INDEXING_BUTTON" });

    if (res?.found) {
      statusBox.className = "ok";
      statusBox.textContent = [
        "SUCCESS: Button Found!",
        "",
        `Text: "${res.text}"`,
        `Tag: <${res.tag}>`,
        `Role: ${res.role}`,
        `Aria-Disabled: ${res.ariaDisabled}`,
        `Disabled Attribute: ${res.disabledAttr}`,
        `Position: Top=${Math.round(res.rect.top)}px, Left=${Math.round(res.rect.left)}px`
      ].join("\n");
    } else {
      statusBox.className = "err";
      statusBox.textContent = [
        "FAILED: Button not found.",
        "",
        `Reason: ${res?.reason || "Element not detected"}`
      ].join("\n");
    }
  } catch (err) {
    statusBox.className = "err";
    statusBox.textContent = `Error:\n${err.message}`;
  }
});

// Step 3: Click Request Indexing & Await Result
document.getElementById("triggerRequestBtn").addEventListener("click", async () => {
  const statusBox = document.getElementById("status-box");
  statusBox.className = "warn";
  statusBox.textContent = "Dispatching click on 'Request Indexing'...\nWaiting for GSC live test and confirmation dialog (up to 75s)...";

  try {
    const tab = await getActiveGscTab();
    const res = await sendTabMessage(tab, { type: "EXECUTE_REQUEST_INDEXING" });

    if (res?.ok) {
      if (res.outcome === "SUCCESS") {
        statusBox.className = "ok";
        statusBox.textContent = `SUCCESS: Indexing Requested!\n\nOutcome: ${res.outcome}\nHeader: "${res.dialogHeader}"\nBody: "${res.dialogBody}"\nDismissed ("Got it"): ${res.dismissed}`;
      } else if (res.outcome === "QUOTA_EXCEEDED") {
        statusBox.className = "warn";
        statusBox.textContent = `QUOTA HIT: Daily quota reached!\n\nOutcome: ${res.outcome}\nMessage: "${res.dialogBody}"\nDismissed: ${res.dismissed}`;
      } else {
        statusBox.className = "err";
        statusBox.textContent = `COMPLETED WITH NOTICE:\n\nOutcome: ${res.outcome}\nHeader: "${res.dialogHeader}"\nBody: "${res.dialogBody}"`;
      }
    } else {
      statusBox.className = "err";
      statusBox.textContent = `FAILED:\n${res?.error || "Unknown error during indexing request"}`;
    }
  } catch (err) {
    statusBox.className = "err";
    statusBox.textContent = `Execution Error:\n${err.message}`;
  }
});
