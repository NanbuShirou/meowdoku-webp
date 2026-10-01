"use strict";

// MeowDoku gameplay record maintenance.
// Canonical star storage stays in one object because game.js already separates
// normal and hard entries by key format:
//   normal: "6:1", "12:372", ...
//   hard:   "hard:1", "hard:372", ...
// 2.0 intentionally uses a new record namespace; 1.x records are not migrated.
(function () {
  const NORMAL_SCOPE = "normal";
  const HARD_SCOPE = "hard";
  const DONE_KEY = "meowdoku_done_v2";
  const LEGACY_DONE_KEY = "meowdoku_done";
  const LEGACY_HARD_DONE_KEY = "meowdoku_done_hard";
  const LEGACY_ACTIVE_SCOPE_KEY = "meowdoku_active_level_scope";

  let activeScope = NORMAL_SCOPE;

  function setActiveScope(scope) {
    activeScope = scope === HARD_SCOPE ? HARD_SCOPE : NORMAL_SCOPE;
  }

  function currentScope() {
    // Prefer the actual game selection state when available.
    try {
      if (typeof state !== "undefined" && state?.selectionMode === "hard") return HARD_SCOPE;
      if (typeof state !== "undefined" && state?.selectionMode === "fixed") return NORMAL_SCOPE;
    } catch { }

    // The selector itself also carries an explicit hard-mode class/title.
    try {
      const screen = document.getElementById("screen-select");
      if (screen?.classList.contains("hard-level-select")) return HARD_SCOPE;
      const title = document.getElementById("fixed-select-title")?.textContent || "";
      if (title.includes("高難")) return HARD_SCOPE;
      if (title.includes("一般")) return NORMAL_SCOPE;
    } catch { }

    return activeScope;
  }

  // Capture the mode choice before game.js handles the same click.
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    if (target.id === "btn-mode-hard") setActiveScope(HARD_SCOPE);
    else if (target.id === "btn-mode-fixed" || target.id === "btn-mode-random") setActiveScope(NORMAL_SCOPE);
  }, true);

  function rawStorageKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key != null) keys.push(key);
      }
    } catch { }
    return keys;
  }

  function isGameRecordForDeletion(key) {
    if (key === DONE_KEY || key === LEGACY_DONE_KEY || key === LEGACY_HARD_DONE_KEY) return true;
    if (key === LEGACY_ACTIVE_SCOPE_KEY) return true;
    if (key === "meowdoku_random_times" || key === "meowdoku_random_times_v2") return true;
    if (key === "meowdoku_random_scores" || key === "meowdoku_random_scores_v2") return true;
    if (key === "meowdoku_history" || key === "meowdoku_history_v2") return true;

    // Current mid-game save keys.
    if (/^meowdoku_save_(?:fixed|hard)_/i.test(key)) return true;

    // Older compatibility names used by previous builds.
    if (/^meowdoku_.*(?:progress|checkpoint|resume|saved_game|save_game|level_state|game_state)/i.test(key)) return true;
    return false;
  }

  function clearAllGameRecords() {
    const keys = rawStorageKeys().filter(isGameRecordForDeletion);
    keys.forEach((key) => {
      try { localStorage.removeItem(key); } catch { }
    });
    return keys.length;
  }

  function refreshRecordUi() {
    try {
      if (typeof globalThis.refreshDoneMarks === "function") globalThis.refreshDoneMarks();
    } catch { }
    try {
      if (typeof globalThis.renderRandomSizeButtons === "function") globalThis.renderRandomSizeButtons();
    } catch { }
    try {
      globalThis.MeowdokuRandomScore?.refresh?.();
    } catch { }
    try {
      globalThis.renderGameHistory?.();
    } catch { }
  }

  const deleteButton = document.getElementById("btn-delete-game-records");
  const deleteModal = document.getElementById("delete-game-records-modal");
  const cancelButton = document.getElementById("btn-delete-game-records-cancel");
  const confirmButton = document.getElementById("btn-delete-game-records-confirm");

  function closeDeleteModal() {
    deleteModal?.classList.add("hidden");
  }

  deleteButton?.addEventListener("click", () => {
    deleteModal?.classList.remove("hidden");
  });
  cancelButton?.addEventListener("click", closeDeleteModal);
  deleteModal?.addEventListener("click", (event) => {
    if (event.target === deleteModal) closeDeleteModal();
  });
  confirmButton?.addEventListener("click", () => {
    clearAllGameRecords();
    closeDeleteModal();
    refreshRecordUi();
  });

  globalThis.MeowdokuRecordScope = Object.freeze({
    get scope() { return currentScope(); },
    setNormal() { setActiveScope(NORMAL_SCOPE); },
    setHard() { setActiveScope(HARD_SCOPE); },
    clearAllGameRecords,
  });
})();
