"use strict";

// Random-level score system.
// Score rules:
//   correct cat +10,000
//   wrong guess -3,000
//   restart -30,000
//   elapsed time -1 / second
// Scores exist only for random levels and best scores are stored per board size.
(function () {
  const SCORE_STORAGE_KEY = "meowdoku_random_scores_v2";
  const CAT_POINTS = 10000;
  const WRONG_PENALTY = 3000;
  const RESTART_PENALTY = 30000;

  const scoreDisplay = document.getElementById("random-score-display");
  const scoreValue = document.getElementById("random-score-value");
  const timeValue = document.getElementById("random-time-value");
  const randomSizeButtons = document.getElementById("random-size-buttons");
  const screenGame = document.getElementById("screen-game");

  let active = false;
  let eventScore = 0;
  let awardedCats = new Set();
  let timerId = null;
  let savedForCurrentWin = false;

  function gameState() {
    try {
      return (typeof state !== "undefined" && state) ? state : null;
    } catch {
      return null;
    }
  }

  function isRandomGame() {
    return gameState()?.mode === "random";
  }

  function elapsedSeconds() {
    return Math.max(0, Math.floor(currentRandomElapsedMs() / 1000));
  }

  function currentScore() {
    return Math.trunc(eventScore - elapsedSeconds());
  }

  function formatScore(value) {
    const number = Math.trunc(Number(value) || 0);
    return number.toLocaleString("en-US");
  }

  function updateDisplay() {
    if (!scoreDisplay) return;
    const visible = active && isRandomGame() && !screenGame?.classList.contains("hidden");
    scoreDisplay.classList.toggle("hidden", !visible);
    if (visible) {
      if (scoreValue) scoreValue.textContent = `分數 ${formatScore(currentScore())}`;
      if (timeValue) timeValue.textContent = `時間 ${formatElapsed(currentRandomElapsedMs())}`;
    }
  }

  function startTimer() {
    stopTimer();
    updateDisplay();
    timerId = setInterval(updateDisplay, 250);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function readScoreRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(SCORE_STORAGE_KEY) || "{}");
      return (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
    } catch {
      return {};
    }
  }

  function writeScoreRecords(records) {
    try { localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(records)); } catch { }
  }

  function bestScoreForSize(n) {
    const record = readScoreRecords()[String(n)];
    const score = Number(record?.bestScore);
    return Number.isFinite(score) ? Math.trunc(score) : null;
  }

  function saveBestScore() {
    const gs = gameState();
    const n = Number(gs?.n);
    if (!active || !Number.isInteger(n) || n <= 0 || savedForCurrentWin) return null;
    if (gs?.randomFromShareCode) {
      savedForCurrentWin = true;
      return null;
    }

    const score = currentScore();
    const records = readScoreRecords();
    const key = String(n);
    const previous = Number(records[key]?.bestScore);
    const isNewBest = !Number.isFinite(previous) || score > previous;

    if (isNewBest) {
      records[key] = {
        ...(records[key] && typeof records[key] === "object" ? records[key] : {}),
        bestScore: score,
        seed: Number.isFinite(Number(gs?.randomSeed)) ? Number(gs.randomSeed) : null,
        at: new Date().toISOString(),
      };
      writeScoreRecords(records);
    }

    savedForCurrentWin = true;
    refreshRandomHighScores();
    return { score, bestScore: isNewBest ? score : previous, isNewBest };
  }

  function beginRandomScoreSession() {
    const gs = gameState();
    const saved = gs?.randomScoreSnapshot;
    active = true;
    eventScore = 0;
    awardedCats = new Set();
    if (saved && Number.isFinite(saved.eventScore) && Number.isInteger(saved.eventScore)
        && Array.isArray(saved.awardedCats) && saved.awardedCats.length <= gs.n
        && saved.awardedCats.every(key => typeof key === "string" && /^\d+,\d+$/.test(key)
          && Number(key.split(",")[0]) < gs.n
          && Number(key.split(",")[1]) === gs.solution[Number(key.split(",")[0])])) {
      eventScore = saved.eventScore;
      awardedCats = new Set(saved.awardedCats);
    } else {
      // 舊中途紀錄未保存分數，至少還原目前已找到的貓與可見錯誤，不重複加分。
      for (let r = 0; r < gs.n; r++) for (let c = 0; c < gs.n; c++) {
        if (gs.board[r][c] === CAT) { awardedCats.add(`${r},${c}`); eventScore += CAT_POINTS; }
        else if (gs.board[r][c] === WRONG) eventScore -= WRONG_PENALTY;
      }
    }
    savedForCurrentWin = false;
    startTimer();
  }

  function endScoreSession() {
    active = false;
    eventScore = 0;
    awardedCats.clear();
    savedForCurrentWin = false;
    stopTimer();
    updateDisplay();
  }

  function deductRestart() {
    if (!active || !isRandomGame()) return;

    // A restart abandons the cats found in the current board attempt. Remove
    // those positive points before applying the restart penalty, so repeatedly
    // finding the same cats cannot be used to farm score.
    eventScore -= awardedCats.size * CAT_POINTS;
    awardedCats.clear();
    eventScore -= RESTART_PENALTY;
    savedForCurrentWin = false;
    updateDisplay();
  }

  function scoreCatAttempt(r, c, beforeState, heartsBefore) {
    if (!active || !isRandomGame()) return;
    const gs = gameState();
    if (!gs?.board || !gs?.solution) return;

    const afterState = gs.board?.[r]?.[c];
    const heartsAfter = Number(gs.hearts);
    const wasCorrect = Number(gs.solution?.[r]) === Number(c);
    const cellKey = `${r},${c}`;

    if (wasCorrect && afterState !== beforeState && !awardedCats.has(cellKey)) {
      awardedCats.add(cellKey);
      eventScore += CAT_POINTS;
    } else if (Number.isFinite(heartsBefore) && Number.isFinite(heartsAfter) && heartsAfter < heartsBefore) {
      eventScore -= WRONG_PENALTY;
    }

    updateDisplay();

    // The original attemptPlaceCat calls checkWin synchronously, so gameOver is
    // already true here when the final correct cat completed the puzzle.
    if (wasCorrect && gs.gameOver && awardedCats.size === Number(gs.n)) {
      saveBestScore();
      stopTimer();
      updateDisplay();
    }
  }

  function detectRandomSize(button) {
    if (!(button instanceof Element)) return null;
    const dataCandidates = [button.dataset.size, button.dataset.n, button.dataset.boardSize];
    for (const value of dataCandidates) {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) return n;
    }

    const strongText = String(button.querySelector("strong")?.textContent || "").trim();
    const match = strongText.match(/^(\d{1,2})(?:\s*[x×X]\s*\1)?$/);
    return match ? Number(match[1]) : null;
  }

  function refreshRandomHighScores() {
    if (!randomSizeButtons) return;

    [...randomSizeButtons.querySelectorAll(".random-size-button")].forEach((button) => {
      if (button.classList.contains("share-code-import-button")) return;
      const n = detectRandomSize(button);
      if (!Number.isInteger(n)) return;

      let meta = button.querySelector("small");
      if (!meta) {
        meta = document.createElement("small");
        button.appendChild(meta);
      }

      let line = meta.querySelector(".random-high-score");
      if (!line) {
        line = document.createElement("span");
        line.className = "random-high-score";
        meta.appendChild(line);
      }

      const best = bestScoreForSize(n);
      const nextText = best == null ? "最高分 --" : `最高分 ${formatScore(best)}`;
      if (line.textContent !== nextText) line.textContent = nextText;
    });
  }

  function wrapGlobalFunction(name, wrapperFactory) {
    try {
      const original = globalThis[name];
      if (typeof original !== "function" || original.__scoreSystemWrapped) return;
      const wrapped = wrapperFactory(original);
      Object.defineProperty(wrapped, "__scoreSystemWrapped", { value: true });
      globalThis[name] = wrapped;
    } catch { }
  }

  wrapGlobalFunction("beginGame", (original) => function (...args) {
    const result = original.apply(this, args);
    const config = args[0] || {};
    if (config.mode === "random" || isRandomGame()) beginRandomScoreSession();
    else endScoreSession();
    return result;
  });

  wrapGlobalFunction("restartCurrentGame", (original) => function (...args) {
    if (isRandomGame() && active) deductRestart();
    const result = original.apply(this, args);
    if (isRandomGame() && active) startTimer();
    return result;
  });

  wrapGlobalFunction("attemptPlaceCat", (original) => function (r, c, ...rest) {
    const gs = gameState();
    const beforeState = gs?.board?.[r]?.[c];
    const heartsBefore = Number(gs?.hearts);
    const result = original.call(this, r, c, ...rest);
    scoreCatAttempt(r, c, beforeState, heartsBefore);
    return result;
  });

  // The random selector is generated dynamically in the current game build.
  // Observe it instead of depending on one specific rendering implementation.
  if (randomSizeButtons && typeof MutationObserver === "function") {
    let refreshing = false;
    const observer = new MutationObserver(() => {
      if (refreshing) return;
      refreshing = true;
      try { refreshRandomHighScores(); }
      finally { refreshing = false; }
    });
    observer.observe(randomSizeButtons, { childList: true, subtree: true, characterData: true });
  }

  // Hide the score immediately when leaving the gameplay screen, even if the
  // current state object still says random until another mode is entered.
  if (screenGame && typeof MutationObserver === "function") {
    const screenObserver = new MutationObserver(updateDisplay);
    screenObserver.observe(screenGame, { attributes: true, attributeFilter: ["class"] });
  }

  refreshRandomHighScores();
  updateDisplay();

  globalThis.MeowdokuRandomScore = Object.freeze({
    get current() { return currentScore(); },
    get bestBySize() { return readScoreRecords(); },
    refresh: refreshRandomHighScores,
    snapshot: () => ({ eventScore, awardedCats: [...awardedCats] }),
  });
})();
