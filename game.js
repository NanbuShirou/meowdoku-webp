"use strict";

// Region colours are controlled by CSS themes.
// Each cell exposes data-region="0".."11" and data-state, so a theme can
// replace colours, borders, radii and other visuals without changing game logic.
const REGION_STYLE_COUNT = 12;
const RANDOM_GENERATION_TIMEOUT_MS = 6000;
const LEVEL_BOOK_PAGE_SIZE = 50;

const EMPTY = 0, MARK = 1, CAT = 2, HYPO = 3, WRONG = 4;
const HEARTS_MAX = 3;
const REGION_COLOR_MAP_VERSION = 1;
const DEFAULT_HARD_LEVEL_COUNT = 700;
const V2_FIXED_LEVELS_PER_SIZE = 100;
const DONE_STORAGE_KEY = "meowdoku_done_v2";
const PROGRESS_STORAGE_KEY = "meowdoku_progress_v2";
const GAME_HISTORY_STORAGE_KEY = "meowdoku_history_v2";
const RANDOM_TIMES_STORAGE_KEY = "meowdoku_random_times_v2";
const CATS_FOUND_HISTORY_VERSION = 2;
const DOUBLE_TAP_MS = 300;
const DRAG_THRESHOLD_PX = 6;

const THEME_MODES = ["light"];
const THEME_ACCENTS = ["purple", "blue", "green", "orange"];
const REMINDER_ICON_OPTIONS = ["paw", "fish"];
const CELL_STYLE_NAMES = {
  original: "原始風格",
  pixel: "像素風格",
  tile: "磁磚風格",
  paper: "紙牌風格",
};
const DEFAULT_REGION_COLORS = [
  "#AB0000", "#687386", "#00D6B4", "#025E41", "#61CBFB", "#3B00B3", "#FC77F5",
  "#F57407", "#D9D8AD", "#15F505", "#FFDC00", "#780168",
];
const V2_MAP_DATA = globalThis.MeowdokuV2MapData;
const V2_STAGE_IMAGE = {
  locked: "01",
  np: "02",
  open: "03",
  cleared: "04",
  perfect: "05",
};

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function normalizeRegionColors(value) {
  if (!Array.isArray(value) || value.length < REGION_STYLE_COUNT) return DEFAULT_REGION_COLORS.slice();
  return DEFAULT_REGION_COLORS.map((fallback, index) => isHexColor(value[index]) ? value[index].toUpperCase() : fallback);
}

function clampColorChannel(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, n));
}

function hexToRgb(hex) {
  const normalized = String(hex || "").trim().replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => clampColorChannel(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// User-facing toggles — persisted across sessions.
const settings = (() => {
  try {
    const s = JSON.parse(localStorage.getItem("meowdoku_settings") || "{}");
    return {
      soundEffects: s.soundEffects !== false,
      vibrate: s.vibrate !== false,
      markDimming: s.markDimming !== false,
      autoElim: !!s.autoElim,
      hypo: !!s.hypo,
      showHelp: s.showHelp !== false,
      cellStyle: Object.keys(CELL_STYLE_NAMES).includes(s.cellStyle) ? s.cellStyle : "original",
      themeMode: THEME_MODES.includes(s.themeMode) ? s.themeMode : "light",
      themeAccent: THEME_ACCENTS.includes(s.themeAccent) ? s.themeAccent : "purple",
      reminderIcon: REMINDER_ICON_OPTIONS.includes(s.reminderIcon) ? s.reminderIcon : "paw",
      regionColors: normalizeRegionColors(s.regionColors),
    };
  } catch {
    return {
      soundEffects: true,
      vibrate: true,
      markDimming: true,
      autoElim: false,
      hypo: false,
      showHelp: true,
      cellStyle: "original",
      themeMode: "light",
      themeAccent: "purple",
      reminderIcon: "paw",
      regionColors: DEFAULT_REGION_COLORS.slice(),
    };
  }
})();

function saveSettings() {
  try { localStorage.setItem("meowdoku_settings", JSON.stringify(settings)); } catch { }
}

function getGameplayHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_HISTORY_STORAGE_KEY) || "{}");
    const currentCatsHistory = Number(raw.catsFoundVersion) === CATS_FOUND_HISTORY_VERSION;
    const data = {
      wrongGuesses: Math.max(0, Math.floor(Number(raw.wrongGuesses) || 0)),
      catsFound: currentCatsHistory ? Math.max(0, Math.floor(Number(raw.catsFound) || 0)) : 0,
      totalPlayMs: Math.max(0, Number(raw.totalPlayMs) || 0),
      catsFoundVersion: CATS_FOUND_HISTORY_VERSION,
      completedRandomLevels: currentCatsHistory && Array.isArray(raw.completedRandomLevels)
        ? [...new Set(raw.completedRandomLevels.filter((key) => typeof key === "string"))]
        : [],
    };
    if (!currentCatsHistory) localStorage.setItem(GAME_HISTORY_STORAGE_KEY, JSON.stringify(data));
    return data;
  } catch {
    return {
      wrongGuesses: 0,
      catsFound: 0,
      totalPlayMs: 0,
      catsFoundVersion: CATS_FOUND_HISTORY_VERSION,
      completedRandomLevels: [],
    };
  }
}

function saveGameplayHistory(data) {
  try { localStorage.setItem(GAME_HISTORY_STORAGE_KEY, JSON.stringify(data)); } catch { }
}

function incrementGameplayHistory(field) {
  const data = getGameplayHistory();
  data[field] = (Number(data[field]) || 0) + 1;
  saveGameplayHistory(data);
}

function recordCatsFoundForClear() {
  const n = Number(state.n);
  if (!Number.isInteger(n) || n <= 0) return;
  const data = getGameplayHistory();

  if (state.mode === "random") {
    const seed = Number(state.randomSeed);
    if (!Number.isFinite(seed)) return;
    const key = `${n}:${seed >>> 0}`;
    const completed = data.completedRandomLevels.includes(key);
    if (!completed) data.completedRandomLevels.push(key);
    if (completed || state.randomFromShareCode) {
      if (!completed) saveGameplayHistory(data);
      return;
    }
  } else {
    const key = fixedStarKey(n, state.mode, state.levelIdx, state.levelChapter);
    if ((Number(getStars()[key]) || 0) > 0) return;
  }

  data.catsFound += n;
  saveGameplayHistory(data);
}

// Star tracking: { "n:idx": 1|2|3 }. Migrates old array format to object.
function getStars() {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_STORAGE_KEY) || "{}");
    if (Array.isArray(raw)) { const o = {}; raw.forEach(k => { o[k] = 1; }); return o; }
    return (typeof raw === "object" && raw !== null) ? raw : {};
  } catch { return {}; }
}
function saveStars(n, idx, stars) {
  const data = getStars();
  const key = `${n}:${idx}`;
  if ((data[key] || 0) < stars) data[key] = stars;
  try { localStorage.setItem(DONE_STORAGE_KEY, JSON.stringify(data)); } catch { }
}

function fixedStarKey(n, mode, levelIdx, chapter = "base") {
  if (chapter === "extra") return `extra:${mode === "hard" ? "hard" : "normal"}:${n}:${levelIdx}`;
  return mode === "hard" ? `hard:${levelIdx}` : `${n}:${levelIdx}`;
}

function saveExtraStars(n, mode, idx, stars) {
  const data = getStars();
  const key = fixedStarKey(n, mode, idx, "extra");
  if ((data[key] || 0) < stars) data[key] = stars;
  try { localStorage.setItem(DONE_STORAGE_KEY, JSON.stringify(data)); } catch { }
}

function getProgressStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || "{}");
    return (typeof raw === "object" && raw !== null && !Array.isArray(raw)) ? raw : {};
  } catch {
    return {};
  }
}

function progressKey(mode, n, levelIdx, randomLevelId = null, chapter = "base") {
  if (mode === "random") {
    if (typeof randomLevelId === "string" && randomLevelId) return `random:share:${randomLevelId}`;
    return Number.isInteger(n) ? `random:${n}` : null;
  }
  if (chapter === "extra" && ["fixed", "hard"].includes(mode)) {
    return `extra:${mode === "hard" ? "hard" : "normal"}:${n}:${levelIdx}`;
  }
  if (mode === "hard") return Number.isInteger(levelIdx) ? `hard:${levelIdx}` : null;
  if (mode === "fixed") return Number.isInteger(n) && Number.isInteger(levelIdx) ? `fixed:${n}:${levelIdx}` : null;
  return null;
}

function clearProgressSnapshot(mode = state.mode, n = state.n, levelIdx = state.levelIdx,
    randomLevelId = state.randomLevelId, chapter = state.levelChapter) {
  const key = progressKey(mode, Number(n), Number(levelIdx), randomLevelId, chapter);
  if (!key) return;
  const store = getProgressStore();
  if (!(key in store)) return;
  delete store[key];
  try { localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(store)); } catch { }
}

function saveCurrentProgress() {
  if (state.gameOver || !Array.isArray(state.board)) return false;
  const key = progressKey(state.mode, Number(state.n), Number(state.levelIdx), state.randomLevelId, state.levelChapter);
  if (!key) return false;
  const store = getProgressStore();
  const snapshot = {
    version: 1,
    mode: state.mode,
    n: Number(state.n),
    levelIdx: state.mode === "random" ? null : Number(state.levelIdx),
    chapter: state.levelChapter,
    board: state.board.map((row) => row.slice()),
    hearts: Math.max(1, Math.min(HEARTS_MAX, Number(state.hearts) || HEARTS_MAX)),
    items: state.items ? { ...state.items, changes: [...state.items.changes] } : undefined,
    savedAt: Date.now(),
  };

  // A random level has no source TXT to reload later, so its generated board
  // and elapsed timer must travel with the mid-game snapshot.
  if (state.mode === "random") {
    if (!Array.isArray(state.regions) || !Array.isArray(state.solution)) return false;
    snapshot.regions = state.regions.map((row) => row.slice());
    snapshot.solution = state.solution.slice();
    snapshot.seed = state.randomSeed ?? null;
    snapshot.elapsedMs = Math.round(currentRandomElapsedMs());
    snapshot.fromShareCode = !!state.randomFromShareCode;
    snapshot.randomLevelId = state.randomLevelId ?? null;
    snapshot.randomScore = globalThis.MeowdokuRandomScore?.snapshot();
  }

  store[key] = snapshot;
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

function loadProgressSnapshot(mode, n, levelIdx, randomLevelId = null, chapter = "base") {
  n = Number(n);
  randomLevelId = typeof randomLevelId === "string" && randomLevelId ? randomLevelId : null;
  const key = progressKey(mode, n, Number(levelIdx), randomLevelId, chapter);
  if (!key) return null;
  const snapshot = getProgressStore()[key];
  const boardOk = snapshot && Array.isArray(snapshot.board) && snapshot.board.length === n
    && snapshot.board.every((row) => Array.isArray(row) && row.length === n)
    && snapshot.board.every((row) => row.every((cell) => [EMPTY, MARK, CAT, HYPO, WRONG].includes(Number(cell))));
  const snapshotRandomLevelId = typeof snapshot?.randomLevelId === "string" && snapshot.randomLevelId
    ? snapshot.randomLevelId
    : null;
  const levelOk = mode === "random"
    ? snapshotRandomLevelId === randomLevelId
    : Number(snapshot?.levelIdx) === Number(levelIdx);
  const snapshotChapter = snapshot?.chapter === "extra" ? "extra" : "base";
  if (!snapshot || snapshot.version !== 1 || snapshot.mode !== mode || snapshotChapter !== chapter
      || Number(snapshot.n) !== n || !levelOk || !boardOk) {
    const keyToRemove = progressKey(mode, n, Number(levelIdx), randomLevelId, chapter);
    const store = getProgressStore();
    if (keyToRemove && keyToRemove in store) {
      delete store[keyToRemove];
      try { localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(store)); } catch { }
    }
    return null;
  }

  const result = {
    board: snapshot.board.map((row) => row.map(Number)),
    hearts: Math.max(1, Math.min(HEARTS_MAX, Number(snapshot.hearts) || HEARTS_MAX)),
    savedAt: Number(snapshot.savedAt) || 0,
    items: snapshot.items,
  };

  if (mode === "random") {
    const regionsOk = Array.isArray(snapshot.regions) && snapshot.regions.length === n
      && snapshot.regions.every((row) => Array.isArray(row) && row.length === n
        && row.every((region) => Number.isInteger(Number(region)) && Number(region) >= 0 && Number(region) < n));
    const solutionOk = Array.isArray(snapshot.solution) && snapshot.solution.length === n
      && snapshot.solution.every((col) => Number.isInteger(Number(col)) && Number(col) >= 0 && Number(col) < n);
    const elapsedOk = Number.isFinite(Number(snapshot.elapsedMs)) && Number(snapshot.elapsedMs) >= 0;
    if (!regionsOk || !solutionOk || !elapsedOk) {
      clearProgressSnapshot(mode, n, null, randomLevelId, chapter);
      return null;
    }
    result.regions = snapshot.regions.map((row) => row.map(Number));
    result.solution = snapshot.solution.map(Number);
    result.seed = snapshot.seed ?? null;
    result.elapsedMs = Math.max(0, Number(snapshot.elapsedMs));
    result.fromShareCode = !!snapshot.fromShareCode;
    result.randomLevelId = snapshotRandomLevelId;
    result.randomScore = snapshot.randomScore;
  }

  return result;
}

// Random-level clear times. Each size keeps best/last/count and a bounded recent history.
function getRandomTimes() {
  try {
    const raw = JSON.parse(localStorage.getItem(RANDOM_TIMES_STORAGE_KEY) || "{}");
    return (typeof raw === "object" && raw !== null) ? raw : {};
  } catch { return {}; }
}

function saveRandomClearResult(n, elapsedMs, stars) {
  const data = getRandomTimes();
  const key = String(n);
  const prev = data[key] || {};
  const safeStars = Math.max(1, Math.min(HEARTS_MAX, Number(stars) || 1));
  const history = Array.isArray(prev.history) ? prev.history.slice(-49) : [];
  history.push({ ms: Math.round(elapsedMs), stars: safeStars, at: new Date().toISOString() });
  const bestMs = Number.isFinite(prev.bestMs) ? Math.min(prev.bestMs, elapsedMs) : elapsedMs;
  const bestStars = Math.max(Number(prev.bestStars) || 0, safeStars);
  data[key] = {
    bestMs: Math.round(bestMs),
    lastMs: Math.round(elapsedMs),
    bestStars,
    lastStars: safeStars,
    clears: (Number(prev.clears) || 0) + 1,
    history,
  };
  try { localStorage.setItem(RANDOM_TIMES_STORAGE_KEY, JSON.stringify(data)); } catch { }
  return data[key];
}

function formatElapsed(ms) {
  const totalCentis = Math.max(0, Math.floor(ms / 10));
  const centis = totalCentis % 100;
  const totalSeconds = Math.floor(totalCentis / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

let randomTitleTimer = null;

function stopRandomTitleTimer() {
  if (randomTitleTimer !== null) {
    clearInterval(randomTitleTimer);
    randomTitleTimer = null;
  }
}

function currentRandomElapsedMs() {
  const offset = Math.max(0, Number(state.randomElapsedOffsetMs) || 0);
  if (!Number.isFinite(state.startedAt)) return offset;
  return offset + Math.max(0, performance.now() - state.startedAt);
}

function renderGameTitle(elapsedMs = null) {
  el.screenGame.dataset.gameMode = state.mode;
  if (state.mode === "random") {
    el.gameTitle.textContent = `隨機關卡 ${state.n}x${state.n}`;
    return;
  }

  if (state.levelChapter === "extra") {
    el.gameTitle.textContent = `追加關卡 ${state.n}x${state.n} ${state.mode === "hard" ? "高難" : "普通"} ${state.levelIdx}`;
    return;
  }

  const difficulty = state.mode === "hard" ? "hard" : "normal";
  const localLevel = state.mode === "hard" ? ((state.levelIdx - 1) % 100) + 1 : state.levelIdx;
  const location = Math.floor((localLevel - 1) / 10) + 1;
  const stage = ((localLevel - 1) % 10) + 1;
  const map = V2_MAP_DATA?.smallMaps?.[`${state.n}:${difficulty}`];
  const place = map?.locations?.[location - 1] || `${state.n}x${state.n}`;
  el.gameTitle.textContent = `${place} ${difficulty === "hard" ? "高難難度" : "普通難度"} ${location}-${stage}`;
}

function startRandomTitleTimer() {
  stopRandomTitleTimer();
  renderGameTitle();
}

const state = {
  sizes: {},        // { "8": levelCount, ... }
  hardLevelCount: DEFAULT_HARD_LEVEL_COUNT,
  extraLevels: { normal: {}, hard: {} },
  fixedLevelsReady: false,
  n: null,
  mode: "fixed",      // "fixed" | "hard" | "random"
  selectionMode: "fixed", // fixed-level selector currently showing normal or hard stages
  levelIdx: null,
  randomSeed: null,
  randomFromShareCode: false,
  randomLevelId: null,
  randomElapsedOffsetMs: 0,
  startedAt: null,
  stageStart: null,
  worldPage: 0,
  worldChoiceSize: null,
  mapSize: null,
  mapDifficulty: null,
  mapLocation: null,
  bookSize: null,
  bookDifficulty: "normal",
  bookChapter: "base",
  bookPage: 0,
  levelChapter: "base",
  launchedFromMap: false,
  regions: null,     // n x n array of region ids (0..n-1)
  regionColorMap: null,
  solution: null,    // solution[row] = column of the true cat
  board: null,       // n x n array of EMPTY/MARK/CAT
  hearts: HEARTS_MAX,
  gameOver: false,
  items: null,
  randomScoreSnapshot: null,
};

const el = {
  sizeButtons: document.getElementById("size-buttons"),
  stageButtons: document.getElementById("stage-buttons"),
  levelButtons: document.getElementById("level-buttons"),
  levelHeading: document.getElementById("level-heading"),
  levelSection: document.getElementById("level-section"),
  cellStyleButtons: document.getElementById("cell-style-buttons"),
  cellStyleCurrentName: document.getElementById("cell-style-current-name"),
  screenEntry: document.getElementById("screen-entry"),
  loadingOverlay: document.getElementById("loading-overlay"),
  screenHome: document.getElementById("screen-home"),
  screenLevelModes: document.getElementById("screen-level-modes"),
  screenWorldMap: document.getElementById("screen-world-map"),
  screenSmallMap: document.getElementById("screen-small-map"),
  screenLevelBook: document.getElementById("screen-level-book"),
  screenSelect: document.getElementById("screen-select"),
  screenRandomSelect: document.getElementById("screen-random-select"),
  screenStyles: document.getElementById("screen-styles"),
  screenHistory: document.getElementById("screen-history"),
  screenHistoryRandom: document.getElementById("screen-history-random"),
  screenGame: document.getElementById("screen-game"),
  gameMapBackgroundPreload: document.getElementById("game-map-background-preload"),
  screenSettings: document.getElementById("screen-settings"),
  screenReminderIcons: document.getElementById("screen-reminder-icons"),
  screenBlockColors: document.getElementById("screen-block-colors"),
  randomSizeButtons: document.getElementById("random-size-buttons"),
  btnEntryStart: document.getElementById("btn-entry-start"),
  btnHomeLevels: document.getElementById("btn-home-levels"),
  btnHomeLevelBook: document.getElementById("btn-home-level-book"),
  btnHomeStyles: document.getElementById("btn-home-styles"),
  btnHomeHistory: document.getElementById("btn-home-history"),
  btnHistoryRandomDetails: document.getElementById("btn-history-random-details"),
  btnHomeSettings: document.getElementById("btn-home-settings"),
  pageSettingsButtons: [...document.querySelectorAll(".page-settings-button")],
  btnLevelModesBack: document.getElementById("btn-level-modes-back"),
  btnWorldBack: document.getElementById("btn-world-back"),
  btnSmallMapBack: document.getElementById("btn-small-map-back"),
  btnLevelBookBack: document.getElementById("btn-level-book-back"),
  levelBookTitle: document.getElementById("level-book-title"),
  levelBookEntry: document.getElementById("level-book-entry"),
  levelBookLevels: document.getElementById("level-book-levels"),
  levelBookDifficulties: document.getElementById("level-book-difficulties"),
  levelBookChapters: document.getElementById("level-book-chapters"),
  levelBookProgress: document.getElementById("level-book-progress"),
  levelBookGrid: document.getElementById("level-book-grid"),
  levelBookStatus: document.getElementById("level-book-status"),
  levelBookPage: document.getElementById("level-book-page"),
  btnLevelBookPrev: document.getElementById("btn-level-book-prev"),
  btnLevelBookNext: document.getElementById("btn-level-book-next"),
  worldMapPager: document.getElementById("world-map-pager"),
  worldMapIndicator: document.getElementById("world-map-indicator"),
  difficultyPicker: document.getElementById("difficulty-picker"),
  difficultyPickerTitle: document.getElementById("difficulty-picker-title"),
  difficultyOptions: document.getElementById("difficulty-options"),
  btnDifficultyClose: document.getElementById("btn-difficulty-close"),
  smallMapTitle: document.getElementById("small-map-title"),
  smallMapBackground: document.getElementById("small-map-background"),
  smallMapSpots: document.getElementById("small-map-spots"),
  smallMapStages: document.getElementById("small-map-stages"),
  smallMapProgress: document.getElementById("small-map-progress"),
  smallMapStatus: document.getElementById("small-map-status"),
  btnWormholeShare: document.getElementById("btn-wormhole-share"),
  btnModeFixed: document.getElementById("btn-mode-fixed"),
  btnModeHard: document.getElementById("btn-mode-hard"),
  btnModeRandom: document.getElementById("btn-mode-random"),
  btnFixedBack: document.getElementById("btn-fixed-back"),
  fixedSelectTitle: document.getElementById("fixed-select-title"),
  sizeSelectionBlock: document.getElementById("size-selection-block"),
  btnRandomBack: document.getElementById("btn-random-back"),
  btnStylesBack: document.getElementById("btn-styles-back"),
  btnHistoryBack: document.getElementById("btn-history-back"),
  btnHistoryRandomBack: document.getElementById("btn-history-random-back"),
  historyRandomList: document.getElementById("history-random-list"),
  board: document.getElementById("board"),
  gameTitle: document.getElementById("game-title"),
  hearts: document.getElementById("hearts"),
  statusBanner: document.getElementById("status-banner"),
  gameBottomActions: document.getElementById("game-bottom-actions"),
  btnSaveProgress: document.getElementById("btn-save-progress"),
  btnBackpack: document.getElementById("btn-backpack"),
  backpackModal: document.getElementById("backpack-modal"),
  backpackTitle: document.getElementById("backpack-title"),
  backpackTitleText: document.getElementById("backpack-title-text"),
  itemManualIcon: document.getElementById("item-manual-icon"),
  backpackList: document.getElementById("backpack-list"),
  itemManualView: document.getElementById("item-manual-view"),
  itemManualContent: document.getElementById("item-manual-content"),
  btnItemManualBack: document.getElementById("btn-item-manual-back"),
  btnBackpackClose: document.getElementById("btn-backpack-close"),
  btnItemDetector: document.getElementById("btn-item-detector"),
  btnItemFish: document.getElementById("btn-item-fish"),
  btnItemBreadcrumb: document.getElementById("btn-item-breadcrumb"),
  itemDetectorCount: document.getElementById("item-detector-count"),
  itemFishCount: document.getElementById("item-fish-count"),
  itemBreadcrumbCount: document.getElementById("item-breadcrumb-count"),
  detectorSelectHint: document.getElementById("detector-select-hint"),
  detectorConfirmModal: document.getElementById("detector-confirm-modal"),
  btnDetectorCancel: document.getElementById("btn-detector-cancel"),
  btnDetectorNo: document.getElementById("btn-detector-no"),
  btnDetectorYes: document.getElementById("btn-detector-yes"),
  saveProgressModal: document.getElementById("save-progress-modal"),
  btnSaveProgressNo: document.getElementById("btn-save-progress-no"),
  btnSaveProgressYes: document.getElementById("btn-save-progress-yes"),
  btnBack: document.getElementById("btn-back"),
  btnSettings: document.getElementById("btn-settings"),
  btnSettingsBack: document.getElementById("btn-settings-back"),
  btnRestart: document.getElementById("btn-restart"),
  winModal: document.getElementById("win-modal"),
  resultModalImage: document.getElementById("result-modal-image"),
  resultModalTitle: document.getElementById("result-modal-title"),
  winTime: document.getElementById("win-time"),
  btnNextLevel: document.getElementById("btn-next-level"),
  btnReplay: document.getElementById("btn-replay"),
  btnModalBack: document.getElementById("btn-modal-back"),
  helpModal: document.getElementById("help-modal"),
  btnHelp: document.getElementById("btn-help"),
  btnHelpClose: document.getElementById("btn-help-close"),
  btnToggleSoundEffects: document.getElementById("btn-toggle-sound-effects"),
  soundEffectsStateIcon: document.getElementById("sound-effects-state-icon"),
  btnToggleVibrate: document.getElementById("btn-toggle-vibrate"),
  vibrateStateIcon: document.getElementById("vibrate-state-icon"),
  btnToggleMarkDimming: document.getElementById("btn-toggle-mark-dimming"),
  markDimmingStateIcon: document.getElementById("mark-dimming-state-icon"),
  btnToggleAuto: document.getElementById("btn-toggle-auto"),
  btnToggleHypo: document.getElementById("btn-toggle-hypo"),
  btnBlockColors: document.getElementById("btn-block-colors"),
  btnReminderIcons: document.getElementById("btn-reminder-icons"),
  btnReminderIconsBack: document.getElementById("btn-reminder-icons-back"),
  btnBlockColorsBack: document.getElementById("btn-block-colors-back"),
  blockColorGrid: document.getElementById("block-color-grid"),
  btnResetBlockColors: document.getElementById("btn-reset-block-colors"),
  blockColorEditorModal: document.getElementById("block-color-editor-modal"),
  blockColorEditorTitle: document.getElementById("block-color-editor-title"),
  blockColorPreview: document.getElementById("block-color-preview"),
  blockColorHex: document.getElementById("block-color-hex"),
  btnBlockColorEditorClose: document.getElementById("btn-block-color-editor-close"),
  rgbRRange: document.getElementById("rgb-r-range"),
  rgbGRange: document.getElementById("rgb-g-range"),
  rgbBRange: document.getElementById("rgb-b-range"),
  rgbRNumber: document.getElementById("rgb-r-number"),
  rgbGNumber: document.getElementById("rgb-g-number"),
  rgbBNumber: document.getElementById("rgb-b-number"),
  rgbStepButtons: [...document.querySelectorAll(".rgb-step-button")],
  themeModeButtons: [...document.querySelectorAll(".theme-mode-button")],
  themeColorButtons: [...document.querySelectorAll(".theme-color-button")],
  reminderIconButtons: [...document.querySelectorAll(".reminder-icon-card")],
};

let activeBlockColorIndex = null;
let gameplayTimerStartedAt = null;

function setHistoryText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function pawIconsHtml(count) {
  const safeCount = Math.max(0, Math.min(HEARTS_MAX, Number(count) || 0));
  return `<span class="paw-icons" aria-label="${safeCount} 個肉球">${'<img src="images/UI/ui_icon_paw.png" alt="">'.repeat(safeCount)}</span>`;
}

function setHistoryProgress(prefix, earnedStars, passed, completed, total, saved) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const fill = document.getElementById(`history-${prefix}-progress-fill`);
  const pawTotal = document.getElementById(`history-${prefix}-stars`);
  if (pawTotal) {
    pawTotal.innerHTML = `${pawIconsHtml(1)} ${earnedStars.toLocaleString()} / ${(total * HEARTS_MAX).toLocaleString()}`;
    pawTotal.setAttribute("aria-label", `肉球 ${earnedStars.toLocaleString()} / ${(total * HEARTS_MAX).toLocaleString()}`);
  }
  setHistoryText(`history-${prefix}-passed`, `${passed.toLocaleString()} / ${total.toLocaleString()}`);
  setHistoryText(`history-${prefix}-completed`, `${completed.toLocaleString()} / ${total.toLocaleString()}`);
  setHistoryText(`history-${prefix}-saved`, saved.toLocaleString());
  setHistoryText(`history-${prefix}-percent`, `${percent}%`);
  fill?.setAttribute("aria-valuenow", String(percent));
  fill?.style.setProperty("--level-book-progress", `${percent}%`);
}

function formatTotalPlayTime(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours} 小時 ${minutes} 分 ${seconds} 秒` : `${minutes} 分 ${seconds} 秒`;
}

function stopGameplayTimer() {
  if (gameplayTimerStartedAt === null) return;
  const data = getGameplayHistory();
  data.totalPlayMs += Math.max(0, performance.now() - gameplayTimerStartedAt);
  gameplayTimerStartedAt = null;
  saveGameplayHistory(data);
}

function startGameplayTimer() {
  if (gameplayTimerStartedAt !== null || document.hidden || state.gameOver) return;
  gameplayTimerStartedAt = performance.now();
}

function renderGameHistory() {
  stopGameplayTimer();
  const stars = getStars();
  let fixedPassed = 0, fixedCompleted = 0, fixedStars = 0;
  let hardPassed = 0, hardCompleted = 0, hardStars = 0;
  Object.entries(stars).forEach(([key, value]) => {
    const count = Math.max(0, Math.min(HEARTS_MAX, Number(value) || 0));
    if (count <= 0) return;
    if (/^hard:\d+$/.test(key)) {
      hardPassed++;
      if (count >= HEARTS_MAX) hardCompleted++;
      hardStars += count;
    } else if (/^\d+:\d+$/.test(key)) {
      fixedPassed++;
      if (count >= HEARTS_MAX) fixedCompleted++;
      fixedStars += count;
    } else {
      const match = key.match(/^extra:(normal|hard):(\d+):(\d+)$/);
      if (!match) return;
      const [, difficulty, sizeText, levelText] = match;
      if (Number(levelText) > extraLevelCount(Number(sizeText), difficulty)) return;
      if (difficulty === "hard") {
        hardPassed++;
        if (count >= HEARTS_MAX) hardCompleted++;
        hardStars += count;
      } else {
        fixedPassed++;
        if (count >= HEARTS_MAX) fixedCompleted++;
        fixedStars += count;
      }
    }
  });

  const totals = getGameplayHistory();
  const fixedTotal = Object.values(state.sizes).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0)
    + totalExtraLevels("normal");
  const hardTotal = state.hardLevelCount + totalExtraLevels("hard");

  let fixedSaved = 0, hardSaved = 0;
  Object.entries(getProgressStore()).forEach(([key, snapshot]) => {
    if (!snapshot) return;
    const fixed = key.match(/^fixed:(\d+):([1-9]\d*)$/);
    const hard = key.match(/^hard:([1-9]\d*)$/);
    const extra = key.match(/^extra:(normal|hard):(\d+):([1-9]\d*)$/);
    if (fixed && Number(fixed[2]) <= Number(state.sizes[fixed[1]] || 0)) fixedSaved++;
    else if (hard && Number(hard[1]) <= state.hardLevelCount) hardSaved++;
    else if (extra && Number(extra[3]) <= extraLevelCount(Number(extra[2]), extra[1])) {
      if (extra[1] === "hard") hardSaved++;
      else fixedSaved++;
    }
  });
  setHistoryProgress("fixed", fixedStars, fixedPassed, fixedCompleted, fixedTotal, fixedSaved);
  setHistoryProgress("hard", hardStars, hardPassed, hardCompleted, hardTotal, hardSaved);
  setHistoryText("history-wrong-guesses", `${totals.wrongGuesses} 次`);
  setHistoryText("history-cats-found", `${totals.catsFound} 隻`);
  setHistoryText("history-total-time", formatTotalPlayTime(totals.totalPlayMs));
  syncHistoryLayout();
}

function syncHistoryLayout() {
  if (document.body.dataset.appScreen !== "history") return;
  const stats = document.querySelector(".history-stats");
  if (!stats) return;
  const catHeight = parseFloat(getComputedStyle(document.body, "::after").height) || 0;
  const height = Math.max(0, Math.floor(window.innerHeight - stats.getBoundingClientRect().top - catHeight - 8));
  stats.style.setProperty("--history-available-height", `${height}px`);
}

window.addEventListener("resize", syncHistoryLayout);
document.querySelector(".app-header-title")?.addEventListener("load", syncHistoryLayout);

function renderRandomHistoryDetails() {
  if (!el.historyRandomList) return;
  const times = getRandomTimes();
  let scores = {};
  try { scores = JSON.parse(localStorage.getItem("meowdoku_random_scores_v2") || "{}"); } catch { }
  const sizes = Object.keys(state.sizes).map(Number).sort((a, b) => a - b);

  el.historyRandomList.innerHTML = sizes.map((size) => {
    const bestMs = Number(times[String(size)]?.bestMs);
    const bestScore = Number(scores?.[String(size)]?.bestScore);
    const image = V2_MAP_DATA.wormholeEntries.find((entry) => entry.size === size)?.image || "";
    return `<article class="random-history-card">
      <img class="random-history-image" src="${image}" alt="${size}乘${size}隨機關卡">
      <div class="random-history-stats">
        <span><b>過關</b><strong>${Math.max(0, Math.floor(Number(times[String(size)]?.clears) || 0)).toLocaleString()} 次</strong></span>
        <span><b>最快</b><strong>${Number.isFinite(bestMs) ? formatElapsed(bestMs) : "--"}</strong></span>
        <span><b>最高</b><strong>${Number.isFinite(bestScore) ? Math.trunc(bestScore).toLocaleString("en-US") : "--"}</strong></span>
      </div>
    </article>`;
  }).join("");
}

globalThis.renderGameHistory = renderGameHistory;

const soundManager = globalThis.SoundManager ? new globalThis.SoundManager() : null;
soundManager?.configure({ enabled: settings.soundEffects });

let screenLoadToken = 0;

function startScreenLoading() {
  const token = ++screenLoadToken;
  el.loadingOverlay?.classList.remove("hidden");
  document.body.setAttribute("aria-busy", "true");
  return token;
}

async function waitForImages(root) {
  const images = [...root.querySelectorAll("img[src]")];
  await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  })));
  await Promise.all(images.map((image) => image.decode?.().catch(() => {}) || Promise.resolve()));
}

function finishScreenLoading(root, token) {
  waitForImages(root).finally(() => {
    if (token !== screenLoadToken) return;
    el.loadingOverlay?.classList.add("hidden");
    document.body.removeAttribute("aria-busy");
  });
}

// ── Haptic ───────────────────────────────────────────────────────────────────

function vibrate(_type, fallbackMs = 50) {
  if (!settings.vibrate) return;
  if (navigator.vibrate) navigator.vibrate(fallbackMs);
}

// Per-cell DOM elements, indexed [row][col], created once per level load.
let cellEls = [];

function updateToggleUI() {
  if (el.soundEffectsStateIcon) el.soundEffectsStateIcon.textContent = settings.soundEffects ? "🔊" : "🔇";
  if (el.vibrateStateIcon) el.vibrateStateIcon.textContent = settings.vibrate ? "📳" : "📴";
  if (el.markDimmingStateIcon) el.markDimmingStateIcon.textContent = settings.markDimming ? "🌗" : "☀️";
  document.documentElement.dataset.markDimming = settings.markDimming ? "on" : "off";
  el.btnToggleSoundEffects?.classList.toggle("off", !settings.soundEffects);
  el.btnToggleVibrate.classList.toggle("off", !settings.vibrate);
  el.btnToggleMarkDimming?.classList.toggle("off", !settings.markDimming);
  el.btnToggleAuto.classList.toggle("off", !settings.autoElim);
  el.btnToggleHypo?.classList.toggle("off", !settings.hypo);
  el.btnToggleSoundEffects?.setAttribute("aria-pressed", String(settings.soundEffects));
  el.btnToggleVibrate.setAttribute("aria-pressed", String(settings.vibrate));
  el.btnToggleMarkDimming?.setAttribute("aria-pressed", String(settings.markDimming));
  el.btnToggleAuto.setAttribute("aria-pressed", String(settings.autoElim));
  el.btnToggleHypo?.setAttribute("aria-pressed", String(settings.hypo));
}

function applyCellStyle(style) {
  const nextStyle = Object.keys(CELL_STYLE_NAMES).includes(style) ? style : "original";
  settings.cellStyle = nextStyle;
  document.body.dataset.cellStyle = nextStyle;
  if (el.cellStyleButtons) {
    [...el.cellStyleButtons.querySelectorAll(".cell-style-button")].forEach((btn) => {
      const selected = btn.dataset.cellStyle === nextStyle;
      btn.classList.toggle("selected", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });
  }
  if (el.cellStyleCurrentName) el.cellStyleCurrentName.textContent = CELL_STYLE_NAMES[nextStyle] || nextStyle;
}

function reminderIconSrc(choice = settings.reminderIcon) {
  return choice === "fish" ? "images/UI/Fish_bone.png" : "images/UI/cat_footprints.png";
}

function applyReminderIconChoice(choice = settings.reminderIcon) {
  settings.reminderIcon = REMINDER_ICON_OPTIONS.includes(choice) ? choice : "paw";
  document.documentElement.dataset.reminderIcon = settings.reminderIcon;
  const src = reminderIconSrc(settings.reminderIcon);
  document.querySelectorAll(".hypo-icon, .hypo-tool-icon").forEach((img) => {
    if (img instanceof HTMLImageElement) img.src = src;
  });
  el.reminderIconButtons.forEach((btn) => {
    const selected = btn.dataset.reminderIcon === settings.reminderIcon;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
}

function applyAppTheme(mode = settings.themeMode, accent = settings.themeAccent) {
  settings.themeMode = THEME_MODES.includes(mode) ? mode : "light";
  settings.themeAccent = THEME_ACCENTS.includes(accent) ? accent : "purple";
  document.documentElement.dataset.themeMode = settings.themeMode;
  document.documentElement.dataset.themeAccent = settings.themeAccent;

  el.themeModeButtons.forEach((btn) => {
    const selected = btn.dataset.themeMode === settings.themeMode;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
  el.themeColorButtons.forEach((btn) => {
    const selected = btn.dataset.themeAccent === settings.themeAccent;
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
}

function applyRegionColors(colors = settings.regionColors) {
  settings.regionColors = normalizeRegionColors(colors);
  settings.regionColors.forEach((color, index) => {
    document.documentElement.style.setProperty(`--region-${index}`, color);
  });
}

function setRegionColor(index, color) {
  if (!Number.isInteger(index) || index < 0 || index >= REGION_STYLE_COUNT || !isHexColor(color)) return;
  const nextColor = color.toUpperCase();
  settings.regionColors[index] = nextColor;
  document.documentElement.style.setProperty(`--region-${index}`, nextColor);
  const card = el.blockColorGrid?.querySelector(`[data-color-index="${index}"]`);
  if (card) {
    const swatch = card.querySelector(".block-color-swatch");
    const code = card.querySelector(".block-color-code");
    if (swatch) swatch.style.background = nextColor;
    if (code) code.textContent = nextColor;
  }
  saveSettings();
}

function getRgbControls() {
  return {
    r: { range: el.rgbRRange, number: el.rgbRNumber },
    g: { range: el.rgbGRange, number: el.rgbGNumber },
    b: { range: el.rgbBRange, number: el.rgbBNumber },
  };
}

function syncBlockColorEditor(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return;
  const controls = getRgbControls();
  for (const channel of ["r", "g", "b"]) {
    controls[channel].range.value = String(rgb[channel]);
    controls[channel].number.value = String(rgb[channel]);
  }
  el.blockColorHex.value = color.toUpperCase();
  el.blockColorPreview.style.background = color;
}

function applyRgbEditorValues() {
  if (activeBlockColorIndex === null) return;
  const controls = getRgbControls();
  const color = rgbToHex(
    controls.r.number.value,
    controls.g.number.value,
    controls.b.number.value,
  );
  syncBlockColorEditor(color);
  setRegionColor(activeBlockColorIndex, color);
}

function openBlockColorEditor(index) {
  if (!Number.isInteger(index) || index < 0 || index >= REGION_STYLE_COUNT) return;
  activeBlockColorIndex = index;
  const color = settings.regionColors[index];
  el.blockColorEditorTitle.textContent = `顏色 ${index + 1}`;
  syncBlockColorEditor(color);
  el.blockColorEditorModal.classList.remove("hidden");
}

function closeBlockColorEditor() {
  activeBlockColorIndex = null;
  el.blockColorEditorModal?.classList.add("hidden");
}

function renderBlockColorEditor() {
  if (!el.blockColorGrid) return;
  el.blockColorGrid.innerHTML = "";
  settings.regionColors.forEach((color, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "block-color-card";
    card.dataset.colorIndex = String(index);
    card.setAttribute("aria-label", `調整方塊顏色 ${index + 1}，目前 ${color}`);

    const swatch = document.createElement("span");
    swatch.className = "block-color-swatch";
    swatch.style.background = color;
    swatch.setAttribute("aria-hidden", "true");

    const meta = document.createElement("span");
    meta.className = "block-color-meta";
    const name = document.createElement("span");
    name.className = "block-color-name";
    name.textContent = `顏色 ${index + 1}`;
    const code = document.createElement("span");
    code.className = "block-color-code";
    code.textContent = color;
    meta.append(name, code);

    card.addEventListener("click", () => openBlockColorEditor(index));
    card.append(swatch, meta);
    el.blockColorGrid.appendChild(card);
  });
}

let itemInteraction = null;
let itemManualButton = null;
let detectorTargets = [];
let detectorPreviewElements = [];

// 道具與檢查點沿用同一場挑戰；舊存檔沒有道具欄位時才提供初始數量。
function restoreItemSession(saved, board) {
  const items = { detectorUsed: false, driedFishUsed: false, breadcrumbUsedCount: 0,
    checkpoint: board.some(row => row.includes(CAT)), changes: new Map() };
  if (!saved) return items;
  if (typeof saved.detectorUsed !== "boolean" || typeof saved.driedFishUsed !== "boolean"
      || !Number.isInteger(saved.breadcrumbUsedCount) || saved.breadcrumbUsedCount < 0
      || saved.breadcrumbUsedCount > 3 || typeof saved.checkpoint !== "boolean") {
    return { ...items, detectorUsed: true, driedFishUsed: true, breadcrumbUsedCount: 3, checkpoint: false };
  }
  Object.assign(items, { detectorUsed: saved.detectorUsed, driedFishUsed: saved.driedFishUsed,
    breadcrumbUsedCount: saved.breadcrumbUsedCount, checkpoint: saved.checkpoint });
  const n = board.length;
  if (items.checkpoint && Array.isArray(saved.changes) && saved.changes.length <= n * n
      && saved.changes.every(entry => Array.isArray(entry) && entry.length === 2
        && Number.isInteger(entry[0]) && entry[0] >= 0 && entry[0] < n * n
        && [EMPTY, MARK, CAT, HYPO, WRONG].includes(entry[1]))) {
    for (const [index, before] of saved.changes) {
      if (board[Math.floor(index / n)][index % n] !== before) items.changes.set(index, before);
    }
  }
  return items;
}

function itemUnavailableReason(type) {
  const items = state.items;
  if (state.gameOver || !items) return "目前無法使用";
  if (type === "detector") return items.detectorUsed ? "已用完" : "";
  if (type === "fish") return items.driedFishUsed ? "已用完" : state.hearts >= HEARTS_MAX ? "生命已滿" : "";
  if (items.breadcrumbUsedCount >= 3) return "已用完";
  if (!items.checkpoint) return "尚未找到貓";
  return items.changes.size ? "" : "沒有可回復的變更";
}

function renderBackpack() {
  const items = state.items;
  const rows = [
    ["detector", "偵測器", el.btnItemDetector, el.itemDetectorCount, items.detectorUsed ? 0 : 1, 1],
    ["fish", "小魚乾", el.btnItemFish, el.itemFishCount, items.driedFishUsed ? 0 : 1, 1],
    ["breadcrumb", "麵包屑", el.btnItemBreadcrumb, el.itemBreadcrumbCount, 3 - items.breadcrumbUsedCount, 3],
  ];
  for (const [type, name, button, count, remaining, total] of rows) {
    const reason = itemUnavailableReason(type);
    button.disabled = !!reason;
    button.title = reason || `使用${name}`;
    button.setAttribute("aria-label", `${name}，剩餘 ${remaining}/${total}${reason ? `，${reason}` : ""}`);
    count.textContent = `${remaining}/${total}`;
  }
}

function openBackpack() {
  if (state.gameOver || !state.items) return;
  closeBackpack();
  resetBoardPointer();
  itemInteraction = "bag";
  renderBackpack();
  el.backpackModal.classList.remove("hidden");
  (el.backpackList.querySelector("button:not(:disabled)") || el.btnBackpackClose).focus();
}

// 說明沿用背包視窗，只讀取本機文字，不消耗道具或改動盤面。
async function openItemManual(button) {
  if (itemInteraction !== "bag") return;
  const name = button.dataset.itemManual;
  itemManualButton = button;
  el.backpackList.classList.add("hidden");
  el.itemManualView.classList.remove("hidden");
  el.backpackTitle.classList.add("item-manual-title");
  el.itemManualIcon.src = button.parentElement.querySelector("img").src;
  el.itemManualIcon.classList.remove("hidden");
  el.backpackTitleText.textContent = name;
  el.itemManualContent.textContent = "載入中…";
  el.btnItemManualBack.focus();
  try {
    const response = await fetch(`story/${encodeURIComponent(name)}.txt`);
    if (!response.ok) throw new Error("道具說明讀取失敗");
    const text = await response.text();
    if (itemManualButton === button) {
      el.itemManualContent.textContent = text.replace(/^\uFEFF?##[^\r\n]*##\r?\n/, "");
    }
  } catch {
    if (itemManualButton === button) el.itemManualContent.textContent = "無法載入道具說明，請返回後再試一次。";
  }
}

function closeItemManual() {
  if (!itemManualButton) return false;
  const button = itemManualButton;
  itemManualButton = null;
  el.itemManualView.classList.add("hidden");
  el.backpackList.classList.remove("hidden");
  el.backpackTitle.classList.remove("item-manual-title");
  el.itemManualIcon.classList.add("hidden");
  el.backpackTitleText.textContent = "使用道具";
  button.focus();
  return true;
}

// 回傳是否攔截返回鍵；取消不扣道具，也不保留選取模式。
function closeBackpack() {
  if (!itemInteraction) return false;
  closeItemManual();
  resetBoardPointer();
  for (const preview of detectorPreviewElements) preview.remove();
  detectorPreviewElements = [];
  detectorTargets = [];
  if (itemInteraction !== "bag") {
    for (const row of cellEls) for (const cell of row) {
      cell.removeAttribute("tabindex");
      cell.removeAttribute("role");
      cell.removeAttribute("aria-label");
    }
  }
  itemInteraction = null;
  el.backpackModal?.classList.add("hidden");
  el.detectorSelectHint?.classList.add("hidden");
  el.detectorConfirmModal?.classList.add("hidden");
  el.btnBackpack?.focus();
  return true;
}
globalThis.meowdokuCloseBackpack = () => closeItemManual() || closeBackpack();

function startDetectorSelection() {
  if (itemUnavailableReason("detector")) return;
  resetBoardPointer();
  el.backpackModal.classList.add("hidden");
  itemInteraction = "select";
  el.detectorSelectHint.classList.remove("hidden");
  for (let r = 0; r < state.n; r++) for (let c = 0; c < state.n; c++) {
    const cell = cellEls[r][c];
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `偵測中心：第 ${r + 1} 列第 ${c + 1} 格`);
  }
  cellEls[0][0].focus();
}

function selectDetectorCenter(r, c) {
  if (itemInteraction !== "select" || itemUnavailableReason("detector")) return;
  detectorTargets = [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([row, col]) => row >= 0 && col >= 0 && row < state.n && col < state.n);
  // 只在確認範圍時量測最多五格；覆蓋層不受錯誤格透明度及方塊風格影響。
  const boardRect = el.board.getBoundingClientRect();
  const boxes = detectorTargets.map(([row, col]) => cellEls[row][col].getBoundingClientRect());
  for (const [index, box] of boxes.entries()) {
    const preview = document.createElement("span");
    preview.className = "detector-preview";
    preview.dataset.center = String(index === 0);
    preview.setAttribute("aria-hidden", "true");
    Object.assign(preview.style, {
      left: `${box.left - boardRect.left - el.board.clientLeft}px`,
      top: `${box.top - boardRect.top - el.board.clientTop}px`,
      width: `${box.width}px`, height: `${box.height}px`,
    });
    el.board.appendChild(preview);
    detectorPreviewElements.push(preview);
  }
  itemInteraction = "confirm";
  el.detectorSelectHint.classList.add("hidden");
  el.detectorConfirmModal.classList.remove("hidden");
  el.btnDetectorNo.focus();
}

function useDetector() {
  if (itemInteraction !== "confirm" || itemUnavailableReason("detector")) return;
  const targets = detectorTargets.slice();
  state.items.detectorUsed = true;
  closeBackpack();
  // 先處理非貓格，再沿用找貓流程；最後一隻貓仍正常計分、建立檢查點及過關。
  for (const [r, c] of targets) {
    if (state.solution[r] !== c && state.board[r][c] !== WRONG) {
      state.board[r][c] = MARK;
      updateCellView(r, c);
    }
  }
  for (const [r, c] of targets) if (state.solution[r] === c) attemptPlaceCat(r, c);
}

function useDriedFish() {
  if (itemUnavailableReason("fish")) return;
  state.items.driedFishUsed = true;
  state.hearts++;
  renderHearts();
  closeBackpack();
}

function useBreadcrumb() {
  if (itemUnavailableReason("breadcrumb")) return;
  closeBackpack();
  const changes = [...state.items.changes];
  state.items.breadcrumbUsedCount++;
  for (const [index, before] of changes) state.board[Math.floor(index / state.n)][index % state.n] = before;
  state.items.changes.clear();
  for (const [index] of changes) updateCellView(Math.floor(index / state.n), index % state.n, false);
}

function setGameBottomActionsForMode() {
  if (el.btnSaveProgress) el.btnSaveProgress.classList.remove("hidden");
  el.gameBottomActions?.classList.remove("single-action");
}

function openSaveProgressConfirm() {
  closeBackpack();
  if (state.gameOver) return;
  const message = el.saveProgressModal?.querySelector(".modal-message");
  if (message) {
    message.innerHTML = state.mode === "random"
      ? `紀錄目前的遊戲進度後將返回首頁。<br>下次進入 ${state.n} × ${state.n} 隨機關卡時，將從這次盤面與時間繼續。<br><br>是否要紀錄目前進度？`
      : "紀錄目前的遊戲進度後將返回首頁。<br>下次進入同一關卡時，將從這次紀錄繼續。<br><br>是否要紀錄目前進度？";
  }
  el.saveProgressModal?.classList.remove("hidden");
}

function closeSaveProgressConfirm() {
  el.saveProgressModal?.classList.add("hidden");
}

function confirmSaveProgress() {
  if (!saveCurrentProgress()) {
    closeSaveProgressConfirm();
    el.statusBanner.textContent = "中途紀錄儲存失敗";
    el.statusBanner.className = "status-banner lose";
    return;
  }
  closeSaveProgressConfirm();
  showAppScreen("home");
}

function v2LocalLevel(location, stage) {
  return (location - 1) * 10 + stage;
}

function normalWinRoute(size, localLevel) {
  size = Number(size);
  localLevel = Number(localLevel);
  if (!Number.isInteger(size) || size < 6 || size > 12
      || !Number.isInteger(localLevel) || localLevel < 1 || localLevel > 100) {
    return { continueLevel: null, nextLocation: null };
  }

  const location = Math.floor((localLevel - 1) / 10) + 1;
  const stage = ((localLevel - 1) % 10) + 1;
  const continueLevel = stage < 10 ? localLevel + 1 : null;
  let nextLocation = null;
  if (stage === 1 || stage === 10) {
    if (location < 10) nextLocation = { size, localLevel: v2LocalLevel(location + 1, 1) };
    else if (size < 12) nextLocation = { size: size + 1, localLevel: 1 };
  }
  return { continueLevel, nextLocation };
}

function v2HardLevel(size, localLevel) {
  return (size - 6) * 100 + localLevel;
}

function hardWinRoute(size, levelIdx) {
  const localLevel = levelIdx - v2HardLevel(size, 0);
  const route = normalWinRoute(size, localLevel);
  if (route.continueLevel) route.continueLevel = v2HardLevel(size, route.continueLevel);
  // 高難沒有第一關的主線捷徑，且不得跳入尚未解鎖的地點。
  if (localLevel % 10 !== 0) route.nextLocation = null;
  if (route.nextLocation) {
    const target = route.nextLocation;
    const location = Math.floor((target.localLevel - 1) / 10) + 1;
    if (!isV2LocationUnlocked(target.size, "hard", location)) route.nextLocation = null;
  }
  return route;
}

function normalizeExtraLevels(value) {
  const result = { normal: {}, hard: {} };
  for (const difficulty of ["normal", "hard"]) {
    for (let size = 6; size <= 12; size++) {
      result[difficulty][size] = Math.max(0, Math.floor(Number(value?.[difficulty]?.[size]) || 0));
    }
  }
  return result;
}

function extraLevelCount(size, difficulty) {
  return Math.max(0, Number(state.extraLevels?.[difficulty]?.[size]) || 0);
}

function totalExtraLevels(difficulty) {
  return Object.values(state.extraLevels?.[difficulty] || {}).reduce(
    (sum, count) => sum + Math.max(0, Number(count) || 0), 0
  );
}

function v2GameBackground(size, mode) {
  if (mode === "random") return "images/smallmap/1map08.png";
  const difficulty = mode === "fixed" ? "normal" : mode;
  return ["normal", "hard"].includes(difficulty)
    ? V2_MAP_DATA.smallMaps[`${size}:${difficulty}`]?.background || ""
    : "";
}

function v2StarKey(size, difficulty, localLevel) {
  return difficulty === "hard"
    ? `hard:${v2HardLevel(size, localLevel)}`
    : `${size}:${localLevel}`;
}

function isV2LevelCleared(size, difficulty, localLevel) {
  return Number(getStars()[v2StarKey(size, difficulty, localLevel)] || 0) > 0;
}

function isV2SizeUnlocked(size) {
  if (!Number.isInteger(size) || size < 6 || size > 12) return false;
  if (!state.fixedLevelsReady || size === 6) return true;
  for (let location = 1; location <= 10; location++) {
    if (!isV2LevelCleared(size - 1, "normal", v2LocalLevel(location, 1))) return false;
  }
  return true;
}

function isV2WormholeUnlocked() {
  if (!state.fixedLevelsReady) return true;
  for (let size = 6; size <= 12; size++) {
    for (let location = 1; location <= 10; location++) {
      if (!isV2LevelCleared(size, "normal", v2LocalLevel(location, 1))) return false;
    }
  }
  return true;
}

function isV2LocationUnlocked(size, difficulty, location) {
  if (!state.fixedLevelsReady) return true;
  if (!isV2SizeUnlocked(size)) return false;
  if (difficulty === "hard") {
    return isV2LevelCleared(size, "normal", v2LocalLevel(location, 1));
  }
  if (location === 1) return true;
  return isV2LevelCleared(size, "normal", v2LocalLevel(location - 1, 1));
}

function isV2StageUnlocked(size, difficulty, location, stage) {
  if (!isV2LocationUnlocked(size, difficulty, location)) return false;
  return stage === 1 || isV2LevelCleared(size, difficulty, v2LocalLevel(location, stage - 1));
}

function v2SpotVisualState(size, difficulty, location) {
  if (!isV2LocationUnlocked(size, difficulty, location)) return "locked";
  const start = v2LocalLevel(location, 1);
  const stars = getStars();
  let passed = 0;
  let perfect = 0;
  for (let local = start; local < start + 10; local++) {
    const earnedStars = Number(stars[v2StarKey(size, difficulty, local)] || 0);
    if (earnedStars > 0) passed++;
    if (earnedStars >= 3) perfect++;
  }
  if (perfect === 10) return "perfect";
  if (passed === 10) return "cleared";
  return passed > 0 ? "current" : "open";
}

function hasV2SavedProgress(size, difficulty, localLevel) {
  const key = v2ProgressKey(size, difficulty, localLevel);
  return !!getProgressStore()[key];
}

function v2ProgressKey(size, difficulty, localLevel) {
  return difficulty === "hard"
    ? `hard:${v2HardLevel(size, localLevel)}`
    : `fixed:${size}:${localLevel}`;
}

function getV2ProgressSummary(size, difficulty) {
  const stars = getStars();
  const progress = getProgressStore();
  const savedByLocation = Array(10).fill(0);
  let passed = 0;
  let completed = 0;
  let mainline = 0;
  let saved = 0;
  for (let localLevel = 1; localLevel <= V2_FIXED_LEVELS_PER_SIZE; localLevel++) {
    const earnedStars = Number(stars[v2StarKey(size, difficulty, localLevel)] || 0);
    if (earnedStars > 0) {
      passed++;
      if ((localLevel - 1) % 10 === 0) mainline++;
    }
    if (earnedStars >= 3) completed++;
    if (progress[v2ProgressKey(size, difficulty, localLevel)]) {
      saved++;
      savedByLocation[Math.floor((localLevel - 1) / 10)]++;
    }
  }
  return { passed, completed, mainline, saved, savedByLocation };
}

function renderV2ProgressSummary(element, summary) {
  if (!element) return;
  element.innerHTML = `<span>通過 ${summary.passed}/100</span><span>完成 ${summary.completed}/100</span><span>主線 ${summary.mainline}/10</span><span class="v2-saved-total"><img src="images/UI/ui_stagenode_00.png" alt="">${summary.saved}</span>`;
  element.setAttribute("aria-label", `通過 ${summary.passed}/100，三星完成 ${summary.completed}/100，主線 ${summary.mainline}/10，中途紀錄 ${summary.saved}`);
}

function v2StageVisualState(size, difficulty, localLevel, unlocked) {
  if (!unlocked) return "locked";
  const stars = Number(getStars()[v2StarKey(size, difficulty, localLevel)] || 0);
  if (stars >= 3) return "perfect";
  if (stars === 2) return "cleared";
  if (stars === 1) return "open";
  return "np";
}

function setMapPosition(element, x, y) {
  element.style.setProperty("--map-x", `${x}%`);
  element.style.setProperty("--map-y", `${y}%`);
}

function invertWorldPage(page, pageCount) {
  return pageCount - 1 - page;
}

function syncWorldMapIndicator() {
  if (!el.worldMapIndicator) return;
  [...el.worldMapIndicator.children].forEach((dot) => {
    dot.classList.toggle("active", Number(dot.dataset.page) === state.worldPage);
  });
}

function syncWorldMapAssets() {
  if (!el.worldMapPager) return;
  [...el.worldMapPager.querySelectorAll(".world-map-page")].forEach((page) => {
    const shouldLoad = Math.abs(Number(page.dataset.page) - state.worldPage) <= 1;
    page.querySelectorAll("img[data-map-src]").forEach((image) => {
      if (shouldLoad && !image.getAttribute("src")) image.src = image.dataset.mapSrc;
      else if (!shouldLoad) image.removeAttribute("src");
    });
  });
}

function selectWorldMapPage(page, behavior = "smooth") {
  const pageCount = V2_MAP_DATA?.worldPages?.length || 1;
  state.worldPage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  syncWorldMapIndicator();
  syncWorldMapAssets();
  const height = el.worldMapPager?.clientHeight || 0;
  if (height > 0) {
    el.worldMapPager.scrollTo({
      top: invertWorldPage(state.worldPage, pageCount) * height,
      behavior,
    });
  }
  if (history.state?.screen === "world-map") history.replaceState(v2HistoryState("world-map"), "");
}

function renderWorldMap() {
  if (!V2_MAP_DATA || !el.worldMapPager || !el.worldMapIndicator) return;
  el.worldMapPager.innerHTML = "";
  el.worldMapIndicator.innerHTML = "";

  [...V2_MAP_DATA.worldPages].reverse().forEach((page) => {
    const pageIndex = V2_MAP_DATA.worldPages.indexOf(page);
    const section = document.createElement("section");
    section.className = "world-map-page";
    section.dataset.page = String(pageIndex);

    const background = document.createElement("img");
    background.className = "world-map-background";
    background.dataset.mapSrc = page.background;
    background.alt = "";
    background.decoding = "async";
    section.appendChild(background);

    page.entries.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "world-entry-button";
      button.style.setProperty("--entry-x", `${entry.x}%`);
      button.style.setProperty("--entry-y", `${entry.y}%`);

      const image = document.createElement("img");
      image.dataset.mapSrc = entry.image;
      image.alt = "";
      image.decoding = "async";
      button.appendChild(image);

      if (entry.type === "random") {
        const unlocked = isV2WormholeUnlocked();
        button.classList.toggle("locked", !unlocked);
        button.disabled = !unlocked;
        button.setAttribute("aria-label", `前往蟲洞隨機關卡${unlocked ? "" : "，尚未解鎖"}`);
        button.addEventListener("click", openWormholeMap);
      } else {
        const unlocked = isV2SizeUnlocked(entry.size);
        button.classList.toggle("locked", !unlocked);
        button.disabled = !unlocked;
        button.setAttribute("aria-label", `${entry.size}乘${entry.size}${unlocked ? "" : "，尚未解鎖"}`);
        button.addEventListener("click", () => showDifficultyPicker(entry.size));
      }
      section.appendChild(button);
    });
    el.worldMapPager.appendChild(section);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "world-map-dot";
    dot.dataset.page = String(pageIndex);
    dot.textContent = String(pageIndex + 1);
    dot.setAttribute("aria-label", `切換到世界地圖 ${pageIndex + 1}`);
    dot.addEventListener("click", () => {
      const loadingToken = startScreenLoading();
      selectWorldMapPage(pageIndex);
      finishScreenLoading(el.screenWorldMap, loadingToken);
    });
    el.worldMapIndicator.appendChild(dot);
  });

  syncWorldMapIndicator();
  syncWorldMapAssets();
  requestAnimationFrame(() => selectWorldMapPage(state.worldPage, "auto"));
}

function closeDifficultyPicker() {
  state.worldChoiceSize = null;
  el.difficultyPicker?.classList.add("hidden");
}

function showDifficultyPicker(size, pushHistory = true) {
  if (!V2_MAP_DATA || !Number.isInteger(size)) return;
  const loadingToken = startScreenLoading();
  state.worldChoiceSize = size;
  if (el.difficultyPickerTitle) el.difficultyPickerTitle.textContent = `${size}×${size} 選擇難度`;
  if (el.difficultyOptions) {
    el.difficultyOptions.innerHTML = "";
    const imageNumber = String(size - 5).padStart(2, "0");
    ["normal", "hard"].forEach((difficulty) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "difficulty-option";
      const unlocked = difficulty === "normal"
        ? isV2SizeUnlocked(size)
        : (!state.fixedLevelsReady || isV2LevelCleared(size, "normal", 1));
      button.classList.toggle("locked", !unlocked);
      button.disabled = !unlocked;
      button.setAttribute("aria-label", `${size}乘${size}${difficulty === "hard" ? "高難" : "一般"}${unlocked ? "" : "，尚未解鎖"}`);

      const image = document.createElement("img");
      image.src = `images/smallmap/sBtn${imageNumber}${difficulty === "hard" ? "b" : "a"}.png`;
      image.alt = "";
      image.decoding = "async";
      button.appendChild(image);

      const progressSummary = document.createElement("span");
      progressSummary.className = "difficulty-option-progress";
      renderV2ProgressSummary(progressSummary, getV2ProgressSummary(size, difficulty));
      button.appendChild(progressSummary);
      button.addEventListener("click", () => openV2SmallMap(size, difficulty));
      el.difficultyOptions.appendChild(button);
    });
  }
  el.difficultyPicker?.classList.remove("hidden");
  if (pushHistory) history.pushState(v2HistoryState("world-map"), "");
  finishScreenLoading(el.difficultyPicker, loadingToken);
}

function openV2SmallMap(size, difficulty) {
  const replaceDifficultyHistory = history.state?.screen === "world-map"
    && Number.isInteger(Number(history.state.worldChoiceSize));
  state.mapSize = size;
  state.mapDifficulty = difficulty;
  state.mapLocation = null;
  closeDifficultyPicker();
  showAppScreen("small-map", !replaceDifficultyHistory);
  if (replaceDifficultyHistory) history.replaceState(v2HistoryState("small-map"), "");
}

function openWormholeMap() {
  state.mapSize = null;
  state.mapDifficulty = "random";
  state.mapLocation = null;
  closeDifficultyPicker();
  showAppScreen("small-map");
}

let mapStatusTimer = null;
function showSmallMapStatus(message) {
  if (!el.smallMapStatus) return;
  if (mapStatusTimer !== null) clearTimeout(mapStatusTimer);
  el.smallMapStatus.textContent = message;
  el.smallMapStatus.classList.remove("hidden");
  mapStatusTimer = setTimeout(() => el.smallMapStatus?.classList.add("hidden"), 2400);
}

function renderWormholeMap() {
  if (!V2_MAP_DATA) return;
  el.smallMapTitle.textContent = "蟲洞 · 隨機關卡";
  el.smallMapProgress?.classList.add("hidden");
  el.smallMapBackground.src = "images/smallmap/1map08.png";
  el.smallMapBackground.alt = "蟲洞隨機關卡地圖";
  el.btnWormholeShare?.classList.remove("hidden");
  if (el.btnWormholeShare) setMapPosition(el.btnWormholeShare, 34, 15);

  V2_MAP_DATA.wormholeEntries.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wormhole-size-button";
    setMapPosition(button, entry.x, entry.y);
    button.setAttribute("aria-label", `產生${entry.size}乘${entry.size}隨機關卡`);
    const image = document.createElement("img");
    image.src = entry.image;
    image.alt = "";
    image.decoding = "async";
    button.appendChild(image);
    button.addEventListener("click", () => startRandomLevel(entry.size, button));
    el.smallMapSpots.appendChild(button);
  });
}

function renderV2StageNodes(mapDefinition, location) {
  const { size, difficulty } = mapDefinition;
  for (let stage = 1; stage <= 10; stage++) {
    const localLevel = v2LocalLevel(location, stage);
    const unlocked = isV2StageUnlocked(size, difficulty, location, stage);
    const visual = v2StageVisualState(size, difficulty, localLevel, unlocked);
    const hasSavedProgress = unlocked && hasV2SavedProgress(size, difficulty, localLevel);
    const [x, y] = V2_MAP_DATA.stageCoordinates[stage - 1];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `map-stage-button ${visual === "locked" ? "locked" : ""}`;
    button.style.setProperty("--stage-order", String(stage - 1));
    setMapPosition(button, x, y);
    button.disabled = !unlocked;
    button.setAttribute("aria-label", `${location}-${stage}${unlocked ? (hasSavedProgress ? "，有中途紀錄" : "") : "，尚未解鎖"}`);

    const image = document.createElement("img");
    image.src = `images/UI/ui_stagenode_${V2_STAGE_IMAGE[visual]}.png`;
    image.alt = "";
    button.appendChild(image);

    if (hasSavedProgress) {
      const progressImage = document.createElement("img");
      progressImage.className = "map-stage-current";
      progressImage.src = "images/UI/ui_stagenode_00.png";
      progressImage.alt = "";
      button.appendChild(progressImage);
    }

    button.addEventListener("click", async () => {
      if (!state.fixedLevelsReady) {
        showSmallMapStatus("2.0 正式關卡將在最後階段生成，目前只開放地圖流程測試。");
        return;
      }
      button.disabled = true;
      try {
        if (difficulty === "hard") await startHardLevel(v2HardLevel(size, localLevel), true);
        else await startLevel(size, localLevel, true);
      } catch (error) {
        console.error(error);
        showSmallMapStatus(error?.message || "關卡讀取失敗");
        button.disabled = false;
      }
    });
    el.smallMapStages.appendChild(button);
  }
}

function renderRegularSmallMap() {
  const mapDefinition = V2_MAP_DATA?.smallMaps?.[`${state.mapSize}:${state.mapDifficulty}`];
  if (!mapDefinition) return;
  const progressSummary = getV2ProgressSummary(mapDefinition.size, mapDefinition.difficulty);
  el.smallMapTitle.textContent = mapDefinition.title;
  renderV2ProgressSummary(el.smallMapProgress, progressSummary);
  el.smallMapProgress?.classList.remove("hidden");
  el.smallMapBackground.src = mapDefinition.background;
  el.smallMapBackground.alt = mapDefinition.title;
  el.btnWormholeShare?.classList.add("hidden");

  if (Number.isInteger(state.mapLocation)) {
    renderV2StageNodes(mapDefinition, state.mapLocation);
    return;
  }

  mapDefinition.locations.forEach((name, index) => {
    const location = index + 1;
    const visual = v2SpotVisualState(mapDefinition.size, mapDefinition.difficulty, location);
    const savedCount = progressSummary.savedByLocation[index];
    const [x, y] = V2_MAP_DATA.spotCoordinates[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `map-spot-button ${visual === "locked" ? "locked" : ""}`;
    setMapPosition(button, x, y);
    button.disabled = visual === "locked";
    button.title = name;
    button.setAttribute("aria-label", `地點${location}，${name}${visual === "locked" ? "，尚未解鎖" : ""}${savedCount ? `，中途紀錄 ${savedCount} 關` : ""}`);

    const image = document.createElement("img");
    image.src = `images/UI/ui_mapspot_${visual === "perfect" ? "Perfect" : visual}.png`;
    image.alt = "";
    button.appendChild(image);
    if (savedCount) {
      const progressBadge = document.createElement("span");
      progressBadge.className = "map-spot-progress";
      progressBadge.innerHTML = `<img src="images/UI/ui_stagenode_00.png" alt=""><b>${savedCount}</b>`;
      progressBadge.setAttribute("aria-hidden", "true");
      button.appendChild(progressBadge);
    }
    button.addEventListener("click", () => expandV2Location(location));
    el.smallMapSpots.appendChild(button);
  });

}

function renderV2SmallMap() {
  if (!el.smallMapBackground || !el.smallMapSpots || !el.smallMapStages) return;
  el.smallMapSpots.innerHTML = "";
  el.smallMapStages.innerHTML = "";
  el.smallMapStatus?.classList.add("hidden");
  if (state.mapDifficulty === "random") renderWormholeMap();
  else renderRegularSmallMap();
}

function levelBookBaseCount(size, difficulty) {
  if (difficulty === "normal") return Math.max(0, Number(state.sizes[size]) || 0);
  const offset = (Number(size) - 6) * V2_FIXED_LEVELS_PER_SIZE;
  return Math.max(0, Math.min(V2_FIXED_LEVELS_PER_SIZE, state.hardLevelCount - offset));
}

function levelBookCount(size = state.bookSize, difficulty = state.bookDifficulty) {
  return state.bookChapter === "extra"
    ? extraLevelCount(size, difficulty)
    : levelBookBaseCount(size, difficulty);
}

function levelBookBaseUnlocked(size, difficulty) {
  return isV2SizeUnlocked(size) && (difficulty === "normal"
    || !state.fixedLevelsReady || isV2LevelCleared(size, "normal", 1));
}

function levelBookDifficultyAvailable(size, difficulty) {
  return levelBookBaseUnlocked(size, difficulty);
}

function levelBookExtraUnlocked(size, difficulty) {
  return levelBookBaseUnlocked(size, difficulty) && extraLevelCount(size, difficulty) > 0;
}

function levelBookStarKey(size, difficulty, localLevel, chapter = state.bookChapter) {
  return chapter === "extra"
    ? fixedStarKey(size, difficulty === "hard" ? "hard" : "fixed", localLevel, "extra")
    : v2StarKey(size, difficulty, localLevel);
}

function levelBookProgressKey(size, difficulty, localLevel, chapter = state.bookChapter) {
  return chapter === "extra"
    ? progressKey(difficulty === "hard" ? "hard" : "fixed", size, localLevel, null, "extra")
    : v2ProgressKey(size, difficulty, localLevel);
}

function getLevelBookProgressSummary(size, difficulty) {
  const stars = getStars();
  const progress = getProgressStore();
  const counts = {
    base: levelBookBaseCount(size, difficulty),
    extra: extraLevelCount(size, difficulty),
  };
  let passed = 0, completed = 0, saved = 0;
  for (const chapter of ["base", "extra"]) {
    for (let localLevel = 1; localLevel <= counts[chapter]; localLevel++) {
      const earnedStars = Number(stars[levelBookStarKey(size, difficulty, localLevel, chapter)] || 0);
      if (earnedStars > 0) passed++;
      if (earnedStars >= HEARTS_MAX) completed++;
      if (progress[levelBookProgressKey(size, difficulty, localLevel, chapter)]) saved++;
    }
  }
  return { passed, completed, saved, total: counts.base + counts.extra };
}

function levelBookParts(localLevel) {
  return {
    location: Math.floor((localLevel - 1) / 10) + 1,
    stage: ((localLevel - 1) % 10) + 1,
  };
}

function isLevelBookDifficultyUnlocked(size, difficulty) {
  return levelBookDifficultyAvailable(size, difficulty);
}

function openLevelBook() {
  state.bookSize = null;
  state.bookDifficulty = "normal";
  state.bookChapter = "base";
  state.bookPage = 0;
  showAppScreen("level-book");
}

function openLevelBookSize(size) {
  state.bookSize = Number(size);
  state.bookDifficulty = levelBookDifficultyAvailable(state.bookSize, "normal") ? "normal" : "hard";
  state.bookChapter = "base";
  state.bookPage = 0;
  renderLevelBook();
  history.pushState(v2HistoryState("level-book"), "");
}

function setLevelBookDifficulty(difficulty) {
  if (!levelBookDifficultyAvailable(state.bookSize, difficulty)) return;
  state.bookDifficulty = difficulty;
  if (state.bookChapter === "extra" && !levelBookExtraUnlocked(state.bookSize, difficulty)) state.bookChapter = "base";
  state.bookPage = 0;
  renderLevelBook();
  history.replaceState(v2HistoryState("level-book"), "");
}

function setLevelBookChapter(chapter) {
  if (chapter === "base" && !levelBookBaseUnlocked(state.bookSize, state.bookDifficulty)) return;
  if (chapter === "extra" && !levelBookExtraUnlocked(state.bookSize, state.bookDifficulty)) return;
  state.bookChapter = chapter;
  state.bookPage = 0;
  renderLevelBook();
  history.replaceState(v2HistoryState("level-book"), "");
}

function setLevelBookPage(page) {
  const pageCount = Math.max(1, Math.ceil(levelBookCount() / LEVEL_BOOK_PAGE_SIZE));
  state.bookPage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  renderLevelBookLevels();
  history.replaceState(v2HistoryState("level-book"), "");
}

function renderLevelBookEntry() {
  if (!el.levelBookEntry) return;
  el.levelBookTitle.textContent = "關卡手冊";
  el.levelBookEntry.innerHTML = "";
  el.levelBookEntry.classList.remove("hidden");
  el.levelBookLevels?.classList.add("hidden");

  V2_MAP_DATA.worldPages.flatMap((page) => page.entries).forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "level-book-entry-button";
    const unlocked = entry.type === "random" ? isV2WormholeUnlocked()
      : levelBookDifficultyAvailable(entry.size, "normal") || levelBookDifficultyAvailable(entry.size, "hard");
    button.disabled = !unlocked;
    button.classList.toggle("locked", !unlocked);

    const image = document.createElement("img");
    image.src = entry.image;
    image.alt = "";
    button.appendChild(image);

    if (entry.type === "random") {
      button.setAttribute("aria-label", `蟲洞隨機關卡${unlocked ? "" : "，尚未解鎖"}`);
      button.addEventListener("click", openWormholeMap);
    } else {
      const title = V2_MAP_DATA.smallMaps[`${entry.size}:normal`]?.title || `${entry.size}×${entry.size}`;
      button.setAttribute("aria-label", `${title}${unlocked ? "" : "，尚未解鎖"}`);
      button.addEventListener("click", () => openLevelBookSize(entry.size));
    }
    el.levelBookEntry.appendChild(button);
  });
}

function renderLevelBookDifficulties() {
  const size = state.bookSize;
  if (!el.levelBookDifficulties || !Number.isInteger(size)) return;
  el.levelBookDifficulties.innerHTML = "";
  const imageNumber = String(size - 5).padStart(2, "0");
  for (const difficulty of ["normal", "hard"]) {
    const button = document.createElement("button");
    const unlocked = levelBookDifficultyAvailable(size, difficulty);
    const selected = state.bookDifficulty === difficulty;
    button.type = "button";
    button.className = `level-book-difficulty ${selected ? "selected" : ""} ${unlocked ? "" : "locked"}`;
    button.disabled = !unlocked;
    button.setAttribute("aria-label", `${difficulty === "hard" ? "高難" : "普通"}難度${unlocked ? "" : "，尚未解鎖"}`);
    button.setAttribute("aria-pressed", String(selected));
    const image = document.createElement("img");
    image.src = `images/smallmap/sBtn${imageNumber}${difficulty === "hard" ? "b" : "a"}.png`;
    image.alt = "";
    button.appendChild(image);
    button.addEventListener("click", () => setLevelBookDifficulty(difficulty));
    el.levelBookDifficulties.appendChild(button);
  }
}

function renderLevelBookChapters() {
  if (!el.levelBookChapters) return;
  el.levelBookChapters.innerHTML = "";
  for (const chapter of ["base", "extra"]) {
    const available = chapter === "base"
      ? levelBookBaseUnlocked(state.bookSize, state.bookDifficulty)
      : levelBookExtraUnlocked(state.bookSize, state.bookDifficulty);
    if (chapter === "extra" && !available) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `level-book-chapter ${state.bookChapter === chapter ? "selected" : ""}`;
    button.disabled = !available;
    button.textContent = chapter === "base" ? "原有章節" : "追加章節";
    button.setAttribute("aria-pressed", String(state.bookChapter === chapter));
    button.addEventListener("click", () => setLevelBookChapter(chapter));
    el.levelBookChapters.appendChild(button);
  }
  el.levelBookChapters.classList.toggle("single", el.levelBookChapters.childElementCount === 1);
}

async function startLevelBookLevel(localLevel, button) {
  if (levelBookSwipeMoved) return;
  button.disabled = true;
  try {
    if (state.bookChapter === "extra") {
      await startExtraLevel(state.bookSize, state.bookDifficulty, localLevel);
    } else if (state.bookDifficulty === "hard") {
      await startHardLevel(v2HardLevel(state.bookSize, localLevel));
    } else {
      await startLevel(state.bookSize, localLevel);
    }
  } catch (error) {
    console.error(error);
    if (el.levelBookStatus) el.levelBookStatus.textContent = error?.message || "關卡讀取失敗";
    button.disabled = false;
  }
}

function renderLevelBookLevels() {
  const size = state.bookSize;
  const difficulty = state.bookDifficulty;
  const mapDefinition = V2_MAP_DATA.smallMaps[`${size}:${difficulty}`];
  if (!mapDefinition || !el.levelBookGrid) return;

  const count = levelBookCount(size, difficulty);
  const pageCount = Math.max(1, Math.ceil(count / LEVEL_BOOK_PAGE_SIZE));
  state.bookPage = Math.max(0, Math.min(pageCount - 1, state.bookPage));
  const start = state.bookPage * LEVEL_BOOK_PAGE_SIZE + 1;
  const end = Math.min(count, start + LEVEL_BOOK_PAGE_SIZE - 1);
  const stars = getStars();
  const progress = getProgressStore();
  const { passed, completed, saved, total } = getLevelBookProgressSummary(size, difficulty);

  const completedPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  el.levelBookProgress.innerHTML = `
    <div class="level-book-progress-ring" style="--level-book-progress: ${completedPercent}%" role="progressbar" aria-label="三星完成進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${completedPercent}"><strong>${completedPercent}%</strong></div>
    <div class="level-book-progress-stats">
      <span><b><img src="images/UI/ui_mapspot_cleared.png" alt="">通過</b><strong>${passed} / ${total}</strong></span>
      <span><b><img src="images/UI/ui_stagenode_05.png" alt="">完成</b><strong>${completed} / ${total}</strong></span>
      <span><b><img src="images/UI/ui_stagenode_00.png" alt="">中途紀錄</b><strong>${saved}</strong></span>
    </div>`;
  el.levelBookPage.textContent = `${state.bookPage + 1} / ${pageCount}`;
  el.btnLevelBookPrev.disabled = state.bookPage === 0;
  el.btnLevelBookNext.disabled = state.bookPage === pageCount - 1;
  el.levelBookStatus.textContent = "";
  el.levelBookGrid.innerHTML = "";

  for (let localLevel = start; localLevel <= end; localLevel++) {
    const { location, stage } = levelBookParts(localLevel);
    const unlocked = state.bookChapter === "extra"
      ? levelBookExtraUnlocked(size, difficulty)
      : isV2StageUnlocked(size, difficulty, location, stage);
    const earnedStars = Math.max(0, Math.min(HEARTS_MAX, Number(stars[levelBookStarKey(size, difficulty, localLevel)] || 0)));
    const saved = unlocked && !!progress[levelBookProgressKey(size, difficulty, localLevel)];
    const extra = state.bookChapter === "extra";
    const place = extra ? "追加關卡" : (mapDefinition.locations[location - 1] || `地點 ${location}`);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `level-book-level ${unlocked ? "" : "locked"} ${earnedStars > 0 ? "done" : ""}`;
    button.disabled = !unlocked;
    button.dataset.level = String(localLevel);
    button.dataset.stars = String(earnedStars);
    const displayName = extra ? `${place} ${localLevel}` : `${place} ${location}-${stage}`;
    button.setAttribute("aria-label", `${displayName}，${unlocked ? (earnedStars ? `${earnedStars}個肉球通關` : "已解鎖，尚未通關") : "尚未解鎖"}${saved ? "，有中途紀錄" : ""}`);

    const levelName = document.createElement("span");
    levelName.textContent = extra ? String(localLevel) : `${location}-${stage}`;
    const placeName = document.createElement("strong");
    placeName.textContent = place;
    button.append(placeName, levelName);
    if (unlocked) {
      const starDisplay = document.createElement("small");
      starDisplay.innerHTML = pawIconsHtml(earnedStars);
      button.appendChild(starDisplay);
    }
    if (saved) {
      const progress = document.createElement("img");
      progress.className = "level-book-saved";
      progress.src = "images/UI/ui_stagenode_00.png";
      progress.alt = "";
      progress.setAttribute("aria-hidden", "true");
      button.appendChild(progress);
    }
    button.addEventListener("click", () => startLevelBookLevel(localLevel, button));
    el.levelBookGrid.appendChild(button);
  }
}

function renderLevelBook() {
  if (!Number.isInteger(state.bookSize)) {
    renderLevelBookEntry();
    return;
  }
  if (!levelBookDifficultyAvailable(state.bookSize, state.bookDifficulty)) {
    state.bookSize = null;
    renderLevelBookEntry();
    return;
  }
  if (state.bookChapter === "extra" && !levelBookExtraUnlocked(state.bookSize, state.bookDifficulty)) state.bookChapter = "base";
  const mapDefinition = V2_MAP_DATA.smallMaps[`${state.bookSize}:${state.bookDifficulty}`];
  const theme = mapDefinition?.title?.split(" · ")[1] || `${state.bookSize}×${state.bookSize}`;
  el.levelBookTitle.textContent = `${state.bookSize}×${state.bookSize} ${theme}`;
  el.levelBookEntry?.classList.add("hidden");
  el.levelBookLevels?.classList.remove("hidden");
  renderLevelBookDifficulties();
  renderLevelBookChapters();
  renderLevelBookLevels();
}

let levelBookSwipeStartX = null;
let levelBookSwipeMoved = false;

function expandV2Location(location, pushHistory = true) {
  state.mapLocation = location;
  renderV2SmallMap();
  if (pushHistory) history.pushState(v2HistoryState("small-map"), "");
}

function v2HistoryState(screen) {
  if (screen === "world-map") {
    return { screen, worldChoiceSize: state.worldChoiceSize, worldPage: state.worldPage };
  }
  if (screen === "small-map") {
    return {
      screen,
      mapSize: state.mapSize,
      mapDifficulty: state.mapDifficulty,
      mapLocation: state.mapLocation,
      worldPage: state.worldPage,
    };
  }
  if (screen === "level-book") {
    return {
      screen,
      bookSize: state.bookSize,
      bookDifficulty: state.bookDifficulty,
      bookChapter: state.bookChapter,
      bookPage: state.bookPage,
    };
  }
  return { screen };
}

function restoreV2HistoryState(navState) {
  const screen = navState?.screen;
  if (Number.isInteger(Number(navState?.worldPage))) {
    state.worldPage = Math.max(0, Math.min(2, Number(navState.worldPage)));
  }
  if (screen === "world-map") {
    const choice = Number(navState?.worldChoiceSize);
    state.worldChoiceSize = Number.isInteger(choice) && choice >= 6 && choice <= 12 ? choice : null;
  } else if (screen === "small-map") {
    const size = Number(navState?.mapSize);
    const location = Number(navState?.mapLocation);
    state.mapSize = Number.isInteger(size) && size >= 6 && size <= 12 ? size : null;
    state.mapDifficulty = navState?.mapDifficulty === "hard" ? "hard"
      : navState?.mapDifficulty === "random" ? "random" : "normal";
    state.mapLocation = Number.isInteger(location) && location >= 1 && location <= 10 ? location : null;
  } else if (screen === "level-book") {
    const size = Number(navState?.bookSize);
    state.bookSize = Number.isInteger(size) && size >= 6 && size <= 12 ? size : null;
    state.bookDifficulty = navState?.bookDifficulty === "hard" ? "hard" : "normal";
    state.bookChapter = navState?.bookChapter === "extra" ? "extra" : "base";
    state.bookPage = Math.max(0, Number(navState?.bookPage) || 0);
  }
}

async function init() {
  // Bind all event listeners synchronously BEFORE any async operations so that
  // browser caching of an older JS file can never leave buttons unresponsive.
  updateToggleUI();
  applyCellStyle(settings.cellStyle);
  applyReminderIconChoice(settings.reminderIcon);
  applyAppTheme();
  applyRegionColors();
  renderBlockColorEditor();
  document.body.dataset.appScreen = "entry";
  try { history.replaceState({ screen: "entry" }, ""); } catch { }
  document.addEventListener("click", (event) => {
    if (document.body.dataset.appScreen === "game") return;
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (button && !button.disabled) soundManager?.playButton();
  }, true);

  el.btnEntryStart?.addEventListener("click", () => showAppScreen("home"));
  el.btnHomeLevels?.addEventListener("click", () => {
    state.worldChoiceSize = null;
    showAppScreen("world-map");
  });
  el.btnHomeLevelBook?.addEventListener("click", openLevelBook);
  el.btnHomeStyles?.addEventListener("click", () => showAppScreen("styles"));
  el.btnHomeHistory?.addEventListener("click", () => showAppScreen("history"));
  el.btnHistoryRandomDetails?.addEventListener("click", () => showAppScreen("history-random"));
  el.btnHomeSettings?.addEventListener("click", showSettingsScreen);
  el.pageSettingsButtons.forEach((btn) => btn.addEventListener("click", showSettingsScreen));
  el.btnLevelModesBack?.addEventListener("click", () => history.back());
  el.btnWorldBack?.addEventListener("click", () => history.back());
  el.btnSmallMapBack?.addEventListener("click", () => history.back());
  el.btnLevelBookBack?.addEventListener("click", () => history.back());
  el.btnDifficultyClose?.addEventListener("click", () => history.back());
  el.btnWormholeShare?.addEventListener("click", () => document.getElementById("btn-import-share-code")?.click());
  el.btnLevelBookPrev?.addEventListener("click", () => setLevelBookPage(state.bookPage - 1));
  el.btnLevelBookNext?.addEventListener("click", () => setLevelBookPage(state.bookPage + 1));
  el.levelBookGrid?.addEventListener("pointerdown", (event) => {
    levelBookSwipeStartX = event.clientX;
    levelBookSwipeMoved = false;
  });
  el.levelBookGrid?.addEventListener("pointerup", (event) => {
    if (levelBookSwipeStartX === null) return;
    const delta = event.clientX - levelBookSwipeStartX;
    levelBookSwipeStartX = null;
    if (Math.abs(delta) < 50) return;
    levelBookSwipeMoved = true;
    setLevelBookPage(state.bookPage + (delta < 0 ? 1 : -1));
    setTimeout(() => { levelBookSwipeMoved = false; }, 0);
  });
  el.levelBookGrid?.addEventListener("pointercancel", () => { levelBookSwipeStartX = null; });
  el.worldMapPager?.addEventListener("scroll", () => {
    const height = el.worldMapPager.clientHeight;
    if (height <= 0) return;
    const visualPage = Math.max(0, Math.min(2, Math.round(el.worldMapPager.scrollTop / height)));
    const page = invertWorldPage(visualPage, V2_MAP_DATA.worldPages.length);
    if (page !== state.worldPage) {
      state.worldPage = page;
      syncWorldMapIndicator();
      syncWorldMapAssets();
      if (history.state?.screen === "world-map") {
        history.replaceState(v2HistoryState("world-map"), "");
      }
    }
  }, { passive: true });
  el.btnModeFixed?.addEventListener("click", openFixedLevelSelect);
  el.btnModeHard?.addEventListener("click", openHardLevelSelect);
  el.btnModeRandom?.addEventListener("click", () => showAppScreen("random-select"));
  el.btnFixedBack?.addEventListener("click", () => history.back());
  el.btnRandomBack?.addEventListener("click", () => history.back());
  el.btnStylesBack?.addEventListener("click", () => history.back());
  el.btnHistoryBack?.addEventListener("click", () => history.back());
  el.btnHistoryRandomBack?.addEventListener("click", () => history.back());
  el.btnBack.addEventListener("click", () => history.back());
  el.btnSettings?.addEventListener("click", showSettingsScreen);
  el.btnSettingsBack?.addEventListener("click", () => history.back());
  el.btnBlockColors?.addEventListener("click", showBlockColorsScreen);
  el.btnReminderIcons?.addEventListener("click", showReminderIconsScreen);
  el.btnReminderIconsBack?.addEventListener("click", () => history.back());
  el.btnBlockColorsBack?.addEventListener("click", () => history.back());
  el.btnRestart.addEventListener("click", clearBoard);
  el.btnBackpack?.addEventListener("click", openBackpack);
  el.btnBackpackClose?.addEventListener("click", closeBackpack);
  el.backpackList?.querySelectorAll("[data-item-manual]").forEach(button => {
    button.addEventListener("click", () => openItemManual(button));
  });
  el.btnItemManualBack?.addEventListener("click", closeItemManual);
  el.btnItemDetector?.addEventListener("click", startDetectorSelection);
  el.btnItemFish?.addEventListener("click", useDriedFish);
  el.btnItemBreadcrumb?.addEventListener("click", useBreadcrumb);
  el.btnDetectorCancel?.addEventListener("click", closeBackpack);
  el.btnDetectorNo?.addEventListener("click", closeBackpack);
  el.btnDetectorYes?.addEventListener("click", useDetector);
  el.backpackModal?.addEventListener("click", event => {
    if (event.target === el.backpackModal) globalThis.meowdokuCloseBackpack();
  });
  for (const modal of [el.backpackModal, el.detectorConfirmModal]) {
    modal?.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const buttons = [...modal.querySelectorAll("button:not(:disabled)")].filter(button => button.getClientRects().length);
      const next = buttons[(buttons.indexOf(document.activeElement) + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length];
      event.preventDefault();
      next?.focus();
    });
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && globalThis.meowdokuCloseBackpack()) event.preventDefault();
  });
  el.board.addEventListener("keydown", event => {
    if (itemInteraction !== "select") return;
    const index = cellEls.flat().indexOf(document.activeElement);
    if (index < 0) return;
    const r = Math.floor(index / state.n), c = index % state.n;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectDetectorCenter(r, c);
    } else {
      const offset = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
      if (!offset) return;
      event.preventDefault();
      cellEls[Math.max(0, Math.min(state.n - 1, r + offset[0]))][Math.max(0, Math.min(state.n - 1, c + offset[1]))].focus();
    }
  });
  el.btnSaveProgress?.addEventListener("click", openSaveProgressConfirm);
  el.btnSaveProgressNo?.addEventListener("click", closeSaveProgressConfirm);
  el.btnSaveProgressYes?.addEventListener("click", confirmSaveProgress);
  el.saveProgressModal?.addEventListener("click", (event) => {
    if (event.target === el.saveProgressModal) closeSaveProgressConfirm();
  });
  el.btnNextLevel?.addEventListener("click", () => {
    el.winModal.classList.add("hidden");
    if (state.mode === "random") startRandomLevel(state.n);
    else if (state.levelChapter === "extra") {
      startExtraLevel(state.n, state.mode === "hard" ? "hard" : "normal", state.levelIdx + 1);
    }
    else if (state.mode === "hard") startHardLevel(state.levelIdx + 1, state.launchedFromMap);
    else startLevel(state.n, state.levelIdx + 1, state.launchedFromMap);
  });
  el.btnReplay?.addEventListener("click", () => {
    el.winModal.classList.add("hidden");
    if (el.btnReplay.dataset.action === "next-location"
        && state.levelChapter === "base" && ["fixed", "hard"].includes(state.mode)) {
      const target = (state.mode === "hard"
        ? hardWinRoute(state.n, state.levelIdx)
        : normalWinRoute(state.n, state.levelIdx)).nextLocation;
      if (target) {
        if (state.mode === "hard") startHardLevel(v2HardLevel(target.size, target.localLevel), state.launchedFromMap);
        else startLevel(target.size, target.localLevel, state.launchedFromMap);
      }
      return;
    }
    restartCurrentGame();
  });
  el.btnModalBack?.addEventListener("click", () => {
    el.winModal.classList.add("hidden");
    history.back();
  });

  el.btnHelp?.addEventListener("click", () => el.helpModal.classList.remove("hidden"));
  el.btnHelpClose?.addEventListener("click", () => {
    el.helpModal.classList.add("hidden")
    settings.showHelp = false;
    saveSettings();
  });
  el.helpModal?.addEventListener("click", (e) => {
    if (e.target === el.helpModal) el.helpModal.classList.add("hidden");
  });

  window.addEventListener("popstate", (event) => {
    const target = event.state?.screen || "home";
    restoreV2HistoryState(event.state);
    showAppScreen(target, false);
  });

  el.btnToggleSoundEffects?.addEventListener("click", () => {
    settings.soundEffects = !settings.soundEffects;
    saveSettings();
    soundManager?.setEnabled(settings.soundEffects);
    updateToggleUI();
  });

  el.btnToggleVibrate?.addEventListener("click", () => {
    settings.vibrate = !settings.vibrate;
    saveSettings();
    updateToggleUI();
    if (settings.vibrate) vibrate("setting", 100);
  });
  el.btnToggleMarkDimming?.addEventListener("click", () => {
    settings.markDimming = !settings.markDimming;
    saveSettings();
    updateToggleUI();
  });
  el.btnToggleAuto?.addEventListener("click", () => {
    settings.autoElim = !settings.autoElim;
    saveSettings();
    updateToggleUI();
  });
  el.btnToggleHypo?.addEventListener("click", () => {
    settings.hypo = !settings.hypo;
    saveSettings();
    updateToggleUI();
  });

  el.themeModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyAppTheme(btn.dataset.themeMode, settings.themeAccent);
      saveSettings();
    });
  });
  el.themeColorButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyAppTheme(settings.themeMode, btn.dataset.themeAccent);
      saveSettings();
    });
  });
  el.reminderIconButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyReminderIconChoice(btn.dataset.reminderIcon);
      saveSettings();
    });
  });
  el.btnResetBlockColors?.addEventListener("click", () => {
    settings.regionColors = DEFAULT_REGION_COLORS.slice();
    applyRegionColors();
    renderBlockColorEditor();
    if (activeBlockColorIndex !== null) syncBlockColorEditor(settings.regionColors[activeBlockColorIndex]);
    saveSettings();
  });

  el.btnBlockColorEditorClose?.addEventListener("click", closeBlockColorEditor);
  el.blockColorEditorModal?.addEventListener("click", (event) => {
    if (event.target === el.blockColorEditorModal) closeBlockColorEditor();
  });

  const rgbControls = getRgbControls();
  for (const channel of ["r", "g", "b"]) {
    rgbControls[channel].range?.addEventListener("input", () => {
      rgbControls[channel].number.value = rgbControls[channel].range.value;
      applyRgbEditorValues();
    });
    rgbControls[channel].number?.addEventListener("input", () => {
      const raw = rgbControls[channel].number.value;
      if (raw === "") return;
      const value = clampColorChannel(raw);
      rgbControls[channel].number.value = String(value);
      rgbControls[channel].range.value = String(value);
      applyRgbEditorValues();
    });
    rgbControls[channel].number?.addEventListener("change", () => {
      const value = clampColorChannel(rgbControls[channel].number.value);
      rgbControls[channel].number.value = String(value);
      rgbControls[channel].range.value = String(value);
      applyRgbEditorValues();
    });
  }

  const stepRgbChannel = (btn) => {
    const channel = btn.dataset.channel;
    const delta = Number.parseInt(btn.dataset.delta || "0", 10);
    const control = rgbControls[channel];
    if (!control || !Number.isFinite(delta)) return;
    const value = clampColorChannel(Number.parseInt(control.number.value || "0", 10) + delta);
    control.number.value = String(value);
    control.range.value = String(value);
    applyRgbEditorValues();
  };

  let rgbHoldDelayTimer = null;
  let rgbHoldRepeatTimer = null;
  let rgbHoldButton = null;
  let rgbHoldRepeatCount = 0;

  const stopRgbStepHold = () => {
    if (rgbHoldDelayTimer !== null) {
      clearTimeout(rgbHoldDelayTimer);
      rgbHoldDelayTimer = null;
    }
    if (rgbHoldRepeatTimer !== null) {
      clearTimeout(rgbHoldRepeatTimer);
      rgbHoldRepeatTimer = null;
    }
    rgbHoldButton = null;
    rgbHoldRepeatCount = 0;
  };

  const scheduleRgbStepRepeat = () => {
    if (!rgbHoldButton) return;
    stepRgbChannel(rgbHoldButton);
    rgbHoldRepeatCount += 1;
    const intervalMs = rgbHoldRepeatCount >= 10 ? 45 : 90;
    rgbHoldRepeatTimer = setTimeout(scheduleRgbStepRepeat, intervalMs);
  };

  el.rgbStepButtons.forEach((btn) => {
    btn.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      stopRgbStepHold();
      btn.dataset.pointerHandled = "1";
      rgbHoldButton = btn;
      stepRgbChannel(btn);
      rgbHoldDelayTimer = setTimeout(() => {
        rgbHoldDelayTimer = null;
        scheduleRgbStepRepeat();
      }, 350);
    });

    btn.addEventListener("pointerup", stopRgbStepHold);
    btn.addEventListener("pointercancel", stopRgbStepHold);
    btn.addEventListener("pointerleave", stopRgbStepHold);
    btn.addEventListener("contextmenu", (event) => event.preventDefault());

    btn.addEventListener("click", (event) => {
      if (btn.dataset.pointerHandled === "1") {
        event.preventDefault();
        delete btn.dataset.pointerHandled;
        return;
      }
      stepRgbChannel(btn);
    });
  });

  window.addEventListener("pointerup", stopRgbStepHold);
  window.addEventListener("pointercancel", stopRgbStepHold);
  window.addEventListener("blur", () => {
    stopRgbStepHold();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) closeBackpack();
    if (document.hidden) {
      stopRgbStepHold();
      stopGameplayTimer();
    } else if (!el.screenGame?.classList.contains("hidden")) {
      startGameplayTimer();
    }
  });
  window.addEventListener("pagehide", stopGameplayTimer);

  el.blockColorHex?.addEventListener("input", () => {
    const raw = el.blockColorHex.value.trim();
    const rgb = hexToRgb(raw);
    if (!rgb || activeBlockColorIndex === null) return;
    const color = rgbToHex(rgb.r, rgb.g, rgb.b);
    syncBlockColorEditor(color);
    setRegionColor(activeBlockColorIndex, color);
  });
  el.blockColorHex?.addEventListener("change", () => {
    if (activeBlockColorIndex === null) return;
    const rgb = hexToRgb(el.blockColorHex.value);
    if (!rgb) {
      syncBlockColorEditor(settings.regionColors[activeBlockColorIndex]);
      return;
    }
    const color = rgbToHex(rgb.r, rgb.g, rgb.b);
    syncBlockColorEditor(color);
    setRegionColor(activeBlockColorIndex, color);
  });

  el.cellStyleButtons?.addEventListener("click", (e) => {
    const btn = e.target.closest(".cell-style-button");
    if (!btn) return;
    applyCellStyle(btn.dataset.cellStyle);
    saveSettings();
  });

  el.board.addEventListener("pointerdown", onPointerDown);
  el.board.addEventListener("pointermove", onPointerMove);
  el.board.addEventListener("pointerup", onPointerUp);
  el.board.addEventListener("pointercancel", onPointerUp);

  const res = await fetch("levels_index.json");
  const levelIndex = await res.json();
  state.sizes = levelIndex.sizes || levelIndex;
  state.extraLevels = normalizeExtraLevels(levelIndex.extras);
  state.fixedLevelsReady = levelIndex.v2Ready === true;
  state.hardLevelCount = Number.isInteger(Number(levelIndex.hard))
    ? Number(levelIndex.hard)
    : DEFAULT_HARD_LEVEL_COUNT;
  renderSizeButtons();
  renderRandomSizeButtons();
  finishScreenLoading(document, screenLoadToken);
}

function renderRandomSizeButtons() {
  if (!el.randomSizeButtons) return;
  el.randomSizeButtons.innerHTML = "";
  const records = getRandomTimes();
  Object.keys(state.sizes).sort((a, b) => a - b).forEach((n) => {
    const size = Number(n);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "random-size-button";
    const record = records[String(n)];
    const saved = loadProgressSnapshot("random", size, null);
    const stars = Math.max(0, Math.min(HEARTS_MAX, Number(record?.bestStars) || 0));
    const starText = pawIconsHtml(stars);
    btn.innerHTML = record?.bestMs != null
      ? `<strong>${n} × ${n}</strong><small><span class="random-size-stars">${starText}</span>最佳 ${formatElapsed(record.bestMs)}</small>`
      : `<strong>${n} × ${n}</strong><small><span class="random-size-stars">${starText}</span>尚無紀錄</small>`;
    if (saved) {
      const heart = document.createElement("span");
      heart.className = "random-progress-heart";
      heart.textContent = "♥";
      heart.setAttribute("aria-hidden", "true");
      btn.appendChild(heart);
      btn.setAttribute("aria-label", `${n} × ${n}，有中途紀錄，已進行 ${formatElapsed(saved.elapsedMs)}`);
    }
    btn.addEventListener("click", () => startRandomLevel(size, btn));
    el.randomSizeButtons.appendChild(btn);
  });
}

function isHardLevelSelection() {
  return state.selectionMode === "hard";
}

function currentFixedLevelCount() {
  return isHardLevelSelection() ? state.hardLevelCount : Number(state.sizes[state.n] || 0);
}

function currentFixedStarKey(idx) {
  return isHardLevelSelection() ? `hard:${idx}` : `${state.n}:${idx}`;
}

function syncFixedSelectionModeUI() {
  const hard = isHardLevelSelection();
  if (el.fixedSelectTitle) el.fixedSelectTitle.textContent = hard ? "高難關卡" : "一般關卡";
  el.sizeSelectionBlock?.classList.toggle("hidden", hard);
  el.screenSelect?.classList.toggle("hard-level-select", hard);
}

function resetFixedSelectionStage() {
  state.stageStart = null;
  el.stageButtons.innerHTML = "";
  el.levelButtons.innerHTML = "";
  el.levelButtons.classList.add("hidden");
  el.levelHeading.classList.add("hidden");
  el.levelSection?.classList.add("hidden");
}

function openFixedLevelSelect() {
  state.selectionMode = "fixed";
  state.mode = "fixed";
  state.n = null;
  resetFixedSelectionStage();
  syncFixedSelectionModeUI();
  [...el.sizeButtons.children].forEach((btn) => btn.classList.remove("selected"));
  showAppScreen("fixed-select");
}

function openHardLevelSelect() {
  state.selectionMode = "hard";
  resetFixedSelectionStage();
  syncFixedSelectionModeUI();
  renderStageButtons();
  showAppScreen("fixed-select");
}

function renderSizeButtons() {
  el.sizeButtons.innerHTML = "";
  Object.keys(state.sizes).sort((a, b) => a - b).forEach((n) => {
    const btn = document.createElement("button");
    btn.className = "size-button";
    btn.textContent = `${n} x ${n}`;
    btn.addEventListener("click", () => selectSize(Number(n)));
    el.sizeButtons.appendChild(btn);
  });
}

function selectSize(n) {
  state.selectionMode = "fixed";
  syncFixedSelectionModeUI();
  state.n = n;
  state.stageStart = null;
  [...el.sizeButtons.children].forEach((b) => {
    b.classList.toggle("selected", b.textContent.startsWith(`${n} `));
  });

  renderStageButtons();
  el.levelButtons.innerHTML = "";
  el.levelButtons.classList.add("hidden");
  el.levelHeading.classList.add("hidden");
  el.levelSection?.classList.add("hidden");
}

function stageEnd(start) {
  return Math.min(start + 99, currentFixedLevelCount());
}

function getStageThreeStarProgress(stars, start, end) {
  const total = Math.max(0, end - start + 1);
  let completed = 0;
  for (let i = start; i <= end; i++) {
    if ((stars[currentFixedStarKey(i)] || 0) === 3) completed++;
  }

  const percent = total > 0 ? Math.floor((completed / total) * 100) : 0;
  let band = "0";
  if (percent === 100) band = "100";
  else if (percent >= 76) band = "76-99";
  else if (percent >= 51) band = "51-75";
  else if (percent >= 26) band = "26-50";
  else if (percent >= 1) band = "1-25";

  return { completed, total, percent, band };
}

function renderStageButtons() {
  if (!isHardLevelSelection() && !state.n) {
    el.stageButtons.innerHTML = "";
    return;
  }
  const count = currentFixedLevelCount();
  const stars = getStars();
  el.stageButtons.innerHTML = "";



  for (let start = 1; start <= count; start += 100) {
    const end = Math.min(start + 99, count);
    const btn = document.createElement("button");
    btn.className = "stage-button";
    btn.dataset.stageStart = String(start);
    btn.textContent = `${start}~`;

    const progress = getStageThreeStarProgress(stars, start, end);
    btn.dataset.progressBand = progress.band;
    btn.dataset.progress = String(progress.percent);
    btn.title = `三肉球完成 ${progress.completed}/${progress.total}（${progress.percent}%）`;
    btn.setAttribute("aria-label", `${start} 到 ${end}，三肉球完成 ${progress.completed}/${progress.total}，${progress.percent}%`);

    if (progress.percent === 100) {
      btn.classList.add("done");
      btn.dataset.stars = "3";
    }

    const isExpanded = state.stageStart === start;
    btn.classList.toggle("selected", isExpanded);
    btn.setAttribute("aria-expanded", String(isExpanded));
    btn.setAttribute("aria-controls", "level-buttons");
    btn.addEventListener("click", () => selectStage(start));
    el.stageButtons.appendChild(btn);
  }
}

function selectStage(start) {
  if (!isHardLevelSelection() && !state.n) return;

  // Clicking the currently open stage closes its level list.
  if (state.stageStart === start && !el.levelButtons.classList.contains("hidden")) {
    state.stageStart = null;
    [...el.stageButtons.children].forEach((b) => {
      b.classList.remove("selected");
      b.setAttribute("aria-expanded", "false");
    });
    el.levelButtons.innerHTML = "";
    el.levelButtons.classList.add("hidden");
    el.levelHeading.classList.add("hidden");
    el.levelSection?.classList.add("hidden");
    return;
  }

  // Clicking another stage switches the open 100-level block directly.
  state.stageStart = start;
  [...el.stageButtons.children].forEach((b) => {
    const isExpanded = Number(b.dataset.stageStart) === start;
    b.classList.toggle("selected", isExpanded);
    b.setAttribute("aria-expanded", String(isExpanded));
  });
  renderLevelButtons(start);
}

function renderLevelButtons(start) {
  const count = currentFixedLevelCount();
  const end = Math.min(start + 99, count);
  const stars = getStars();
  const progressStore = getProgressStore();

  el.levelButtons.innerHTML = "";
  for (let i = start; i <= end; i++) {
    const btn = document.createElement("button");
    btn.className = "level-button";
    btn.dataset.level = String(i);
    btn.textContent = String(i);
    const s = stars[currentFixedStarKey(i)] || 0;
    if (s > 0) {
      btn.classList.add("done");
      btn.dataset.stars = String(s);
    }

    const progressStorageKey = isHardLevelSelection()
      ? progressKey("hard", 0, i)
      : progressKey("fixed", Number(state.n), i);
    if (progressStorageKey && progressStore[progressStorageKey]) {
      btn.classList.add("has-progress");
      const heart = document.createElement("span");
      heart.className = "progress-heart";
      heart.textContent = "♥";
      heart.setAttribute("aria-hidden", "true");
      btn.appendChild(heart);
      btn.setAttribute("aria-label", `${i}，有中途紀錄`);
    }

    btn.addEventListener("click", async () => {
      if (!isHardLevelSelection()) {
        startLevel(state.n, i);
        return;
      }

      const originalText = String(i);
      btn.disabled = true;
      btn.textContent = "…";
      try {
        await startHardLevel(i);
      } catch (error) {
        console.error(error);
        btn.classList.add("load-error");
        btn.textContent = "!";
        btn.title = error?.message || "高難關卡讀取失敗";
        setTimeout(() => {
          btn.classList.remove("load-error");
          btn.textContent = originalText;
          btn.title = "";
        }, 1400);
      } finally {
        btn.disabled = false;
      }
    });
    el.levelButtons.appendChild(btn);
  }

  el.levelHeading.textContent = `選擇關卡 ${start} ~ ${end}`;
  el.levelSection?.classList.remove("hidden");
  el.levelHeading.classList.remove("hidden");
  el.levelButtons.classList.remove("hidden");
}

function refreshDoneMarks() {
  syncFixedSelectionModeUI();
  if (!isHardLevelSelection() && !state.n) return;
  renderStageButtons();
  if (state.stageStart) renderLevelButtons(state.stageStart);
}

async function startLevel(n, idx, fromMap = false) {
  state.launchedFromMap = !!fromMap;
  state.stageStart = Math.floor((idx - 1) / 100) * 100 + 1;
  const path = `levels/normal/${n}x${n}/level_${n}_${String(idx).padStart(8, "0")}.txt`;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`關卡讀取失敗：${res.status}`);
  const text = await res.text();
  const { regions, solution } = parseLevel(text);
  beginGame({ n, mode: "fixed", levelIdx: idx, regions, solution, seed: null });
}

function saveHardStars(idx, stars) {
  const data = getStars();
  const key = `hard:${idx}`;
  if ((data[key] || 0) < stars) data[key] = stars;
  try { localStorage.setItem(DONE_STORAGE_KEY, JSON.stringify(data)); } catch { }
}

async function startHardLevel(idx, fromMap = false) {
  if (!Number.isInteger(idx) || idx < 1 || idx > state.hardLevelCount) {
    throw new Error(`高難關卡編號無效：${idx}`);
  }

  state.selectionMode = "hard";
  state.launchedFromMap = !!fromMap;
  state.stageStart = Math.floor((idx - 1) / 100) * 100 + 1;

  const boardSize = 6 + Math.floor((idx - 1) / 100);
  const localLevel = ((idx - 1) % 100) + 1;
  const path = `levels/hard/${boardSize}x${boardSize}/level_${boardSize}_${String(localLevel).padStart(8, "0")}.txt`;
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`高難關卡 ${idx} 讀取失敗：HTTP ${res.status}`);

  const text = await res.text();
  const parsed = parseLevel(text);
  const { n, regions, solution } = parsed;
  if (!Number.isInteger(n) || n < 1 || !Array.isArray(regions) || regions.length !== n
      || regions.some((row) => !Array.isArray(row) || row.length !== n)
      || !Array.isArray(solution) || solution.length !== n) {
    throw new Error(`高難關卡 ${idx} 格式錯誤`);
  }

  beginGame({ n, mode: "hard", levelIdx: idx, regions, solution, seed: null });
}

async function startExtraLevel(size, difficulty, idx) {
  size = Number(size);
  idx = Number(idx);
  if (!Number.isInteger(size) || size < 6 || size > 12
      || !["normal", "hard"].includes(difficulty)
      || !Number.isInteger(idx) || idx < 1 || idx > extraLevelCount(size, difficulty)) {
    throw new Error("追加關卡編號無效");
  }
  if (!levelBookBaseUnlocked(size, difficulty)) throw new Error("追加關卡尚未解鎖");

  state.launchedFromMap = false;
  state.stageStart = null;
  const path = `levels/extra/${difficulty}/${size}x${size}/level_${size}_${String(idx).padStart(8, "0")}.txt`;
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`追加關卡讀取失敗：HTTP ${res.status}`);
  const { n, regions, solution } = parseLevel(await res.text());
  if (n !== size) throw new Error("追加關卡尺寸不符");
  beginGame({ n, mode: difficulty === "hard" ? "hard" : "fixed", levelIdx: idx,
    regions, solution, seed: null, chapter: "extra" });
}

let randomGenerating = false;

function generateRandomLevelAsync(n) {
  if (typeof Worker !== "undefined") {
    return new Promise((resolve, reject) => {
      const worker = new Worker("random-generator.js");
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(new Error("隨機關卡生成超過 6 秒限制"));
      }, RANDOM_GENERATION_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timeoutId);
        worker.terminate();
      };
      worker.onmessage = (event) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (event.data?.ok) resolve(event.data.level);
        else reject(new Error(event.data?.error || "隨機關卡生成失敗"));
      };
      worker.onerror = (event) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(event.message || "隨機關卡生成失敗"));
      };
      worker.postMessage({ n });
    });
  }
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(globalThis.MeowdokuRandomGenerator.generateRandomLevel(n)); }
      catch (error) { reject(error); }
    }, 0);
  });
}

async function startRandomLevel(n, triggerButton = null) {
  state.launchedFromMap = false;
  n = Number(n);
  const saved = loadProgressSnapshot("random", n, null);
  if (saved) {
    state.stageStart = null;
    beginGame({
      n,
      mode: "random",
      levelIdx: null,
      regions: saved.regions,
      solution: saved.solution,
      seed: saved.seed,
    });
    return;
  }

  if (randomGenerating) return;
  randomGenerating = true;
  const originalText = triggerButton?.textContent;
  if (triggerButton) { triggerButton.disabled = true; triggerButton.textContent = "生成中…"; }
  try {
    const level = await generateRandomLevelAsync(Number(n));
    const flatRegions = Int16Array.from(level.regions.flat());
    if (!globalThis.MeowdokuRandomGenerator?.validateLevel(flatRegions, level.n, level.solution)) {
      throw new Error("隨機關卡區域驗證失敗");
    }
    state.stageStart = null;
    beginGame({
      n: level.n,
      mode: "random",
      levelIdx: null,
      regions: level.regions,
      solution: level.solution,
      seed: level.seed,
    });
  } catch (error) {
    console.error(error);
    if (triggerButton) {
      triggerButton.textContent = "生成失敗";
      setTimeout(() => { triggerButton.textContent = originalText || "🎲 隨機關卡"; }, 1200);
    } else {
      el.statusBanner.textContent = `隨機關卡生成失敗：${error?.message || error}`;
      el.statusBanner.className = "status-banner lose";
    }
  } finally {
    randomGenerating = false;
    if (triggerButton) triggerButton.disabled = false;
  }
}

function beginGame({ n, mode, levelIdx, regions, solution, seed, fromShareCode = false,
    randomLevelId = null, chapter = "base" }) {
  closeBackpack();
  resetBoardPointer();
  stopRandomTitleTimer();
  state.n = Number(n);
  state.mode = mode;
  state.levelIdx = levelIdx;
  state.levelChapter = chapter === "extra" ? "extra" : "base";
  const gameBackground = v2GameBackground(state.n, mode);
  if (gameBackground) {
    document.body.style.setProperty("--game-map-background-image", `url("${gameBackground}")`);
    el.gameMapBackgroundPreload.src = gameBackground;
  } else {
    document.body.style.removeProperty("--game-map-background-image");
    el.gameMapBackgroundPreload.removeAttribute("src");
  }
  randomLevelId = mode === "random" && typeof randomLevelId === "string" && randomLevelId
    ? randomLevelId
    : null;
  const savedProgress = loadProgressSnapshot(mode, state.n, Number(levelIdx), randomLevelId, state.levelChapter);
  if (mode === "random" && savedProgress) {
    regions = savedProgress.regions;
    solution = savedProgress.solution;
    seed = savedProgress.seed;
    fromShareCode = savedProgress.fromShareCode;
    randomLevelId = savedProgress.randomLevelId;
  }
  state.randomSeed = seed ?? null;
  state.randomLevelId = randomLevelId;
  state.randomFromShareCode = mode === "random" && (!!fromShareCode || !!randomLevelId);
  state.randomElapsedOffsetMs = mode === "random" ? Math.max(0, Number(savedProgress?.elapsedMs) || 0) : 0;
  const maxRegionId = Math.max(...regions.flat());
  if (maxRegionId >= REGION_STYLE_COUNT) {
    throw new Error(`區域顏色不足：需要 ${maxRegionId + 1} 種，目前只有 ${REGION_STYLE_COUNT} 種`);
  }
  const regionColorKey = mode === "random"
    ? `v${REGION_COLOR_MAP_VERSION}:random:${state.n}:${Number(state.randomSeed) >>> 0}`
    : state.levelChapter === "extra"
      ? `v${REGION_COLOR_MAP_VERSION}:extra:${mode}:${state.n}:${Number(levelIdx)}`
    : mode === "hard"
      ? `v${REGION_COLOR_MAP_VERSION}:hard:${Number(levelIdx)}`
      : `v${REGION_COLOR_MAP_VERSION}:fixed:${state.n}:${Number(levelIdx)}`;
  state.regions = regions;
  state.regionColorMap = globalThis.MeowdokuRandomGenerator.createRegionColorMap(maxRegionId + 1, regionColorKey);
  state.solution = solution;
  state.board = savedProgress?.board || Array.from({ length: state.n }, () => Array(state.n).fill(EMPTY));
  state.items = restoreItemSession(savedProgress?.items, state.board);
  state.randomScoreSnapshot = savedProgress?.randomScore || null;
  state.hearts = savedProgress?.hearts || HEARTS_MAX;
  state.gameOver = false;
  if (el.btnBackpack) el.btnBackpack.disabled = false;
  state.startedAt = null;
  setGameBottomActionsForMode(mode);

  el.statusBanner.classList.add("hidden");
  el.winTime?.classList.add("hidden");
  state.startedAt = performance.now();
  renderGameTitle(mode === "random" ? state.randomElapsedOffsetMs : 0);
  if (mode === "random") startRandomTitleTimer();
  renderBoard();
  renderHearts();
  showGameScreen();
  if (settings.showHelp) el.helpModal.classList.remove("hidden");
}

function restartCurrentGame() {
  if (!state.n || !state.regions || !state.solution) return;
  closeBackpack();
  resetBoardPointer();
  clearProgressSnapshot();
  state.board = Array.from({ length: state.n }, () => Array(state.n).fill(EMPTY));
  state.items = restoreItemSession(null, state.board);
  state.hearts = HEARTS_MAX;
  state.gameOver = false;
  if (el.btnBackpack) el.btnBackpack.disabled = false;

  // Random mode measures the whole attempt from the moment the generated board
  // was first entered. Restarting the board must not reset that timer.
  if (state.mode !== "random") state.startedAt = performance.now();
  else if (randomTitleTimer === null) startRandomTitleTimer();

  el.statusBanner.classList.add("hidden");
  el.winModal.classList.add("hidden");
  el.winTime?.classList.add("hidden");
  renderBoard();
  renderHearts();
  startGameplayTimer();
}

function parseLevel(text) {
  const allLines = text.split("\n");
  const solutionLine = allLines.find((l) => l.startsWith("# solution:"));
  const solution = solutionLine.replace("# solution:", "").trim().split(/\s+/).map(Number);

  const lines = allLines.filter((l) => !l.startsWith("#") && l.trim() !== "");
  const n = parseInt(lines[0], 10);
  const regions = [];
  for (let r = 0; r < n; r++) {
    regions.push(lines[1 + r].split("").map((ch) => ch.charCodeAt(0) - 65));
  }
  return { n, regions, solution };
}

const APP_SCREEN_MAP = {
  entry: () => el.screenEntry,
  home: () => el.screenHome,
  "level-modes": () => el.screenLevelModes,
  "world-map": () => el.screenWorldMap,
  "small-map": () => el.screenSmallMap,
  "level-book": () => el.screenLevelBook,
  "fixed-select": () => el.screenSelect,
  "random-select": () => el.screenRandomSelect,
  styles: () => el.screenStyles,
  history: () => el.screenHistory,
  "history-random": () => el.screenHistoryRandom,
  game: () => el.screenGame,
  settings: () => el.screenSettings,
  "reminder-icons": () => el.screenReminderIcons,
  "block-colors": () => el.screenBlockColors,
};

function hideAllAppScreens() {
  Object.values(APP_SCREEN_MAP).forEach((getScreen) => getScreen()?.classList.add("hidden"));
}

function showAppScreen(screen, pushHistory = true) {
  const loadingToken = startScreenLoading();
  closeBackpack();
  const target = APP_SCREEN_MAP[screen] ? screen : "home";
  if (["home", "level-modes", "world-map", "small-map", "level-book", "fixed-select", "random-select", "styles", "history", "history-random"].includes(target)) stopRandomTitleTimer();
  if (target !== "game") stopGameplayTimer();
  if (target !== "world-map" && el.worldMapPager) el.worldMapPager.innerHTML = "";
  if (target !== "small-map") {
    el.smallMapBackground?.removeAttribute("src");
    if (el.smallMapSpots) el.smallMapSpots.innerHTML = "";
    if (el.smallMapStages) el.smallMapStages.innerHTML = "";
  }
  hideAllAppScreens();
  document.body.dataset.appScreen = target;
  APP_SCREEN_MAP[target]()?.classList.remove("hidden");

  if (target === "world-map") {
    renderWorldMap();
    if (Number.isInteger(state.worldChoiceSize)) showDifficultyPicker(state.worldChoiceSize, false);
    else closeDifficultyPicker();
  }
  if (target === "small-map") renderV2SmallMap();
  if (target === "level-book") renderLevelBook();
  if (target === "fixed-select") refreshDoneMarks();
  if (target === "random-select") renderRandomSizeButtons();
  if (target === "block-colors") renderBlockColorEditor();
  if (target === "styles") applyCellStyle(settings.cellStyle);
  if (target === "history") renderGameHistory();
  if (target === "history-random") renderRandomHistoryDetails();
  if (target === "game") startGameplayTimer();
  if (pushHistory) {
    const nextState = v2HistoryState(target);
    if (history.state?.screen !== target) history.pushState(nextState, "");
    else history.replaceState(nextState, "");
  }
  finishScreenLoading(APP_SCREEN_MAP[target](), loadingToken);
}

function showGameScreen() {
  const loadingToken = startScreenLoading();
  hideAllAppScreens();
  document.body.dataset.appScreen = "game";
  el.screenGame.classList.remove("hidden");
  startGameplayTimer();
  if (history.state?.screen !== "game") history.pushState({ screen: "game" }, "");
  else history.replaceState({ screen: "game" }, "");
  finishScreenLoading(el.screenGame, loadingToken);
}

function showSettingsScreen() {
  showAppScreen("settings");
}

function showReminderIconsScreen() {
  showAppScreen("reminder-icons");
}

function showBlockColorsScreen() {
  showAppScreen("block-colors");
}

function showSelectScreen() {
  showAppScreen("fixed-select", false);
}

function clearBoard() {
  if (state.gameOver) return;
  closeBackpack();
  resetBoardPointer();
  const n = state.n;
  state.board = Array.from({ length: n }, () => Array(n).fill(EMPTY));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) updateCellView(r, c);
}

// 所有格子等寬，只觀察第一格的內容尺寸，不在點擊或拖曳時讀取版面。
const cellSizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (!entry.target.isConnected || entry.contentRect.width <= 0) continue;
    const board = entry.target.parentElement;
    const unit = `${entry.contentRect.width / 100}px`;
    if (board.style.getPropertyValue("--cell-unit") !== unit) {
      board.style.setProperty("--cell-unit", unit);
      if (board === el.board) pointerBoardRect = null;
    }
  }
});
const stylePreviewCell = document.getElementById("cell-style-preview")?.firstElementChild;
if (stylePreviewCell) cellSizeObserver.observe(stylePreviewCell);

function renderBoard() {
  if (cellEls[0]?.[0]) cellSizeObserver.unobserve(cellEls[0][0]);
  const n = state.n;
  el.board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  el.board.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  el.board.innerHTML = "";

  cellEls = Array.from({ length: n }, () => Array(n));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      cellEl.dataset.region = String(state.regionColorMap[state.regions[r][c]]);
      cellEl.innerHTML = '<span class="mark"><span class="bar"></span><span class="bar"></span></span>'
        + '<span class="cat-icon">🐱</span>'
        + `<img class="hypo-icon" src="${reminderIconSrc()}" alt="" aria-hidden="true">`;
      cellEls[r][c] = cellEl;
      el.board.appendChild(cellEl);
      updateCellView(r, c);
    }
  }
  if (cellEls[0]?.[0]) cellSizeObserver.observe(cellEls[0][0]);
}

function updateCellView(r, c, trackChange = true) {
  const st = state.board[r][c];
  const cell = cellEls[r][c];
  // 每格只保留檢查點時的初始狀態；最多 n² 筆，往返相同狀態即刪除差異。
  if (trackChange && state.items?.checkpoint && cell.dataset.state !== undefined) {
    const index = r * state.n + c;
    const changes = state.items.changes;
    const before = changes.has(index) ? changes.get(index) : Number(cell.dataset.state);
    if (before === st) changes.delete(index);
    else changes.set(index, before);
  }
  cell.dataset.state = String(st);
}

function renderHearts() {
  el.hearts.innerHTML = '<img src="images/UI/ui_icon_paw.png" alt="">'.repeat(state.hearts);
  el.hearts.setAttribute("aria-label", `剩餘次數 ${state.hearts}`);
}

function playCatRun(r, c) {
  const cell = cellEls[r]?.[c];
  if (!cell || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();

  const runsRight = c >= (state.n - 1) / 2;
  const boardRect = el.board.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const height = cellRect.height * 1.25;
  const frameWidth = height * 354 / 392;
  const pixelRatio = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(frameWidth * pixelRatio) / pixelRatio);
  const frameShift = width * 32 / 354;
  const startX = cellRect.left - boardRect.left + (cellRect.width - width) / 2;
  const endX = runsRight ? boardRect.width + 2 : -width - 2;
  const runner = document.createElement("span");
  const strip = document.createElement("img");
  runner.className = `cat-runner ${runsRight ? "right" : "left"}`;
  runner.setAttribute("aria-hidden", "true");
  runner.style.left = `${startX}px`;
  runner.style.top = `${cellRect.top - boardRect.top + (cellRect.height - height) / 2}px`;
  runner.style.width = `${width}px`;
  runner.style.height = `${height}px`;
  runner.style.setProperty("--cat-run-distance", `${endX - startX}px`);
  runner.style.setProperty("--cat-run-frame-shift", `${runsRight ? -frameShift : frameShift}px`);
  strip.src = `images/UI/CatRun${runsRight ? "01" : "02"}.png`;
  strip.alt = "";
  runner.appendChild(strip);
  el.board.appendChild(runner);

  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      runner.remove();
      resolve();
    };
    runner.addEventListener("animationend", (event) => {
      if (event.target === runner) finish();
    });
    setTimeout(finish, 1500);
  });
}

function checkWin(catRunFinished = Promise.resolve()) {
  const n = state.n;
  let cats = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (state.board[r][c] === CAT) cats++;
  if (cats === n) {
    const completedBoard = state.board;
    state.gameOver = true;
    if (el.btnBackpack) el.btnBackpack.disabled = true;
    stopGameplayTimer();
    clearProgressSnapshot();
    recordCatsFoundForClear();
    el.winModal.dataset.result = "win";
    el.resultModalImage.src = "images/UI/background_cat2.png";
    el.resultModalTitle.textContent = "完成！";
    el.btnModalBack.textContent = "選關";
    delete el.btnReplay.dataset.action;
    el.btnReplay.style.display = "none";

    if (state.mode === "random") {
      const elapsedMs = currentRandomElapsedMs();
      stopRandomTitleTimer();
      renderGameTitle(elapsedMs);
      const record = state.randomFromShareCode
        ? getRandomTimes()[String(state.n)]
        : saveRandomClearResult(state.n, elapsedMs, state.hearts);
      const bestMs = Number(record?.bestMs);
      if (el.winTime) {
        el.winTime.innerHTML = `本次過關時間：<b>${formatElapsed(elapsedMs)}</b><br>本次肉球：<b>${pawIconsHtml(state.hearts)}</b><br>最佳紀錄：<b>${Number.isFinite(bestMs) ? formatElapsed(bestMs) : "--"}</b>`;
        el.winTime.classList.remove("hidden");
      }
      el.btnModalBack.textContent = "回到選關畫面";
      el.btnNextLevel.style.display = "";
      el.btnNextLevel.textContent = "下一個隨機關卡";
    } else if (state.levelChapter === "extra") {
      saveExtraStars(state.n, state.mode, state.levelIdx, state.hearts);
      if (el.winTime) el.winTime.classList.add("hidden");
      const difficulty = state.mode === "hard" ? "hard" : "normal";
      el.btnNextLevel.style.display = state.levelIdx < extraLevelCount(state.n, difficulty) ? "" : "none";
      el.btnNextLevel.textContent = difficulty === "hard" ? "繼續深入" : "下一關";
    } else {
      if (state.mode === "hard") saveHardStars(state.levelIdx, state.hearts);
      else saveStars(state.n, state.levelIdx, state.hearts);
      if (el.winTime) el.winTime.classList.add("hidden");
      const route = state.mode === "hard"
        ? hardWinRoute(state.n, state.levelIdx)
        : normalWinRoute(state.n, state.levelIdx);
      el.btnReplay.style.display = route.nextLocation ? "" : "none";
      el.btnReplay.textContent = "下個地點";
      if (route.nextLocation) el.btnReplay.dataset.action = "next-location";
      el.btnNextLevel.style.display = route.continueLevel ? "" : "none";
      el.btnNextLevel.textContent = "繼續深入";
    }

    Promise.resolve(catRunFinished).then(() => {
      if (state.gameOver && state.board === completedBoard) el.winModal.classList.remove("hidden");
    });
  }
}

function triggerGameOver() {
  closeBackpack();
  if (el.btnBackpack) el.btnBackpack.disabled = true;
  state.gameOver = true;
  stopGameplayTimer();
  stopRandomTitleTimer();
  el.statusBanner.classList.add("hidden");
  el.winModal.dataset.result = "lose";
  el.resultModalImage.src = "images/UI/background_cat3.png";
  el.resultModalTitle.textContent = "貓咪跑走了";
  el.winTime?.classList.add("hidden");
  el.btnModalBack.textContent = "選關";
  el.btnReplay.textContent = "重新挑戰";
  delete el.btnReplay.dataset.action;
  el.btnReplay.style.display = "";
  el.btnNextLevel.style.display = "none";
  setTimeout(() => el.winModal.classList.remove("hidden"), 300);
}


// Auto-eliminate: when a cat is correctly placed, mark same row, same column,
// surrounding 8 cells, and entire same-region (same color) as MARK.
function autoEliminate(r, c) {
  const n = state.n;
  const region = state.regions[r][c];
  const mark = (mr, mc) => {
    if (state.board[mr][mc] === EMPTY) { state.board[mr][mc] = MARK; updateCellView(mr, mc); }
  };
  for (let j = 0; j < n; j++) if (j !== c) mark(r, j);
  for (let i = 0; i < n; i++) if (i !== r) mark(i, c);
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n) mark(nr, nc);
    }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (state.regions[i][j] === region) mark(i, j);
}

function attemptPlaceCat(r, c) {
  if (state.gameOver || state.board[r][c] === CAT || state.board[r][c] === WRONG) return;
  if (state.solution[r] === c) {
    state.board[r][c] = CAT;
    updateCellView(r, c);
    const catRunFinished = playCatRun(r, c);
    soundManager?.playMeow();
    vibrate("cat", 100);
    if (settings.autoElim) autoEliminate(r, c);
    if (state.items) {
      state.items.checkpoint = true;
      state.items.changes.clear();
    }
    checkWin(catRunFinished);
  } else {
    if (!state.randomFromShareCode) incrementGameplayHistory("wrongGuesses");
    state.hearts--;
    renderHearts();
    state.board[r][c] = WRONG;
    updateCellView(r, c);
    if (state.hearts <= 0) triggerGameOver();
  }
}

function toggleMark(r, c) {
  if (state.gameOver || state.board[r][c] === CAT || state.board[r][c] === WRONG) return;
  state.board[r][c] = state.board[r][c] === EMPTY ? MARK : EMPTY;
  updateCellView(r, c);
}

function toggleHypo(r, c) {
  if (state.gameOver || state.board[r][c] === CAT || state.board[r][c] === WRONG) return;
  state.board[r][c] = state.board[r][c] === HYPO ? EMPTY : HYPO;
  updateCellView(r, c);
}

// --- Pointer handling: single tap toggles a mark, double tap on the same
// cell attempts a cat, and press-and-drag paints every swept cell to match
// the cell where the drag started (not a per-cell toggle). ---

let pointerId = null;
let dragging = false;
let dragTargetState = null;
let dragOrigin = null;
let lastPaintedKey = null;
let startX = 0, startY = 0;
let pendingTap = null; // { key, prevState, timer }
let activeCellEl = null;
let pointerBoardRect = null;

function resetBoardPointer() {
  if (pendingTap) clearTimeout(pendingTap.timer);
  pendingTap = null;
  if (pointerId !== null && el.board.hasPointerCapture(pointerId)) el.board.releasePointerCapture(pointerId);
  activeCellEl?.classList.remove("active");
  activeCellEl = null;
  pointerId = null;
  pointerBoardRect = null;
  dragging = false;
  dragOrigin = null;
  dragTargetState = null;
  lastPaintedKey = null;
}

window.addEventListener("resize", () => { pointerBoardRect = null; closeBackpack(); });
window.addEventListener("scroll", () => { pointerBoardRect = null; }, true);

function cellFromPoint(clientX, clientY) {
  const n = state.n;
  const rect = pointerBoardRect || el.board.getBoundingClientRect();
  if (pointerId !== null) pointerBoardRect = rect;
  const relX = clientX - rect.left, relY = clientY - rect.top;
  if (relX < 0 || relY < 0 || relX >= rect.width || relY >= rect.height) return null;
  const c = Math.floor((relX / rect.width) * n);
  const r = Math.floor((relY / rect.height) * n);
  if (r < 0 || r >= n || c < 0 || c >= n) return null;
  return { r, c };
}

function onPointerDown(e) {
  if (state.gameOver || pointerId !== null || itemInteraction === "bag" || itemInteraction === "confirm") return;
  pointerBoardRect = el.board.getBoundingClientRect();
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!cell) { pointerBoardRect = null; return; }
  e.preventDefault(); // only suppress default when pointer is actually over the board

  const startState = state.board[cell.r][cell.c];
  if (startState !== WRONG) {
    activeCellEl = cellEls[cell.r][cell.c];
    activeCellEl.classList.add("active");
  }

  pointerId = e.pointerId;
  el.board.setPointerCapture(pointerId);
  dragOrigin = cell;
  dragging = false;
  lastPaintedKey = null;
  startX = e.clientX;
  startY = e.clientY;

  if (startState === CAT || startState === WRONG) dragTargetState = null;
  else if (settings.hypo) dragTargetState = startState === HYPO ? EMPTY : HYPO;
  else dragTargetState = startState === EMPTY ? MARK : EMPTY;
}

function onPointerMove(e) {
  if (e.pointerId !== pointerId) return;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (itemInteraction === "select") {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD_PX) dragging = true;
    return;
  }

  if (!dragging) {
    const moved = Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD_PX;
    const leftOrigin = cell && (cell.r !== dragOrigin.r || cell.c !== dragOrigin.c);
    if (!moved && !leftOrigin) return;
    dragging = true;
    if (activeCellEl) { activeCellEl.classList.remove("active"); activeCellEl = null; }
    paintDragCell(dragOrigin.r, dragOrigin.c);
  }

  if (cell) paintDragCell(cell.r, cell.c);
}

function paintDragCell(r, c) {
  const key = `${r},${c}`;
  if (key === lastPaintedKey) return;
  lastPaintedKey = key;
  if (dragTargetState === null || state.board[r][c] === CAT || state.board[r][c] === WRONG) return;
  if (state.board[r][c] === dragTargetState) return;
  const cur = state.board[r][c];
  if (settings.hypo ? (cur !== EMPTY && cur !== HYPO) : (cur !== EMPTY && cur !== MARK)) return;
  state.board[r][c] = dragTargetState;
  updateCellView(r, c);
}

function onPointerUp(e) {
  if (e.pointerId !== pointerId) return;
  if (el.board.hasPointerCapture(pointerId)) el.board.releasePointerCapture(pointerId);
  if (activeCellEl) { activeCellEl.classList.remove("active"); activeCellEl = null; }
  const wasDragging = dragging;
  const origin = dragOrigin;
  pointerId = null;
  pointerBoardRect = null;
  dragging = false;
  dragOrigin = null;

  if (!wasDragging && e.type !== "pointercancel") handleTap(origin.r, origin.c);
}

function handleTap(r, c) {
  if (itemInteraction === "select") { selectDetectorCenter(r, c); return; }
  if (itemInteraction || state.gameOver) return;
  if (state.board[r][c] === WRONG) return;
  const key = `${r},${c}`;
  if (pendingTap && pendingTap.key === key) {
    clearTimeout(pendingTap.timer);
    // Undo the mark applied on first tap, then place cat
    if (pendingTap.prevState !== undefined) {
      state.board[r][c] = pendingTap.prevState;
      updateCellView(r, c);
    }
    pendingTap = null;
    attemptPlaceCat(r, c);
    return;
  }
  // Flush any pending tap on a different cell
  if (pendingTap) {
    clearTimeout(pendingTap.timer);
    pendingTap = null;
  }
  // Apply mark/hypo immediately for instant feedback
  const prevState = state.board[r][c];
  if (settings.hypo) toggleHypo(r, c); else toggleMark(r, c);
  pendingTap = {
    key,
    prevState,
    timer: setTimeout(() => { pendingTap = null; }, DOUBLE_TAP_MS),
  };
}

init();
