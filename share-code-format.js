"use strict";

// Pure share-code codec. New codes contain the complete board; legacy MD codes
// remain readable as best-effort seed references.
(function (root) {
  const FORMAT_VERSION = 2;
  const MIN_SIZE = 6;
  const MAX_SIZE = 12;
  const UINT32_MAX = 0xFFFFFFFF;

  function assertSize(n) {
    n = Number(n);
    if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
      throw new Error(`目前只支援 ${MIN_SIZE}x${MIN_SIZE} 至 ${MAX_SIZE}x${MAX_SIZE}`);
    }
    return n;
  }

  function assertSeed(seed) {
    seed = Number(seed);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > UINT32_MAX) {
      throw new Error("分享碼 SEED 超出有效範圍");
    }
    return seed >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function packNibbles(values, bytes, offset) {
    for (let i = 0; i < values.length; i++) {
      const byteIndex = offset + (i >> 1);
      if ((i & 1) === 0) bytes[byteIndex] = values[i] << 4;
      else bytes[byteIndex] |= values[i];
    }
    return offset + Math.ceil(values.length / 2);
  }

  function unpackNibbles(bytes, offset, count) {
    const values = new Array(count);
    for (let i = 0; i < count; i++) {
      const byte = bytes[offset + (i >> 1)];
      values[i] = (i & 1) === 0 ? byte >>> 4 : byte & 0x0F;
    }
    return { values, offset: offset + Math.ceil(count / 2) };
  }

  function toBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function fromBase64Url(payload) {
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("分享碼格式不正確");
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4);
    try {
      if (typeof atob === "function") {
        const binary = atob(padded);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
      }
      return Uint8Array.from(Buffer.from(padded, "base64"));
    } catch {
      throw new Error("分享碼格式不正確");
    }
  }

  function normalizeShareCode(raw) {
    const text = String(raw || "").trim();
    if (/^MD2-/i.test(text)) return `MD2-${text.slice(4)}`;
    return text.toUpperCase().replace(/\s+/g, "");
  }

  function encodeShareCode({ n, seed, regions, solution }) {
    n = assertSize(n);
    seed = assertSeed(seed);
    if (!Array.isArray(regions) || regions.length !== n ||
        !regions.every((row) => Array.isArray(row) && row.length === n)) {
      throw new Error("分享關卡區域資料不完整");
    }
    if (!Array.isArray(solution) || solution.length !== n) {
      throw new Error("分享關卡答案資料不完整");
    }

    const flatRegions = regions.flat();
    if (!flatRegions.every((value) => Number.isInteger(value) && value >= 0 && value < n) ||
        !solution.every((value) => Number.isInteger(value) && value >= 0 && value < n)) {
      throw new Error("分享關卡資料超出有效範圍");
    }

    const bodyLength = 6 + Math.ceil(n * n / 2) + Math.ceil(n / 2);
    const bytes = new Uint8Array(bodyLength + 4);
    bytes[0] = FORMAT_VERSION;
    bytes[1] = n;
    new DataView(bytes.buffer).setUint32(2, seed, true);
    let offset = packNibbles(flatRegions, bytes, 6);
    offset = packNibbles(solution, bytes, offset);
    new DataView(bytes.buffer).setUint32(offset, crc32(bytes.subarray(0, offset)), false);
    return `MD2-${toBase64Url(bytes)}`;
  }

  function decodeFullBoardShareCode(code) {
    const payload = code.slice(4);
    const bytes = fromBase64Url(payload);
    if (bytes.length < 10 || bytes[0] !== FORMAT_VERSION) throw new Error("分享碼版本不支援");

    const n = assertSize(bytes[1]);
    const expectedLength = 6 + Math.ceil(n * n / 2) + Math.ceil(n / 2) + 4;
    if (bytes.length !== expectedLength) throw new Error("分享碼長度不正確");

    const checksumOffset = bytes.length - 4;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(checksumOffset, false) !== crc32(bytes.subarray(0, checksumOffset))) {
      throw new Error("分享碼無效或已損壞");
    }

    const seed = view.getUint32(2, true);
    let unpacked = unpackNibbles(bytes, 6, n * n);
    const flatRegions = unpacked.values;
    unpacked = unpackNibbles(bytes, unpacked.offset, n);
    const solution = unpacked.values;
    if (!flatRegions.every((value) => value < n) || !solution.every((value) => value < n)) {
      throw new Error("分享關卡資料超出有效範圍");
    }

    const regions = Array.from({ length: n }, (_, row) => flatRegions.slice(row * n, (row + 1) * n));
    const canonical = encodeShareCode({ n, seed, regions, solution });
    if (canonical !== code) throw new Error("分享碼不是有效的標準格式");
    return { format: FORMAT_VERSION, code: canonical, n, seed, regions, solution, legacy: false };
  }

  function decodeLegacyShareCode(code) {
    const match = /^MD-(\d{1,2})-([0-9A-Z]{1,7})$/.exec(code);
    if (!match) throw new Error("分享碼格式不正確");
    const n = assertSize(match[1]);
    const seed = assertSeed(Number.parseInt(match[2], 36));
    const canonical = `MD-${n}-${seed.toString(36).toUpperCase()}`;
    if (canonical !== code) throw new Error("分享碼格式不正確");
    return { format: 1, code: canonical, n, seed, regions: null, solution: null, legacy: true };
  }

  function decodeShareCode(raw) {
    const code = normalizeShareCode(raw);
    if (code.startsWith("MD2-")) return decodeFullBoardShareCode(code);
    if (code.startsWith("MD-")) return decodeLegacyShareCode(code);
    throw new Error("分享碼格式不正確");
  }

  const api = {
    FORMAT_VERSION,
    MIN_SIZE,
    MAX_SIZE,
    crc32,
    normalizeShareCode,
    encodeShareCode,
    decodeShareCode,
  };
  root.MeowdokuShareCodeFormat = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
