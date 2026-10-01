"use strict";

// MeowDoku random-level share-code UI. New MD2 codes contain the complete board;
// legacy MD seed codes remain readable on a best-effort basis.
(function () {
  const STORAGE_KEY = "meowdoku_random_share_codes";
  const shareCodeFormat = globalThis.MeowdokuShareCodeFormat;
  const MIN_SIZE = shareCodeFormat?.MIN_SIZE ?? 6;
  const MAX_SIZE = shareCodeFormat?.MAX_SIZE ?? 12;
  const RANDOM_GENERATION_TIMEOUT_MS = 6000;

  const screenGame = document.getElementById("screen-game");
  const randomSelect = document.getElementById("screen-random-select");
  const randomSizeGrid = document.getElementById("random-size-buttons");
  const btnShare = document.getElementById("btn-share-code");
  const winModal = document.getElementById("win-modal");
  const btnSaveCurrent = document.getElementById("btn-save-share-code");

  const shareModal = document.getElementById("share-code-modal");
  const currentCodeEl = document.getElementById("share-code-current");
  const copyStatus = document.getElementById("share-code-copy-status");
  const btnCopy = document.getElementById("btn-copy-share-code");
  const btnCloseShare = document.getElementById("btn-close-share-code");

  const importModal = document.getElementById("share-code-import-modal");
  const importNameInput = document.getElementById("share-code-import-name");
  const input = document.getElementById("share-code-input");
  const importStatus = document.getElementById("share-code-status");
  const btnLoad = document.getElementById("btn-load-share-code");
  const btnRename = document.getElementById("btn-rename-share-code");
  const btnDelete = document.getElementById("btn-delete-share-code");
  const btnCloseImport = document.getElementById("btn-close-share-code-import");
  const savedCodeList = document.getElementById("saved-share-code-list");

  const saveModal = document.getElementById("save-share-code-modal");
  const saveNameInput = document.getElementById("save-share-code-name");
  const saveCodeValue = document.getElementById("save-share-code-value");
  const saveStatus = document.getElementById("save-share-code-status");
  const btnConfirmSave = document.getElementById("btn-confirm-save-share-code");
  const btnCancelSave = document.getElementById("btn-cancel-save-share-code");

  if (!shareCodeFormat || !screenGame || !randomSelect || !randomSizeGrid || !btnShare || !winModal || !btnSaveCurrent ||
      !shareModal || !currentCodeEl || !copyStatus || !btnCopy || !btnCloseShare || !importModal || !importNameInput || !input ||
      !importStatus || !btnLoad || !btnRename || !btnDelete || !btnCloseImport || !savedCodeList || !saveModal || !saveNameInput ||
      !saveCodeValue || !saveStatus || !btnConfirmSave || !btnCancelSave) {
    console.warn("MeowDoku 分享碼介面不完整，已停用分享碼功能。");
    return;
  }

  function readSavedCodes() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (Array.isArray(raw)) {
        return raw.filter((item) => item && typeof item.name === "string" && typeof item.code === "string")
          .map((item) => normalizeSavedRecord(item.name, item.code, item.savedAt)).filter(Boolean);
      }
      if (raw && typeof raw === "object") {
        return Object.entries(raw)
          .filter(([, code]) => typeof code === "string")
          .map(([name, code]) => normalizeSavedRecord(name.replace(/x/i, "×"), code, 0)).filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }

  function normalizeSavedRecord(name, code, savedAt) {
    try {
      return {
        name: String(name || "").trim().slice(0, 40),
        code: shareCodeFormat.decodeShareCode(code).code,
        savedAt: Number(savedAt) || 0,
      };
    } catch {
      return null;
    }
  }

  function writeSavedCodes(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      throw new Error("無法保存關卡");
    }
  }

  function saveNamedCode(name, code) {
    const cleanName = String(name || "").trim().slice(0, 40);
    if (!cleanName) throw new Error("請輸入關卡名稱");
    const normalizedCode = decodeShareCode(code).code;
    const data = readSavedCodes();
    const existing = data.find((item) => item.code === normalizedCode);
    if (existing) {
      existing.name = cleanName;
      existing.savedAt = Date.now();
    } else {
      data.unshift({ name: cleanName, code: normalizedCode, savedAt: Date.now() });
    }
    writeSavedCodes(data);
  }

  function encodeShareCode(randomState) {
    try {
      return shareCodeFormat.encodeShareCode(randomState);
    } catch {
      return null;
    }
  }

  function decodeShareCode(raw) {
    return shareCodeFormat.decodeShareCode(raw);
  }

  function getRandomState() {
    try {
      if (typeof state === "undefined" || !state || state.mode !== "random") return null;
      const n = Number(state.n);
      const seed = Number(state.randomSeed);
      if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE || !Number.isFinite(seed)) return null;
      if (!Array.isArray(state.regions) || state.regions.length !== n ||
          !Array.isArray(state.solution) || state.solution.length !== n) return null;
      return {
        n,
        seed: seed >>> 0,
        regions: state.regions.map((row) => row.slice()),
        solution: state.solution.slice(),
        gameOver: !!state.gameOver,
      };
    } catch {
      return null;
    }
  }

  function setMessage(el, message, kind = "") {
    el.textContent = message || "";
    el.dataset.kind = kind;
    el.classList.toggle("hidden", !message);
  }

  function syncShareButton() {
    const gameVisible = !screenGame.classList.contains("hidden");
    const randomState = gameVisible ? getRandomState() : null;
    const visible = !!randomState;
    btnShare.classList.toggle("hidden", !visible);
    btnSaveCurrent.classList.toggle("hidden", !randomState?.gameOver || winModal.dataset.result !== "win");

    const actions = document.getElementById("game-bottom-actions");
    if (actions) actions.classList.toggle("has-share-code", visible);

    if (!visible) {
      closeShareModal();
      closeSaveModal();
      return;
    }

    const code = encodeShareCode(randomState);
    btnSaveCurrent.textContent = readSavedCodes().some((item) => item.code === code) ? "已保存此關卡" : "保存此關卡";
  }

  function ensureImportButton() {
    let button = document.getElementById("btn-import-share-code");
    if (!button) {
      button = document.createElement("button");
      button.id = "btn-import-share-code";
      button.className = "random-size-button share-code-import-button";
      button.type = "button";
      button.innerHTML = "<strong>輸入分享碼</strong><small>載入隨機關卡</small>";
    }

    if (button.parentElement !== randomSizeGrid || button !== randomSizeGrid.lastElementChild) {
      randomSizeGrid.appendChild(button);
    }

    if (!button.dataset.shareCodeBound) {
      button.dataset.shareCodeBound = "1";
      button.addEventListener("click", openImportModal);
    }
  }

  let selectedSavedCode = "";

  function syncSavedSelection() {
    [...savedCodeList.querySelectorAll(".saved-share-code-item")].forEach((button) => {
      const selected = button.dataset.code === selectedSavedCode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    btnRename.disabled = !selectedSavedCode;
    btnDelete.disabled = !selectedSavedCode;
  }

  function renderSavedCodes() {
    savedCodeList.innerHTML = "";
    const saved = readSavedCodes();
    if (!saved.some((item) => item.code === selectedSavedCode)) selectedSavedCode = "";
    if (!saved.length) {
      const empty = document.createElement("div");
      empty.className = "saved-share-code-empty";
      empty.textContent = "尚未保存關卡";
      savedCodeList.appendChild(empty);
      syncSavedSelection();
      return;
    }

    saved.forEach((item) => {
      const button = document.createElement("button");
      const name = item.name || "未命名關卡";
      button.type = "button";
      button.className = "saved-share-code-item";
      button.dataset.code = item.code;
      button.setAttribute("aria-label", `載入 ${name}`);
      const title = document.createElement("strong");
      const code = document.createElement("small");
      title.textContent = name;
      code.textContent = item.code;
      button.append(title, code);
      button.addEventListener("click", () => {
        selectedSavedCode = item.code;
        importNameInput.value = name;
        input.value = item.code;
        setMessage(importStatus, "");
        syncSavedSelection();
      });
      savedCodeList.appendChild(button);
    });
    syncSavedSelection();
  }

  function openShareModal() {
    const randomState = getRandomState();
    if (!randomState) return;
    const code = encodeShareCode(randomState);
    if (!code) return;

    currentCodeEl.textContent = code;
    setMessage(copyStatus, "");
    shareModal.classList.remove("hidden");
  }

  function closeShareModal() {
    shareModal.classList.add("hidden");
    setMessage(copyStatus, "");
  }

  function openImportModal() {
    selectedSavedCode = "";
    importNameInput.value = "";
    input.value = "";
    setMessage(importStatus, "");
    btnLoad.disabled = false;
    renderSavedCodes();
    importModal.classList.remove("hidden");
    setTimeout(() => input.focus(), 0);
  }

  function closeImportModal() {
    importModal.classList.add("hidden");
    selectedSavedCode = "";
    importNameInput.value = "";
    input.value = "";
    setMessage(importStatus, "");
    btnLoad.disabled = false;
    syncSavedSelection();
  }

  function renameSelectedCode() {
    const name = importNameInput.value.trim().slice(0, 40);
    if (!selectedSavedCode) {
      setMessage(importStatus, "請先選擇要重新命名的關卡", "error");
      return;
    }
    if (!name) {
      setMessage(importStatus, "請輸入關卡名稱", "error");
      importNameInput.focus();
      return;
    }
    const data = readSavedCodes();
    const item = data.find((record) => record.code === selectedSavedCode);
    if (!item) {
      setMessage(importStatus, "找不到選取的關卡", "error");
      renderSavedCodes();
      return;
    }
    item.name = name;
    item.savedAt = Date.now();
    try {
      writeSavedCodes(data);
      renderSavedCodes();
      setMessage(importStatus, "關卡名稱已更新", "success");
    } catch (error) {
      setMessage(importStatus, error?.message || String(error), "error");
    }
  }

  function deleteSelectedCode() {
    if (!selectedSavedCode) {
      setMessage(importStatus, "請先選擇要刪除的關卡", "error");
      return;
    }
    const data = readSavedCodes();
    const index = data.findIndex((item) => item.code === selectedSavedCode);
    if (index < 0) {
      setMessage(importStatus, "找不到選取的關卡", "error");
      renderSavedCodes();
      return;
    }
    const [removed] = data.splice(index, 1);
    try {
      writeSavedCodes(data);
      selectedSavedCode = "";
      importNameInput.value = "";
      input.value = "";
      renderSavedCodes();
      setMessage(importStatus, `已刪除「${removed.name || "未命名關卡"}」`, "success");
    } catch (error) {
      setMessage(importStatus, error?.message || String(error), "error");
    }
  }

  function openSaveModal() {
    const randomState = getRandomState();
    if (!randomState?.gameOver) return;
    const code = encodeShareCode(randomState);
    if (!code) return;
    const existing = readSavedCodes().find((item) => item.code === code);
    saveNameInput.value = existing?.name || `${randomState.n}×${randomState.n} 隨機關卡`;
    saveCodeValue.textContent = code;
    btnConfirmSave.disabled = false;
    setMessage(saveStatus, "");
    saveModal.classList.remove("hidden");
    setTimeout(() => {
      saveNameInput.focus();
      saveNameInput.select();
    }, 0);
  }

  function closeSaveModal() {
    saveModal.classList.add("hidden");
    btnConfirmSave.disabled = false;
    setMessage(saveStatus, "");
  }

  function saveCurrentCode() {
    try {
      saveNamedCode(saveNameInput.value, saveCodeValue.textContent);
      renderSavedCodes();
      btnConfirmSave.disabled = true;
      setMessage(saveStatus, "關卡已保存", "success");
      syncShareButton();
      setTimeout(closeSaveModal, 500);
    } catch (error) {
      setMessage(saveStatus, error?.message || String(error), "error");
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch { }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch { }
    textarea.remove();
    return copied;
  }

  async function generateLevelFromSeed(n, seed) {
    if (typeof Worker === "function") {
      return new Promise((resolve, reject) => {
        const worker = new Worker("random-generator.js");
        let settled = false;
        const timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          worker.terminate();
          reject(new Error("分享關卡生成逾時"));
        }, RANDOM_GENERATION_TIMEOUT_MS);

        const finish = () => {
          clearTimeout(timeoutId);
          worker.terminate();
        };

        worker.onmessage = (event) => {
          if (settled) return;
          settled = true;
          finish();
          if (event.data?.ok) resolve(event.data.level);
          else reject(new Error(event.data?.error || "分享關卡生成失敗"));
        };

        worker.onerror = (event) => {
          if (settled) return;
          settled = true;
          finish();
          reject(new Error(event.message || "分享關卡生成失敗"));
        };

        worker.postMessage({ n, seed });
      });
    }

    if (!globalThis.MeowdokuRandomGenerator?.generateRandomLevel) {
      throw new Error("找不到隨機關卡產生器");
    }
    return globalThis.MeowdokuRandomGenerator.generateRandomLevel(n, seed);
  }

  async function loadShareCode() {
    if (btnLoad.disabled) return;
    let decoded;
    try {
      decoded = decodeShareCode(input.value);
    } catch (error) {
      setMessage(importStatus, error?.message || String(error), "error");
      return;
    }

    try {
      if (typeof beginGame !== "function") {
        throw new Error("目前遊戲核心未提供分享關卡載入介面");
      }

      btnLoad.disabled = true;
      setMessage(importStatus, `正在載入 ${decoded.n}x${decoded.n} 分享關卡…`, "loading");
      const level = decoded.legacy
        ? await generateLevelFromSeed(decoded.n, decoded.seed)
        : decoded;

      const flatRegions = Int16Array.from(level.regions.flat());
      if (!globalThis.MeowdokuRandomGenerator?.validateLevel?.(flatRegions, level.n, level.solution)) {
        throw new Error("分享關卡驗證失敗");
      }
      if (globalThis.MeowdokuRandomGenerator.countSolutions(flatRegions, level.n, 2) !== 1) {
        throw new Error("分享關卡不是唯一解");
      }

      try {
        if (typeof state !== "undefined" && state) state.stageStart = null;
      } catch { }

      closeImportModal();
      beginGame({
        n: level.n,
        mode: "random",
        levelIdx: null,
        regions: level.regions,
        solution: level.solution,
        seed: level.seed,
        fromShareCode: true,
        randomLevelId: decoded.code,
      });
      setTimeout(syncShareButton, 0);
    } catch (error) {
      console.error(error);
      setMessage(importStatus, `載入失敗：${error?.message || error}`, "error");
    } finally {
      btnLoad.disabled = false;
    }
  }

  btnShare.addEventListener("click", openShareModal);
  btnSaveCurrent.addEventListener("click", openSaveModal);
  btnCloseShare.addEventListener("click", closeShareModal);
  btnCopy.addEventListener("click", async () => {
    const code = currentCodeEl.textContent.trim();
    if (!code) return;
    const ok = await copyText(code);
    setMessage(copyStatus, ok ? "分享碼已複製" : "無法自動複製，請長按分享碼複製", ok ? "success" : "error");
  });

  btnCloseImport.addEventListener("click", closeImportModal);
  btnLoad.addEventListener("click", loadShareCode);
  btnRename.addEventListener("click", renameSelectedCode);
  btnDelete.addEventListener("click", deleteSelectedCode);
  importNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      renameSelectedCode();
    }
  });
  input.addEventListener("input", () => {
    if (selectedSavedCode && shareCodeFormat.normalizeShareCode(input.value) !== selectedSavedCode) {
      selectedSavedCode = "";
      importNameInput.value = "";
      syncSavedSelection();
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadShareCode();
    }
  });
  btnCancelSave.addEventListener("click", closeSaveModal);
  btnConfirmSave.addEventListener("click", saveCurrentCode);
  saveNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveCurrentCode();
    }
  });

  shareModal.addEventListener("click", (event) => {
    if (event.target === shareModal) closeShareModal();
  });
  importModal.addEventListener("click", (event) => {
    if (event.target === importModal) closeImportModal();
  });
  saveModal.addEventListener("click", (event) => {
    if (event.target === saveModal) closeSaveModal();
  });

  // game.js can rebuild the random-size grid, so always re-append the import
  // entry as the last tile after its own size buttons.
  new MutationObserver(ensureImportButton).observe(randomSizeGrid, { childList: true });
  new MutationObserver(syncShareButton).observe(screenGame, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(syncShareButton).observe(winModal, { attributes: true, attributeFilter: ["class"] });

  setInterval(() => {
    if (!screenGame.classList.contains("hidden")) syncShareButton();
    if (!randomSelect.classList.contains("hidden")) ensureImportButton();
  }, 300);

  ensureImportButton();
  renderSavedCodes();
  syncShareButton();
})();
