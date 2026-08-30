/**
 * ScrollGuard AI – Content Script
 *
 * Extracts all links from the current page as the user scrolls,
 * sends them to the background service worker for risk analysis,
 * and applies inline warnings (highlight + tooltip).
 */

/**
 * Extract all visible links on the page.
 */
function extractLinks() {
  const links = Array.from(document.querySelectorAll("a"))
    .map(a => a.href)
    .filter(href => href && href.startsWith("http"));
  
  if (links.length > 0) {
    chrome.runtime.sendMessage(
      { action: "scanPageLinks", links },
      (results) => {
        if (!results || results.error) {
          console.error("ScrollGuard AI error:", results?.error);
          return;
        }

        // Apply inline warnings
        results.forEach(result => {
          const link = document.querySelector(`a[href="${result.url}"]`);
          if (link) {
            if (result.status === "Dangerous") {
              link.style.borderBottom = "2px solid red";
            } else if (result.status === "Suspicious") {
              link.style.borderBottom = "2px solid orange";
            } else {
              link.style.borderBottom = "none";
            }
            link.title = `ScrollGuard AI: ${result.status} (Risk ${result.score}/100)`;
          }
        });
      }
    );
  }
}

/**
 * Run extraction on page load and throttled scroll events.
 */
window.addEventListener("load", extractLinks);

window.addEventListener("scroll", () => {
  clearTimeout(window._scrollTimer);
  window._scrollTimer = setTimeout(extractLinks, 500);
});
