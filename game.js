"use strict";

// Region colours are controlled by CSS themes.
// Each cell exposes data-region="0".."13" and data-state, so a theme can
// replace colours, borders, radii and other visuals without changing game logic.
const REGION_STYLE_COUNT = 14;
const RANDOM_GENERATION_TIMEOUT_MS = 3000;

const EMPTY = 0, MARK = 1, CAT = 2, HYPO = 3, WRONG = 4;
const HEARTS_MAX = 3;
const DOUBLE_TAP_MS = 300;
const DRAG_THRESHOLD_PX = 6;

// User-facing toggles — persisted across sessions.
const settings = (() => {
  try {
    const s = JSON.parse(localStorage.getItem("meowdoku_settings") || "{}");
    return { sound: s.sound !== false, vibrate: s.vibrate !== false, autoElim: !!s.autoElim, hypo: !!s.hypo, showHelp: s.showHelp !== false, cellStyle: ["original", "glass", "pixel", "tile", "paper", "neon"].includes(s.cellStyle) ? s.cellStyle : "original" };
  } catch { return { sound: true, vibrate: true, autoElim: false, hypo: false, showHelp: true, cellStyle: "original" }; }
})();

function saveSettings() {
  try { localStorage.setItem("meowdoku_settings", JSON.stringify(settings)); } catch { }
}

// Star tracking: { "n:idx": 1|2|3 }. Migrates old array format to object.
function getStars() {
  try {
    const raw = JSON.parse(localStorage.getItem("meowdoku_done") || "{}");
    if (Array.isArray(raw)) { const o = {}; raw.forEach(k => { o[k] = 1; }); return o; }
    return (typeof raw === "object" && raw !== null) ? raw : {};
  } catch { return {}; }
}
function saveStars(n, idx, stars) {
  const data = getStars();
  const key = `${n}:${idx}`;
  if ((data[key] || 0) < stars) data[key] = stars;
  try { localStorage.setItem("meowdoku_done", JSON.stringify(data)); } catch { }
}

// Random-level clear times. Each size keeps best/last/count and a bounded recent history.
function getRandomTimes() {
  try {
    const raw = JSON.parse(localStorage.getItem("meowdoku_random_times") || "{}");
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
  try { localStorage.setItem("meowdoku_random_times", JSON.stringify(data)); } catch { }
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

function renderGameTitle(elapsedMs = null) {
  if (state.mode === "random") {
    const elapsed = elapsedMs ?? Math.max(0, performance.now() - (state.startedAt ?? performance.now()));
    el.gameTitle.textContent = `${state.n} x ${state.n} — 隨機關卡 ${formatElapsed(elapsed)}`;
  } else {
    el.gameTitle.textContent = `${state.n} x ${state.n} — 第 ${state.levelIdx} 關`;
  }
}

function startRandomTitleTimer() {
  stopRandomTitleTimer();
  renderGameTitle();
  randomTitleTimer = setInterval(() => renderGameTitle(), 50);
}

const state = {
  sizes: {},        // { "8": levelCount, ... }
  n: null,
  mode: "fixed",      // "fixed" | "random"
  levelIdx: null,
  randomSeed: null,
  startedAt: null,
  stageStart: null,
  regions: null,     // n x n array of region ids (0..n-1)
  solution: null,    // solution[row] = column of the true cat
  board: null,       // n x n array of EMPTY/MARK/CAT
  hearts: HEARTS_MAX,
  gameOver: false,
};

const el = {
  sizeButtons: document.getElementById("size-buttons"),
  stageButtons: document.getElementById("stage-buttons"),
  levelButtons: document.getElementById("level-buttons"),
  levelHeading: document.getElementById("level-heading"),
  cellStyleButtons: document.getElementById("cell-style-buttons"),
  screenSelect: document.getElementById("screen-select"),
  screenGame: document.getElementById("screen-game"),
  board: document.getElementById("board"),
  gameTitle: document.getElementById("game-title"),
  hearts: document.getElementById("hearts"),
  statusBanner: document.getElementById("status-banner"),
  btnBack: document.getElementById("btn-back"),
  btnRestart: document.getElementById("btn-restart"),
  winModal: document.getElementById("win-modal"),
  winTime: document.getElementById("win-time"),
  btnNextLevel: document.getElementById("btn-next-level"),
  btnReplay: document.getElementById("btn-replay"),
  btnModalBack: document.getElementById("btn-modal-back"),
  helpModal: document.getElementById("help-modal"),
  btnHelp: document.getElementById("btn-help"),
  btnHelpClose: document.getElementById("btn-help-close"),
  btnToggleSound: document.getElementById("btn-toggle-sound"),
  btnToggleVibrate: document.getElementById("btn-toggle-vibrate"),
  btnToggleAuto: document.getElementById("btn-toggle-auto"),
  btnToggleHypo: document.getElementById("btn-toggle-hypo"),
};

// ── Audio ────────────────────────────────────────────────────────────────────
// All sounds are synthesised with Web Audio API — no external assets needed.

let _ctx = null;
function _getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

function _tone(freq, type, vol, dur, t) {
  const ctx = _getCtx();
  const s = t !== undefined ? t : ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, s);
  gain.gain.setValueAtTime(vol, s);
  gain.gain.exponentialRampToValueAtTime(0.001, s + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(s);
  osc.stop(s + dur);
}

// Short soft tick for marking/unmarking cells (including each cell during drag).
function playMark() { if (settings.sound) _tone(660, "sine", 0.08, 0.10); }

// Warm ding (fundamental + octave) when a cat is placed correctly.
function playCat() {
  if (!settings.sound) return;
  _tone(880, "sine", 0.18, 0.45); _tone(1760, "sine", 0.08, 0.45);
}

// Sharp descending buzz when a cat guess is wrong.
function playWrong() {
  if (!settings.sound) return;
  const ctx = _getCtx(), t = ctx.currentTime;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(240, t);
  osc.frequency.linearRampToValueAtTime(110, t + 0.40);
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.40);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.40);
}

// C-major arpeggio (C E G C) spread over 0.3 s for the win moment.
function playWin() {
  if (!settings.sound) return;
  const ctx = _getCtx(), now = ctx.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => _tone(f, "sine", 0.18, 0.4, now + i * 0.1));
}

// ── Haptic ───────────────────────────────────────────────────────────────────

function vibrate(ms) { if (settings.vibrate && navigator.vibrate) navigator.vibrate(ms); }

// Per-cell DOM elements, indexed [row][col], created once per level load.
let cellEls = [];

function updateToggleUI() {
  el.btnToggleSound.textContent = settings.sound ? "音效 🔊" : "音效 🔇";
  el.btnToggleVibrate.textContent = settings.vibrate ? "振動 📳" : "振動 📴";
  el.btnToggleSound.classList.toggle("off", !settings.sound);
  el.btnToggleVibrate.classList.toggle("off", !settings.vibrate);
  el.btnToggleAuto.classList.toggle("off", !settings.autoElim);
  el.btnToggleHypo?.classList.toggle("off", !settings.hypo);
}

function applyCellStyle(style) {
  const nextStyle = ["original", "glass", "pixel", "tile", "paper", "neon"].includes(style) ? style : "original";
  settings.cellStyle = nextStyle;
  document.body.dataset.cellStyle = nextStyle;
  if (el.cellStyleButtons) {
    [...el.cellStyleButtons.querySelectorAll(".cell-style-button")].forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.cellStyle === nextStyle);
    });
  }
}

async function init() {
  // Bind all event listeners synchronously BEFORE any async operations so that
  // browser caching of an older JS file can never leave buttons unresponsive.
  updateToggleUI();
  applyCellStyle(settings.cellStyle);
  try { history.replaceState({ screen: "select" }, ""); } catch { }

  el.btnBack.addEventListener("click", () => history.back());
  el.btnRestart.addEventListener("click", restartCurrentGame);
  el.btnNextLevel?.addEventListener("click", () => {
    el.winModal.classList.add("hidden");
    if (state.mode === "random") startRandomLevel(state.n);
    else startLevel(state.n, state.levelIdx + 1);
  });
  el.btnReplay?.addEventListener("click", () => {
    el.winModal.classList.add("hidden");
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

  window.addEventListener("popstate", () => {
    if (!el.screenGame.classList.contains("hidden")) {
      el.winModal.classList.add("hidden");
      showSelectScreen();
    }
  });

  el.btnToggleSound?.addEventListener("click", () => {
    settings.sound = !settings.sound;
    saveSettings();
    updateToggleUI();
  });
  el.btnToggleVibrate?.addEventListener("click", () => {
    settings.vibrate = !settings.vibrate;
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
  state.sizes = await res.json();
  renderSizeButtons();
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
  state.n = n;
  state.stageStart = null;
  [...el.sizeButtons.children].forEach((b) => {
    b.classList.toggle("selected", b.textContent.startsWith(`${n} `));
  });

  renderStageButtons();
  el.levelButtons.innerHTML = "";
  el.levelButtons.classList.add("hidden");
  el.levelHeading.classList.add("hidden");
}

function stageEnd(start) {
  return Math.min(start + 99, Number(state.sizes[state.n] || 0));
}

function getStageThreeStarProgress(stars, start, end) {
  const total = Math.max(0, end - start + 1);
  let completed = 0;
  for (let i = start; i <= end; i++) {
    if ((stars[`${state.n}:${i}`] || 0) === 3) completed++;
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
  if (!state.n) return;
  const count = Number(state.sizes[state.n] || 0);
  const stars = getStars();
  el.stageButtons.innerHTML = "";

  const randomBtn = document.createElement("button");
  randomBtn.className = "stage-button random-stage-button";
  const randomRecord = getRandomTimes()[String(state.n)];
  const randomStars = Math.max(0, Math.min(HEARTS_MAX, Number(randomRecord?.bestStars) || 0));
  const starText = `${"★".repeat(randomStars)}${"☆".repeat(HEARTS_MAX - randomStars)}`;
  randomBtn.innerHTML = randomRecord?.bestMs != null
    ? `<span>🎲 隨機關卡</span><small><span class="random-stage-stars">${starText}</span><span>最佳 ${formatElapsed(randomRecord.bestMs)}</span></small>`
    : `<span>🎲 隨機關卡</span><small><span class="random-stage-stars">${starText}</span><span>尚無紀錄</span></small>`;
  if (randomRecord?.bestMs != null) {
    randomBtn.title = `最高 ${randomStars} 星｜最佳紀錄 ${formatElapsed(randomRecord.bestMs)}｜完成 ${randomRecord.clears || 0} 次`;
    randomBtn.setAttribute("aria-label", `隨機關卡，最高 ${randomStars} 星，最佳紀錄 ${formatElapsed(randomRecord.bestMs)}`);
  } else {
    randomBtn.title = "生成新的唯一解隨機關卡";
    randomBtn.setAttribute("aria-label", "隨機關卡，尚無星數紀錄");
  }
  randomBtn.addEventListener("click", () => startRandomLevel(state.n, randomBtn));
  el.stageButtons.appendChild(randomBtn);

  for (let start = 1; start <= count; start += 100) {
    const end = Math.min(start + 99, count);
    const btn = document.createElement("button");
    btn.className = "stage-button";
    btn.dataset.stageStart = String(start);
    btn.textContent = `${start} ~ ${end}`;

    const progress = getStageThreeStarProgress(stars, start, end);
    btn.dataset.progressBand = progress.band;
    btn.dataset.progress = String(progress.percent);
    btn.title = `三星完成 ${progress.completed}/${progress.total}（${progress.percent}%）`;
    btn.setAttribute("aria-label", `${start} 到 ${end}，三星完成 ${progress.completed}/${progress.total}，${progress.percent}%`);

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
  if (!state.n) return;

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
  const count = Number(state.sizes[state.n] || 0);
  const end = Math.min(start + 99, count);
  const stars = getStars();

  el.levelButtons.innerHTML = "";
  for (let i = start; i <= end; i++) {
    const btn = document.createElement("button");
    btn.className = "level-button";
    btn.dataset.level = String(i);
    btn.textContent = String(i);
    const s = stars[`${state.n}:${i}`] || 0;
    if (s > 0) {
      btn.classList.add("done");
      btn.dataset.stars = String(s);
    }
    btn.addEventListener("click", () => startLevel(state.n, i));
    el.levelButtons.appendChild(btn);
  }

  el.levelHeading.textContent = `選擇關卡 ${start} ~ ${end}`;
  el.levelHeading.classList.remove("hidden");
  el.levelButtons.classList.remove("hidden");
}

function refreshDoneMarks() {
  if (!state.n) return;
  renderStageButtons();
  if (state.stageStart) renderLevelButtons(state.stageStart);
}

async function startLevel(n, idx) {
  state.stageStart = Math.floor((idx - 1) / 100) * 100 + 1;
  const path = `levels/${n}/level_${n}_${String(idx).padStart(8, "0")}.txt`;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`關卡讀取失敗：${res.status}`);
  const text = await res.text();
  const { regions, solution } = parseLevel(text);
  beginGame({ n, mode: "fixed", levelIdx: idx, regions, solution, seed: null });
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
        reject(new Error("隨機關卡生成超過 3 秒限制"));
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

function beginGame({ n, mode, levelIdx, regions, solution, seed }) {
  stopRandomTitleTimer();
  state.n = Number(n);
  state.mode = mode;
  state.levelIdx = levelIdx;
  state.randomSeed = seed ?? null;
  const maxRegionId = Math.max(...regions.flat());
  if (maxRegionId >= REGION_STYLE_COUNT) {
    throw new Error(`區域顏色不足：需要 ${maxRegionId + 1} 種，目前只有 ${REGION_STYLE_COUNT} 種`);
  }
  state.regions = regions;
  state.solution = solution;
  state.board = Array.from({ length: state.n }, () => Array(state.n).fill(EMPTY));
  state.hearts = HEARTS_MAX;
  state.gameOver = false;
  state.startedAt = null;

  el.statusBanner.classList.add("hidden");
  el.winTime?.classList.add("hidden");
  showGameScreen();
  state.startedAt = performance.now();
  renderGameTitle(0);
  if (mode === "random") startRandomTitleTimer();
  renderBoard();
  renderHearts();
  if (settings.showHelp) el.helpModal.classList.remove("hidden");
}

function restartCurrentGame() {
  if (!state.n || !state.regions || !state.solution) return;
  state.board = Array.from({ length: state.n }, () => Array(state.n).fill(EMPTY));
  state.hearts = HEARTS_MAX;
  state.gameOver = false;

  // Random mode measures the whole attempt from the moment the generated board
  // was first entered. Restarting the board must not reset that timer.
  if (state.mode !== "random") state.startedAt = performance.now();
  else if (randomTitleTimer === null) startRandomTitleTimer();

  el.statusBanner.classList.add("hidden");
  el.winModal.classList.add("hidden");
  el.winTime?.classList.add("hidden");
  renderBoard();
  renderHearts();
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

function showGameScreen() {
  el.screenSelect.classList.add("hidden");
  el.screenGame.classList.remove("hidden");
  // Push only when coming from the select screen; replace when already in-game (next level).
  if (history.state?.screen !== "game") history.pushState({ screen: "game" }, "");
  else history.replaceState({ screen: "game" }, "");
}

function showSelectScreen() {
  stopRandomTitleTimer();
  el.screenGame.classList.add("hidden");
  el.screenSelect.classList.remove("hidden");
  refreshDoneMarks();
  if (!state.stageStart) {
    el.levelButtons.innerHTML = "";
    el.levelButtons.classList.add("hidden");
    el.levelHeading.classList.add("hidden");
  }
}

function clearBoard() {
  const n = state.n;
  state.board = Array.from({ length: n }, () => Array(n).fill(EMPTY));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) updateCellView(r, c);
}

function renderBoard() {
  const n = state.n;
  el.board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  el.board.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  el.board.innerHTML = "";

  cellEls = Array.from({ length: n }, () => Array(n));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      cellEl.innerHTML = '<span class="mark"><span class="bar"></span><span class="bar"></span></span>'
        + '<span class="cat-icon">🐱</span>'
        + '<span class="hypo-icon">△</span>';
      cellEls[r][c] = cellEl;
      el.board.appendChild(cellEl);
      updateCellView(r, c);
    }
  }
}

function updateCellView(r, c) {
  const st = state.board[r][c];
  const cell = cellEls[r][c];
  cell.dataset.state = String(st);
  cell.dataset.region = String(state.regions[r][c]);
}

function renderHearts() {
  el.hearts.textContent = "❤️".repeat(state.hearts) + "🤍".repeat(HEARTS_MAX - state.hearts);
}

function checkWin() {
  const n = state.n;
  let cats = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (state.board[r][c] === CAT) cats++;
  if (cats === n) {
    state.gameOver = true;

    if (state.mode === "random") {
      const elapsedMs = Math.max(0, performance.now() - (state.startedAt ?? performance.now()));
      stopRandomTitleTimer();
      renderGameTitle(elapsedMs);
      const record = saveRandomClearResult(state.n, elapsedMs, state.hearts);
      if (el.winTime) {
        el.winTime.innerHTML = `本次過關時間：<b>${formatElapsed(elapsedMs)}</b><br>本次星數：<b>${"★".repeat(state.hearts)}</b><br>最佳紀錄：<b>${formatElapsed(record.bestMs)}</b>`;
        el.winTime.classList.remove("hidden");
      }
      el.btnNextLevel.style.display = "";
      el.btnNextLevel.textContent = "下一個隨機關卡";
    } else {
      saveStars(state.n, state.levelIdx, state.hearts);
      if (el.winTime) el.winTime.classList.add("hidden");
      const hasNext = state.levelIdx < state.sizes[state.n];
      el.btnNextLevel.style.display = hasNext ? "" : "none";
      el.btnNextLevel.textContent = "下一關";
    }

    playWin(); vibrate(300);
    setTimeout(() => el.winModal.classList.remove("hidden"), 300);
  }
}

function triggerGameOver() {
  state.gameOver = true;
  el.statusBanner.textContent = "💔 掰了，按「重來」再試一次";
  el.statusBanner.className = "status-banner lose";
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
    playCat(); vibrate(100);
    if (settings.autoElim) autoEliminate(r, c);
    checkWin();
  } else {
    state.hearts--;
    renderHearts();
    state.board[r][c] = WRONG;
    updateCellView(r, c);
    playWrong(); vibrate(200);
    if (state.hearts <= 0) triggerGameOver();
  }
}

function toggleMark(r, c) {
  if (state.gameOver || state.board[r][c] === CAT || state.board[r][c] === WRONG) return;
  state.board[r][c] = state.board[r][c] === EMPTY ? MARK : EMPTY;
  updateCellView(r, c);
  playMark(); vibrate(50);
}

function toggleHypo(r, c) {
  if (state.gameOver || state.board[r][c] === CAT || state.board[r][c] === WRONG) return;
  state.board[r][c] = state.board[r][c] === HYPO ? EMPTY : HYPO;
  updateCellView(r, c);
  playMark(); vibrate(50);
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

function cellFromPoint(clientX, clientY) {
  const n = state.n;
  const rect = el.board.getBoundingClientRect();
  const relX = clientX - rect.left, relY = clientY - rect.top;
  if (relX < 0 || relY < 0 || relX >= rect.width || relY >= rect.height) return null;
  const c = Math.floor((relX / rect.width) * n);
  const r = Math.floor((relY / rect.height) * n);
  if (r < 0 || r >= n || c < 0 || c >= n) return null;
  return { r, c };
}

function onPointerDown(e) {
  if (state.gameOver || pointerId !== null) return;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!cell) return;
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
  playMark(); vibrate(100);
}

function onPointerUp(e) {
  if (e.pointerId !== pointerId) return;
  el.board.releasePointerCapture(pointerId);
  if (activeCellEl) { activeCellEl.classList.remove("active"); activeCellEl = null; }
  const wasDragging = dragging;
  const origin = dragOrigin;
  pointerId = null;
  dragging = false;
  dragOrigin = null;

  if (!wasDragging) handleTap(origin.r, origin.c);
}

function handleTap(r, c) {
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
