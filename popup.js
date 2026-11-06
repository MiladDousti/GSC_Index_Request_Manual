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
      statusBox.textContent = `SUCCESS: Inspection Triggered!\n- Target: ${res.appliedValue}\n\nWait until GSC finishes loading the result page, then click "2. Check 'Request Indexing' Button".`;
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
        `Reason: ${res?.reason || "Element not detected"}`,
        `Is Inspection Loader still active? ${res?.loaderActive ? "YES" : "NO"}`
      ].join("\n");
    }
  } catch (err) {
    statusBox.className = "err";
    statusBox.textContent = `Error:\n${err.message}`;
  }
});
