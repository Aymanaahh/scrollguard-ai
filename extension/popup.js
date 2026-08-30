/**
 * ScrollGuard AI – Popup Script
 *
 * Allows manual scanning of the current page URL.
 */

document.getElementById("scanBtn").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.url) {
      document.getElementById("results").textContent = "No active tab found.";
      return;
    }

    // Send message to background.js for analysis
    chrome.runtime.sendMessage(
      { action: "scanPageLinks", links: [activeTab.url] },
      (results) => {
        const resultsDiv = document.getElementById("results");
        resultsDiv.innerHTML = "";

        if (!results || results.error) {
          resultsDiv.textContent = "Error: " + (results?.error || "Unknown");
          return;
        }

        results.forEach(result => {
          const p = document.createElement("p");
          p.textContent = `${result.url} → ${result.status} (Risk ${result.score}/100)`;
          p.className = result.status.toLowerCase();
          resultsDiv.appendChild(p);
        });
      }
    );
  });
});
