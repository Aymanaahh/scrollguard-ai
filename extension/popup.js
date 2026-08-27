document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const urlElement = document.getElementById("currentUrl");
  const scanBtn = document.getElementById("scanBtn");
  const resultDiv = document.getElementById("result");
  const statusTag = document.getElementById("statusTag");
  const riskScore = document.getElementById("riskScore");
  const explanation = document.getElementById("explanation");

  if (tab && tab.url) {
    urlElement.innerText = tab.url;
  } else {
    urlElement.innerText = "Unable to read URL";
  }

  scanBtn.addEventListener("click", async () => {
    scanBtn.innerText = "Analyzing...";
    scanBtn.disabled = true;

    try {
      const response = await fetch("http://127.0.0.1:8000/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: tab.url || "",
          text: tab.title || "",
          platform: "Browser Extension"
        })
      });

      const data = await response.json();

      statusTag.innerText = data.status;
      statusTag.className = `status-tag ${data.status}`;
      riskScore.innerText = `Risk Score: ${data.risk_score} / 100`;
      explanation.innerText = data.explanation;

      resultDiv.style.display = "block";
    } catch (err) {
      alert("Error connecting to backend server. Make sure Uvicorn is running!");
    } finally {
      scanBtn.innerText = "Scan This Page";
      scanBtn.disabled = false;
    }
  });
});