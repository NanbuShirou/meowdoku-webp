"use strict";

// MeowDoku fixed-level selection UI refinement.
// Keeps the existing game/progress data model, and changes only presentation
// plus the stage focus interaction requested by the mobile UI.
(function () {
  const sizeButtons = document.getElementById("size-buttons");
  const stageButtons = document.getElementById("stage-buttons");
  const levelButtons = document.getElementById("level-buttons");
  const randomSizeButtons = document.getElementById("random-size-buttons");

  if (!sizeButtons || !stageButtons || !levelButtons) return;

  function gameState() {
    try {
      return (typeof state !== "undefined" && state) ? state : null;
    } catch {
      return null;
    }
  }

  function currentRecordScope() {
    // Hard mode is a separate selection mode, not a board-size variant.
    // Prefer the real game state, then fall back to the selector UI/helper.
    try {
      const gs = gameState();
      if (gs?.selectionMode === "hard") return "hard";
      if (gs?.selectionMode === "fixed") return "normal";
    } catch { }

    try {
      const screen = document.getElementById("screen-select");
      if (screen?.classList.contains("hard-level-select")) return "hard";
      const title = document.getElementById("fixed-select-title")?.textContent || "";
      if (title.includes("高難")) return "hard";
      if (title.includes("一般")) return "normal";
    } catch { }

    try {
      return globalThis.MeowdokuRecordScope?.scope === "hard" ? "hard" : "normal";
    } catch {
      return "normal";
    }
  }

  function readStars() {
    // game.js already keeps normal and hard records separate by entry key:
    // normal = "n:level", hard = "hard:level". Both live in the v2 store.
    try {
      const raw = JSON.parse(localStorage.getItem("meowdoku_done_v2") || "{}");
      if (Array.isArray(raw)) {
        const migrated = {};
        raw.forEach((key) => { migrated[key] = 1; });
        return migrated;
      }
      return (raw && typeof raw === "object") ? raw : {};
    } catch {
      return {};
    }
  }

  function normalizeSizeButtons() {
    [...sizeButtons.querySelectorAll("button")].forEach((button) => {
      let n = Number(button.dataset.size);
      if (!Number.isInteger(n)) {
        const match = String(button.textContent || "").match(/(\d{1,2})/);
        n = match ? Number(match[1]) : NaN;
      }
      if (!Number.isInteger(n)) return;

      button.dataset.size = String(n);
      button.textContent = String(n);
    });

    syncSelectedSize();
  }

  function syncSelectedSize() {
    const current = Number(gameState()?.n);
    [...sizeButtons.querySelectorAll("button[data-size]")].forEach((button) => {
      button.classList.toggle("selected", Number(button.dataset.size) === current);
    });
  }

  function normalizeRandomSizeButtons() {
    if (!randomSizeButtons) return;

    [...randomSizeButtons.querySelectorAll(".random-size-button")].forEach((button) => {
      if (button.classList.contains("share-code-import-button")) return;
      const strong = button.querySelector("strong");
      if (!strong) return;

      const text = String(strong.textContent || "").trim();
      const match = text.match(/^(\d{1,2})\s*(?:[x×X]\s*\1)?$/);
      if (!match) return;
      if (strong.textContent !== match[1]) strong.textContent = match[1];
    });
  }

  function renderedLevelRange(start) {
    const levels = [...levelButtons.querySelectorAll(".level-button[data-level]")]
      .map((button) => Number(button.dataset.level))
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
    if (!levels.length || levels[0] !== Number(start)) return null;
    return { start: levels[0], end: levels[levels.length - 1], total: levels.length };
  }

  function hardLevelCount() {
    const gs = gameState();
    const candidates = [gs?.hardLevelCount, gs?.hardCount];
    try {
      if (typeof HARD_LEVEL_COUNT !== "undefined") candidates.push(HARD_LEVEL_COUNT);
    } catch { }
    const found = candidates.map(Number).find((value) => Number.isInteger(value) && value > 0);
    return found || 700;
  }

  function stageRange(start) {
    const rendered = renderedLevelRange(start);
    if (rendered) return rendered;

    const safeStart = Number(start);
    if (currentRecordScope() === "hard") {
      const starts = [...stageButtons.querySelectorAll(".stage-button[data-stage-start]")]
        .map((button) => Number(button.dataset.stageStart))
        .filter(Number.isInteger)
        .sort((a, b) => a - b);
      const position = starts.indexOf(safeStart);
      const nextStart = position >= 0 ? starts[position + 1] : null;
      const end = nextStart ? nextStart - 1 : Math.min(safeStart + 99, hardLevelCount());
      return { start: safeStart, end, total: Math.max(0, end - safeStart + 1) };
    }

    const gs = gameState();
    const n = Number(gs?.n);
    const count = Number(gs?.sizes?.[n] ?? gs?.sizes?.[String(n)] ?? 0);
    const end = Math.min(safeStart + 99, count || safeStart + 99);
    return { start: safeStart, end, total: Math.max(0, end - safeStart + 1) };
  }

  function getStageStats(start) {
    const gs = gameState();
    const n = Number(gs?.n);
    const hard = currentRecordScope() === "hard";
    const range = stageRange(start);
    const stars = readStars();
    let earnedStars = 0;
    let cleared = 0;

    for (let level = range.start; level <= range.end; level++) {
      const key = hard ? `hard:${level}` : `${n}:${level}`;
      const value = Math.max(0, Math.min(3, Number(stars[key]) || 0));
      earnedStars += value;
      if (value > 0) cleared++;
    }

    const maxStars = range.total * 3;
    const progressPercent = range.total > 0 ? Math.round((cleared / range.total) * 100) : 0;
    return { ...range, earnedStars, maxStars, cleared, progressPercent };
  }

  function ensureStageSummary() {
    let summary = document.getElementById("stage-progress-summary");
    if (summary) return summary;

    summary = document.createElement("div");
    summary.id = "stage-progress-summary";
    summary.className = "stage-progress-summary hidden";
    summary.setAttribute("aria-live", "polite");
    summary.innerHTML = `
      <span id="stage-star-total" class="stage-star-total">★ 0 / 300</span>
      <div class="stage-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div id="stage-progress-fill" class="stage-progress-fill"></div>
      </div>
      <span id="stage-clear-total" class="stage-clear-total">進度 0 / 100</span>
    `;

    // Keep the selected stage and its progress on the same grid row.
    stageButtons.appendChild(summary);
    return summary;
  }

  function hideStageSummary() {
    const summary = document.getElementById("stage-progress-summary");
    if (summary) summary.classList.add("hidden");
  }

  function showStageSummary(start) {
    const summary = ensureStageSummary();
    const stats = getStageStats(start);
    const starTotal = summary.querySelector("#stage-star-total");
    const clearTotal = summary.querySelector("#stage-clear-total");
    const track = summary.querySelector(".stage-progress-track");
    const fill = summary.querySelector("#stage-progress-fill");

    if (starTotal) starTotal.textContent = `★ ${stats.earnedStars} / ${stats.maxStars}`;
    if (clearTotal) clearTotal.textContent = `進度 ${stats.cleared} / ${stats.total}`;
    if (track) track.setAttribute("aria-valuenow", String(stats.progressPercent));
    if (fill) fill.style.width = `${stats.progressPercent}%`;
    summary.classList.remove("hidden");
  }

  function normalizeStageButtons() {
    [...stageButtons.querySelectorAll(".stage-button[data-stage-start]")].forEach((button) => {
      const start = Number(button.dataset.stageStart);
      if (!Number.isInteger(start)) return;

      // The stage tile shows only its first level number: 1, 101, 201...
      button.textContent = String(start);
      button.classList.remove("done");
      button.removeAttribute("data-stars");
    });

    syncStageFocus();
  }

  function syncStageFocus() {
    const gs = gameState();
    const start = Number(gs?.stageStart);
    const levelsVisible = !levelButtons.classList.contains("hidden");
    const selected = [...stageButtons.querySelectorAll(".stage-button[data-stage-start]")]
      .find((button) => Number(button.dataset.stageStart) === start);
    const focused = !!selected && levelsVisible;

    stageButtons.classList.toggle("stage-focused", focused);

    [...stageButtons.querySelectorAll(".stage-button[data-stage-start]")].forEach((button) => {
      const isSelected = focused && Number(button.dataset.stageStart) === start;
      button.classList.toggle("selected", isSelected);
      button.setAttribute("aria-expanded", String(isSelected));
    });

    if (focused) showStageSummary(start);
    else hideStageSummary();
  }

  function normalizeLevelButtons() {
    // Star and saved-heart badges stay untouched. Their colour no longer changes
    // the level tile because styles.css now keeps every level tile on one palette.
    [...levelButtons.querySelectorAll(".level-button")].forEach((button) => {
      button.removeAttribute("data-progress-band");
    });
  }

  function wrapGlobalFunction(name, after) {
    try {
      const original = globalThis[name];
      if (typeof original !== "function" || original.__selectionUiWrapped) return;

      const wrapped = function (...args) {
        const result = original.apply(this, args);
        after(...args);
        return result;
      };
      Object.defineProperty(wrapped, "__selectionUiWrapped", { value: true });
      globalThis[name] = wrapped;
    } catch { }
  }

  // Function declarations in game.js are global. Wrapping them preserves all
  // existing level loading, star badges, saved-heart badges and hard-mode logic.
  wrapGlobalFunction("renderSizeButtons", () => normalizeSizeButtons());
  wrapGlobalFunction("selectSize", () => {
    normalizeSizeButtons();
    normalizeStageButtons();
  });
  wrapGlobalFunction("renderStageButtons", () => normalizeStageButtons());
  wrapGlobalFunction("selectStage", () => syncStageFocus());
  wrapGlobalFunction("renderLevelButtons", () => {
    normalizeLevelButtons();
    syncStageFocus();
  });
  wrapGlobalFunction("refreshDoneMarks", () => {
    normalizeStageButtons();
    normalizeLevelButtons();
    syncStageFocus();
  });

  // Apply once in case game.js finished rendering before this extension loaded.
  normalizeSizeButtons();
  normalizeRandomSizeButtons();
  normalizeStageButtons();
  normalizeLevelButtons();

  // Random-size tiles may be rendered asynchronously; keep only their visible
  // size label normalized without touching their record/stars/heart contents.
  if (randomSizeButtons && typeof MutationObserver === "function") {
    const observer = new MutationObserver(() => normalizeRandomSizeButtons());
    observer.observe(randomSizeButtons, { childList: true, subtree: true, characterData: true });
  }
})();
