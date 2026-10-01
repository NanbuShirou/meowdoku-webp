"use strict";

// Browser-side procedural level generator for Meowdoku.
// N x N generic design (currently 6..14):
// 1) create a non-adjacent cat permutation,
// 2) grow N connected colour regions with intentionally varied sizes,
// 3) repair alternate solutions with a node-bounded MRV solver,
// 4) validate topology and uniqueness before returning the level.
(function (root) {
  const DR = [-1, 1, 0, 0];
  const DC = [0, 0, -1, 1];
  const MIN_SIZE = 6;
  const MAX_SIZE = 14;
  const GENERATION_WATCHDOG_MS = 5000;
  const MAX_GENERATION_CANDIDATES = 240;
  const MAX_ALTERNATE_SEARCH_NODES = 250000;
  const MAX_FINAL_CHECK_NODES = 1000000;

  function nowMs() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomInt(rng, maxExclusive) {
    return Math.floor(rng() * maxExclusive);
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randomInt(rng, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Returns a permutation where no position keeps its original value.
  // This is used to break the old invariant "row r -> region r".
  function createDerangement(count, rng) {
    const identity = Array.from({ length: count }, (_, index) => index);
    if (count < 2) return identity;

    for (let attempt = 0; attempt < 32; attempt++) {
      const map = shuffle(identity.slice(), rng);
      if (map.every((value, index) => value !== index)) return map;
    }

    // Deterministic fallback that is always a derangement for count > 1.
    const offset = 1 + randomInt(rng, count - 1);
    return identity.map((value) => (value + offset) % count);
  }

  function createRegionColorMap(regionCount, key) {
    const identity = Array.from({ length: regionCount }, (_, index) => index);
    if (regionCount < 2) return identity;

    let seed = 0x811C9DC5;
    for (const char of String(key)) {
      seed ^= char.charCodeAt(0);
      seed = Math.imul(seed, 0x01000193);
    }

    const rng = makeRng(seed >>> 0);
    return createDerangement(regionCount, rng);
  }

  function idx(n, r, c) { return r * n + c; }

  function cellIsAvailable(owner, n, r, c, assigned, usedRows, usedCols, usedRegions) {
    const rowBit = 1 << r;
    const colBit = 1 << c;
    if (usedRows & rowBit) return false;
    if (usedCols & colBit) return false;
    const region = owner[idx(n, r, c)];
    if (usedRegions & (1 << region)) return false;
    if (r > 0 && assigned[r - 1] >= 0 && Math.abs(c - assigned[r - 1]) <= 1) return false;
    if (r + 1 < n && assigned[r + 1] >= 0 && Math.abs(c - assigned[r + 1]) <= 1) return false;
    return true;
  }

  function chooseConstraint(owner, n, assigned, usedRows, usedCols, usedRegions) {
    const rowCounts = new Int16Array(n);
    const colCounts = new Int16Array(n);
    const regionCounts = new Int16Array(n);

    for (let r = 0; r < n; r++) {
      if (usedRows & (1 << r)) continue;
      for (let c = 0; c < n; c++) {
        if (!cellIsAvailable(owner, n, r, c, assigned, usedRows, usedCols, usedRegions)) continue;
        const region = owner[idx(n, r, c)];
        rowCounts[r]++;
        colCounts[c]++;
        regionCounts[region]++;
      }
    }

    let bestType = -1, bestIndex = -1, bestCount = n * n + 1;
    for (let i = 0; i < n; i++) {
      if (!(usedRows & (1 << i))) {
        if (rowCounts[i] === 0) return { dead: true };
        if (rowCounts[i] < bestCount) { bestCount = rowCounts[i]; bestType = 0; bestIndex = i; }
      }
      if (!(usedCols & (1 << i))) {
        if (colCounts[i] === 0) return { dead: true };
        if (colCounts[i] < bestCount) { bestCount = colCounts[i]; bestType = 1; bestIndex = i; }
      }
      if (!(usedRegions & (1 << i))) {
        if (regionCounts[i] === 0) return { dead: true };
        if (regionCounts[i] < bestCount) { bestCount = regionCounts[i]; bestType = 2; bestIndex = i; }
      }
    }
    return { dead: false, type: bestType, index: bestIndex, count: bestCount };
  }

  function collectConstraintCandidates(owner, n, assigned, usedRows, usedCols, usedRegions, constraint) {
    const result = [];
    for (let r = 0; r < n; r++) {
      if (usedRows & (1 << r)) continue;
      for (let c = 0; c < n; c++) {
        if (!cellIsAvailable(owner, n, r, c, assigned, usedRows, usedCols, usedRegions)) continue;
        const region = owner[idx(n, r, c)];
        if (constraint.type === 0 && r !== constraint.index) continue;
        if (constraint.type === 1 && c !== constraint.index) continue;
        if (constraint.type === 2 && region !== constraint.index) continue;
        result.push([r, c, region]);
      }
    }
    return result;
  }

  // Exact solution counter using MRV across row, column and region constraints.
  // -1 means the deterministic node budget was exhausted.
  function countSolutions(owner, n, limit = 2, nodeBudget = MAX_FINAL_CHECK_NODES) {
    const assigned = new Int16Array(n);
    assigned.fill(-1);
    let count = 0;
    let nodes = 0;
    let exhausted = false;

    function bt(usedRows, usedCols, usedRegions) {
      if (count >= limit || exhausted) return;
      if (++nodes > nodeBudget) { exhausted = true; return; }
      if (usedRows === ((1 << n) - 1)) { count++; return; }

      const constraint = chooseConstraint(owner, n, assigned, usedRows, usedCols, usedRegions);
      if (constraint.dead || constraint.type < 0) return;
      const candidates = collectConstraintCandidates(owner, n, assigned, usedRows, usedCols, usedRegions, constraint);

      for (const [r, c, region] of candidates) {
        assigned[r] = c;
        bt(usedRows | (1 << r), usedCols | (1 << c), usedRegions | (1 << region));
        assigned[r] = -1;
        if (count >= limit || exhausted) return;
      }
    }

    bt(0, 0, 0);
    return exhausted ? -1 : count;
  }

  // Finds one solution different from excluded. Node exhaustion rejects only
  // this candidate; the wall clock is an abnormal-stop watchdog, not a branch.
  function findAlternate(owner, n, excluded, nodeBudget, watchdogDeadline) {
    const assigned = new Int16Array(n);
    assigned.fill(-1);
    let result = null;
    let exhausted = false;
    let nodes = 0;

    function bt(usedRows, usedCols, usedRegions, differs) {
      if (result || exhausted) return;
      if (++nodes > nodeBudget) { exhausted = true; return; }
      if ((nodes & 4095) === 0 && nowMs() >= watchdogDeadline) {
        throw new Error("隨機關卡生成安全逾時");
      }
      if (usedRows === ((1 << n) - 1)) {
        if (differs) result = Array.from(assigned);
        return;
      }

      const constraint = chooseConstraint(owner, n, assigned, usedRows, usedCols, usedRegions);
      if (constraint.dead || constraint.type < 0) return;
      const candidates = collectConstraintCandidates(owner, n, assigned, usedRows, usedCols, usedRegions, constraint);
      candidates.sort((a, b) => {
        const ae = a[1] === excluded[a[0]] ? 1 : 0;
        const be = b[1] === excluded[b[0]] ? 1 : 0;
        return ae - be;
      });

      for (const [r, c, region] of candidates) {
        assigned[r] = c;
        bt(
          usedRows | (1 << r),
          usedCols | (1 << c),
          usedRegions | (1 << region),
          differs || c !== excluded[r]
        );
        assigned[r] = -1;
        if (result || exhausted) return;
      }
    }

    bt(0, 0, 0, false);
    return { placement: result, exhausted, nodes };
  }

  function randomPermNoAdj(n, rng) {
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let attempt = 0; attempt < 10000; attempt++) {
      shuffle(perm, rng);
      let ok = true;
      for (let r = 1; r < n; r++) {
        if (Math.abs(perm[r] - perm[r - 1]) <= 1) { ok = false; break; }
      }
      if (ok) return perm.slice();
    }
    return null;
  }

  function regionSizeBounds(n) {
    return {
      min: n >= 9 ? 3 : 2,
      max: Math.max(n, Math.ceil(n * 2.80)),
    };
  }

  // Preserve the original intentionally uneven region distribution, but give
  // every region a guaranteed minimum footprint. Remaining cells are assigned
  // by weighted lottery, capped only to prevent a single region from dominating.
  function makeTargetSizes(n, rng) {
    const total = n * n;
    const { min, max } = regionSizeBounds(n);
    const targets = new Int16Array(n);
    const weights = new Float64Array(n);
    targets.fill(min);

    for (let i = 0; i < n; i++) {
      weights[i] = 0.08 + Math.pow(rng(), 2.0) * 2.5;
    }

    let remaining = total - min * n;
    while (remaining > 0) {
      let weightSum = 0;
      for (let i = 0; i < n; i++) {
        if (targets[i] < max) weightSum += weights[i];
      }
      if (weightSum <= 0) return null;

      let pick = rng() * weightSum;
      let chosen = -1;
      for (let i = 0; i < n; i++) {
        if (targets[i] >= max) continue;
        pick -= weights[i];
        if (pick <= 0) { chosen = i; break; }
      }
      if (chosen < 0) {
        for (let i = n - 1; i >= 0; i--) {
          if (targets[i] < max) { chosen = i; break; }
        }
      }
      if (chosen < 0) return null;
      targets[chosen]++;
      remaining--;
    }
    return targets;
  }

  function addFrontier(frontiers, owner, n, region, r, c) {
    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d], nc = c + DC[d];
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      const p = idx(n, nr, nc);
      if (owner[p] === -1) frontiers[region].push(p);
    }
  }

  // Connected multi-source growth. Phase 1 gives every region its minimum
  // footprint; phase 2 grows toward the bounded random target sizes.
  function growRegions(n, catCols, rng) {
    const owner = new Int16Array(n * n);
    owner.fill(-1);
    const sizes = new Int16Array(n);
    const targets = makeTargetSizes(n, rng);
    if (!targets) return null;
    const { min, max } = regionSizeBounds(n);
    const frontiers = Array.from({ length: n }, () => []);

    // Old generator used region === row for every answer cat. That leaked a
    // permanent A/B/C/... ordering into every board. Assign each answer row to
    // a different region id instead. The RNG is seeded, so the same level seed
    // still reproduces exactly the same board.
    const regionForRow = createDerangement(n, rng);
    for (let row = 0; row < n; row++) {
      const region = regionForRow[row];
      const p = idx(n, row, catCols[row]);
      owner[p] = region;
      sizes[region] = 1;
      addFrontier(frontiers, owner, n, region, row, catCols[row]);
    }

    let unclaimed = n * n - n;
    while (unclaimed > 0) {
      let needsMinimum = false;
      for (let region = 0; region < n; region++) {
        if (sizes[region] < min) { needsMinimum = true; break; }
      }

      let bestRegion = -1;
      let bestScore = -Infinity;
      for (let region = 0; region < n; region++) {
        if (sizes[region] >= max) continue;
        if (needsMinimum && sizes[region] >= min) continue;

        const frontier = frontiers[region];
        while (frontier.length && owner[frontier[frontier.length - 1]] !== -1) frontier.pop();
        if (!frontier.length) continue;

        const need = needsMinimum
          ? (min - sizes[region])
          : (targets[region] - sizes[region]);
        const score = need * 5 + rng() * 3 - sizes[region] * 0.06;
        if (score > bestScore) {
          bestScore = score;
          bestRegion = region;
        }
      }

      // A region was enclosed before reaching the minimum, or every available
      // region hit the maximum. Reject this candidate instead of degrading it.
      if (bestRegion < 0) return null;

      const frontier = frontiers[bestRegion];
      let p = -1;
      while (frontier.length) {
        const pick = randomInt(rng, frontier.length);
        const candidate = frontier[pick];
        frontier[pick] = frontier[frontier.length - 1];
        frontier.pop();
        if (owner[candidate] === -1) { p = candidate; break; }
      }
      if (p < 0) continue;

      owner[p] = bestRegion;
      sizes[bestRegion]++;
      unclaimed--;
      const r = Math.floor(p / n), c = p % n;
      addFrontier(frontiers, owner, n, bestRegion, r, c);
    }

    for (let region = 0; region < n; region++) {
      if (sizes[region] < min || sizes[region] > max) return null;
    }
    return owner;
  }

  function buildRegionMasks(owner, n) {
    const masks = Array.from({ length: n }, () => new Uint16Array(n));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const region = owner[idx(n, r, c)];
        if (region >= 0 && region < n) masks[region][r] |= 1 << c;
      }
    }
    return masks;
  }

  function popcount(x) {
    x >>>= 0;
    let c = 0;
    while (x) { x &= x - 1; c++; }
    return c;
  }

  function findRegionCatSeeds(owner, n, catCols) {
    const rows = new Int16Array(n);
    const cols = new Int16Array(n);
    const counts = new Int16Array(n);
    rows.fill(-1);
    cols.fill(-1);

    for (let r = 0; r < n; r++) {
      const c = catCols[r];
      if (c < 0 || c >= n) return null;
      const region = owner[idx(n, r, c)];
      if (region < 0 || region >= n) return null;
      counts[region]++;
      rows[region] = r;
      cols[region] = c;
    }

    for (let region = 0; region < n; region++) {
      if (counts[region] !== 1 || rows[region] < 0 || cols[region] < 0) return null;
    }

    return { rows, cols };
  }

  function isConnectedMask(maskRows, n, sr, sc) {
    if (((maskRows[sr] >>> sc) & 1) === 0) return false;
    let total = 0;
    for (let r = 0; r < n; r++) total += popcount(maskRows[r]);
    if (total === 0) return false;

    const seen = new Uint16Array(n);
    const qr = new Int16Array(n * n);
    const qc = new Int16Array(n * n);
    let head = 0, tail = 0, found = 0;
    qr[tail] = sr; qc[tail] = sc; tail++;
    seen[sr] |= 1 << sc;

    while (head < tail) {
      const r = qr[head], c = qc[head]; head++;
      found++;
      for (let d = 0; d < 4; d++) {
        const nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
        if (((maskRows[nr] >>> nc) & 1) === 0) continue;
        if ((seen[nr] >>> nc) & 1) continue;
        seen[nr] |= 1 << nc;
        qr[tail] = nr; qc[tail] = nc; tail++;
      }
    }
    return found === total;
  }

  // Strict invariant check: exactly N region ids, each one connected, and each
  // contains exactly one answer cat. Region ids are intentionally independent
  // from answer-row numbers.
  function validateLevel(owner, n, catCols) {
    if (!owner || owner.length !== n * n || !catCols || catCols.length !== n) return false;

    let usedCols = 0;
    for (let r = 0; r < n; r++) {
      const c = catCols[r];
      if (c < 0 || c >= n) return false;
      if (r > 0 && Math.abs(c - catCols[r - 1]) <= 1) return false;
      const bit = 1 << c;
      if (usedCols & bit) return false;
      usedCols |= bit;
    }

    const seeds = findRegionCatSeeds(owner, n, catCols);
    if (!seeds) return false;

    const masks = buildRegionMasks(owner, n);
    const { min, max } = regionSizeBounds(n);
    for (let region = 0; region < n; region++) {
      let regionSize = 0;
      for (let r = 0; r < n; r++) regionSize += popcount(masks[region][r]);
      if (regionSize < min || regionSize > max) return false;
      if (!isConnectedMask(masks[region], n, seeds.rows[region], seeds.cols[region])) return false;
    }
    return true;
  }

  function repairUniqueness(owner, n, catCols, rng, maxIters, watchdogDeadline) {
    const seeds = findRegionCatSeeds(owner, n, catCols);
    if (!seeds) return false;

    const masks = buildRegionMasks(owner, n);
    const sizes = new Int16Array(n);
    const { min, max } = regionSizeBounds(n);
    for (let region = 0; region < n; region++) {
      for (let r = 0; r < n; r++) sizes[region] += popcount(masks[region][r]);
    }
    const dirs = [0, 1, 2, 3];

    for (let iter = 0; iter < maxIters; iter++) {
      if (nowMs() >= watchdogDeadline) throw new Error("隨機關卡生成安全逾時");
      const altResult = findAlternate(owner, n, catCols, MAX_ALTERNATE_SEARCH_NODES, watchdogDeadline);
      if (altResult.exhausted) return false;
      const alt = altResult.placement;
      if (!alt) return true;

      const diffRows = [];
      for (let r = 0; r < n; r++) if (alt[r] !== catCols[r]) diffRows.push(r);
      shuffle(diffRows, rng);

      let moved = false;
      for (const row of diffRows) {
        const c = alt[row];
        if (c === catCols[row]) continue;
        const p = idx(n, row, c);
        const oldRegion = owner[p];

        let usedBefore = 0;
        for (let r2 = 0; r2 < row; r2++) usedBefore |= 1 << owner[idx(n, r2, alt[r2])];

        const candidates = [];
        const seen = new Uint8Array(n);
        for (let d = 0; d < 4; d++) {
          const nr = row + DR[d], nc = c + DC[d];
          if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
          const region = owner[idx(n, nr, nc)];
          if (region !== oldRegion && !seen[region]) {
            seen[region] = 1;
            candidates.push(region);
          }
        }
        if (!candidates.length) continue;

        const preferred = candidates.filter((region) => (usedBefore & (1 << region)) !== 0);
        const pool = preferred.length ? preferred : candidates;
        shuffle(pool, rng);

        for (const newRegion of pool) {
          if (sizes[oldRegion] <= min || sizes[newRegion] >= max) continue;

          masks[oldRegion][row] &= ~(1 << c);
          if (!isConnectedMask(masks[oldRegion], n, seeds.rows[oldRegion], seeds.cols[oldRegion])) {
            masks[oldRegion][row] |= 1 << c;
            continue;
          }
          masks[newRegion][row] |= 1 << c;
          owner[p] = newRegion;
          sizes[oldRegion]--;
          sizes[newRegion]++;
          moved = true;
          break;
        }
        if (moved) break;
      }

      if (!moved) {
        // Small random boundary nudge. Cat cells never move and source region
        // connectivity is always rechecked before committing.
        for (let tries = 0; tries < n * 2 && !moved; tries++) {
          const r = randomInt(rng, n), c = randomInt(rng, n);
          if (c === catCols[r]) continue;
          const p = idx(n, r, c);
          const oldRegion = owner[p];
          shuffle(dirs, rng);
          for (const d of dirs) {
            const nr = r + DR[d], nc = c + DC[d];
            if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
            const newRegion = owner[idx(n, nr, nc)];
            if (newRegion === oldRegion) continue;
            if (sizes[oldRegion] <= min || sizes[newRegion] >= max) continue;

            masks[oldRegion][r] &= ~(1 << c);
            if (!isConnectedMask(masks[oldRegion], n, seeds.rows[oldRegion], seeds.cols[oldRegion])) {
              masks[oldRegion][r] |= 1 << c;
              continue;
            }
            masks[newRegion][r] |= 1 << c;
            owner[p] = newRegion;
            sizes[oldRegion]--;
            sizes[newRegion]++;
            moved = true;
            break;
          }
        }
      }

      if (!moved) return false;
    }
    return false;
  }

  function generateRandomLevel(n, seed) {
    if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
      throw new Error(`盤面大小必須介於 ${MIN_SIZE} 到 ${MAX_SIZE}`);
    }

    const actualSeed = (seed == null
      ? ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0)
      : seed >>> 0);
    const rng = makeRng(actualSeed);
    const startedAt = nowMs();
    const watchdogDeadline = startedAt + GENERATION_WATCHDOG_MS;
    const maxRepairIters = 70 + n * 6;

    let candidatesTried = 0;
    for (let attempt = 0; attempt < MAX_GENERATION_CANDIDATES; attempt++) {
      if (nowMs() >= watchdogDeadline) throw new Error("隨機關卡生成安全逾時");
      const catCols = randomPermNoAdj(n, rng);
      if (!catCols) continue;

      const owner = growRegions(n, catCols, rng);
      if (!owner) continue;
      candidatesTried++;

      if (!repairUniqueness(owner, n, catCols, rng, maxRepairIters, watchdogDeadline)) continue;
      if (!validateLevel(owner, n, catCols)) continue;

      const finalCheck = findAlternate(owner, n, catCols, MAX_FINAL_CHECK_NODES, watchdogDeadline);
      if (finalCheck.exhausted || finalCheck.placement) continue;

      const regions = Array.from({ length: n }, (_, r) =>
        Array.from({ length: n }, (_, c) => owner[idx(n, r, c)])
      );
      return {
        n,
        seed: actualSeed,
        regions,
        solution: catCols.slice(),
        generationMs: Math.round((nowMs() - startedAt) * 10) / 10,
        candidatesTried,
      };
    }

    throw new Error(`無法在 ${MAX_GENERATION_CANDIDATES} 個候選內生成唯一解關卡`);
  }

  const api = { generateRandomLevel, countSolutions, validateLevel, createRegionColorMap };
  root.MeowdokuRandomGenerator = api;

  if (typeof WorkerGlobalScope !== "undefined" && root instanceof WorkerGlobalScope) {
    root.onmessage = (event) => {
      try {
        const { n, seed } = event.data || {};
        const level = generateRandomLevel(Number(n), seed);
        root.postMessage({ ok: true, level });
      } catch (error) {
        root.postMessage({ ok: false, error: error?.message || String(error) });
      }
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
