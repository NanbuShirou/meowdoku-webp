"use strict";

(() => {
  const screen = document.getElementById("screen-settings");
  const page1 = document.getElementById("settings-page-1");
  const page2 = document.getElementById("settings-page-2");
  const nextButton = document.getElementById("btn-settings-next");
  const backButton = document.getElementById("btn-settings-back");

  if (!screen || !page1 || !page2 || !nextButton || !backButton) return;

  let currentPage = 1;

  function showPage(page) {
    currentPage = Math.max(1, Math.min(2, page));
    page1.classList.toggle("hidden", currentPage !== 1);
    page2.classList.toggle("hidden", currentPage !== 2);
    screen.dataset.settingsPage = String(currentPage);
    nextButton.setAttribute("aria-hidden", currentPage === 2 ? "true" : "false");
    nextButton.tabIndex = currentPage === 2 ? -1 : 0;
  }

  nextButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showPage(currentPage + 1);
  });

  globalThis.meowdokuPreviousSettingsPage = () => {
    if (currentPage === 1) return false;
    showPage(currentPage - 1);
    return true;
  };

  // On page 2 the normal Back button first returns to the previous settings page.
  // On page 1 we deliberately let the app's existing Back handler run.
  backButton.addEventListener("click", (event) => {
    if (!globalThis.meowdokuPreviousSettingsPage()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // Every fresh visit to Settings starts from page 1, regardless of where the
  // user left the two-page view previously.
  const observer = new MutationObserver(() => {
    if (!screen.classList.contains("hidden")) showPage(1);
  });
  observer.observe(screen, { attributes: true, attributeFilter: ["class"] });

  showPage(1);
})();
