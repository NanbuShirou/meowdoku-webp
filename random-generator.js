"use strict";

// Browser-side procedural level generator for Meowdoku.
// Mirrors the core generation strategy used by tools/generate.cpp:
// 1) create a non-adjacent cat permutation,
// 2) grow connected colour regions,
// 3) repair the regions until the puzzle has exactly one solution.
(function (root) {
  const DR = [-1, 1, 0, 0];
  const DC = [0, 0, -1, 1];

  // 每個顏色區域至少要有幾格
  const MIN_REGION_SIZE = 2;

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

  function idx(n, r, c) {
    return r * n + c;
  }

  // ============================================================
  // 計算解答數量
  // limit = 2 表示只需要知道是 0、1、還是多解
  // ============================================================
  function countSolutions(owner, n, limit = 2) {
    let count = 0;

    function bt(row, prevCol, usedCols, usedRegions) {
      if (count >= limit) return;

      if (row === n) {
        count++;
        return;
      }

      for (let c = 0; c < n; c++) {
        const colBit = 1 << c;

        if (usedCols & colBit) continue;

        // 貓不可與上一列相鄰或斜鄰
        if (
          prevCol >= 0 &&
          c >= prevCol - 1 &&
          c <= prevCol + 1
        ) {
          continue;
        }

        const region = owner[idx(n, row, c)];
        const regionBit = 1 << region;

        if (usedRegions & regionBit) continue;

        bt(
          row + 1,
          c,
          usedCols | colBit,
          usedRegions | regionBit
        );

        if (count >= limit) return;
      }
    }

    bt(0, -1, 0, 0);

    return count;
  }

  // ============================================================
  // 找出一組與指定答案不同的另一組解
  // 如果找不到，代表指定答案為唯一解
  // ============================================================
  function findAlternate(owner, n, excluded) {
    const placement = new Int16Array(n);

    let result = null;

    function bt(row, prevCol, usedCols, usedRegions) {
      if (result) return;

      if (row === n) {
        for (let r = 0; r < n; r++) {
          if (placement[r] !== excluded[r]) {
            result = Array.from(placement);
            return;
          }
        }

        return;
      }

      for (let c = 0; c < n; c++) {
        const colBit = 1 << c;

        if (usedCols & colBit) continue;

        if (
          prevCol >= 0 &&
          c >= prevCol - 1 &&
          c <= prevCol + 1
        ) {
          continue;
        }

        const region = owner[idx(n, row, c)];
        const regionBit = 1 << region;

        if (usedRegions & regionBit) continue;

        placement[row] = c;

        bt(
          row + 1,
          c,
          usedCols | colBit,
          usedRegions | regionBit
        );

        if (result) return;
      }
    }

    bt(0, -1, 0, 0);

    return result;
  }

  // ============================================================
  // 產生每列貓所在欄位
  //
  // 條件：
  // 1. 每欄只能一隻
  // 2. 上下相鄰列的貓不可相鄰
  // ============================================================
  function randomPermNoAdj(n, rng) {
    const perm = Array.from(
      { length: n },
      (_, i) => i
    );

    for (let attempt = 0; attempt < 10000; attempt++) {
      shuffle(perm, rng);

      let ok = true;

      for (let r = 1; r < n; r++) {
        if (
          Math.abs(
            perm[r] - perm[r - 1]
          ) <= 1
        ) {
          ok = false;
          break;
        }
      }

      if (ok) {
        return perm.slice();
      }
    }

    return null;
  }

  // ============================================================
  // 先替每個顏色區域配置「第 2 格」
  //
  // 每隻貓本身是區域第 1 格。
  // 正常擴張開始前，所有區域都必須先取得一個
  // 上下左右相鄰且未被其他區域占用的格子。
  //
  // 使用回溯配對，避免不同區域搶到同一格。
  // ============================================================
  function allocateSecondCells(
    owner,
    n,
    catCols,
    rng
  ) {
    const candidates = Array.from(
      { length: n },
      () => []
    );

    // 建立每個區域可以取得的相鄰候選格
    for (let region = 0; region < n; region++) {
      const r = region;
      const c = catCols[region];

      for (let d = 0; d < 4; d++) {
        const nr = r + DR[d];
        const nc = c + DC[d];

        if (
          nr < 0 ||
          nr >= n ||
          nc < 0 ||
          nc >= n
        ) {
          continue;
        }

        const p = idx(n, nr, nc);

        // 如果是另一隻貓的位置，就不能使用
        if (owner[p] !== -1) continue;

        candidates[region].push([
          nr,
          nc,
          p
        ]);
      }

      shuffle(
        candidates[region],
        rng
      );

      // 如果某隻貓完全沒有任何可取得的鄰格，
      // 這組配置直接放棄
      if (!candidates[region].length) {
        return null;
      }
    }

    const assigned =
      new Array(n).fill(null);

    const used =
      new Uint8Array(n * n);

    function bt(done) {
      if (done === n) {
        return true;
      }

      // MRV：
      // 優先處理剩餘候選最少的區域
      let bestRegion = -1;
      let bestOptions = null;

      for (
        let region = 0;
        region < n;
        region++
      ) {
        if (assigned[region]) continue;

        const options =
          candidates[region].filter(
            (item) => !used[item[2]]
          );

        if (!options.length) {
          return false;
        }

        if (
          bestOptions === null ||
          options.length <
            bestOptions.length
        ) {
          bestRegion = region;
          bestOptions = options;

          if (
            options.length === 1
          ) {
            break;
          }
        }
      }

      shuffle(bestOptions, rng);

      for (const item of bestOptions) {
        const p = item[2];

        assigned[bestRegion] =
          item;

        used[p] = 1;

        if (bt(done + 1)) {
          return true;
        }

        used[p] = 0;
        assigned[bestRegion] =
          null;
      }

      return false;
    }

    return bt(0)
      ? assigned
      : null;
  }

  // ============================================================
  // 產生所有色塊區域
  //
  // Phase 1：
  // 每個區域先強制取得至少 2 格
  //
  // Phase 2：
  // 再開始一般隨機擴張
  // ============================================================
  function growRegions(
    n,
    catCols,
    rng
  ) {
    const owner =
      new Int16Array(n * n);

    owner.fill(-1);

    const queues =
      Array.from(
        { length: n },
        () => []
      );

    const heads =
      new Int16Array(n);

    // 每隻貓先成為自己的區域核心
    for (let i = 0; i < n; i++) {
      owner[
        idx(
          n,
          i,
          catCols[i]
        )
      ] = i;

      queues[i].push([
        i,
        catCols[i]
      ]);
    }

    // ========================================================
    // Phase 1
    // 每個區域必須先取得第 2 格
    // ========================================================
    const secondCells =
      allocateSecondCells(
        owner,
        n,
        catCols,
        rng
      );

    if (!secondCells) {
      return null;
    }

    let unclaimed =
      n * n - n;

    for (
      let region = 0;
      region < n;
      region++
    ) {
      const [
        r,
        c,
        p
      ] = secondCells[region];

      owner[p] = region;

      queues[region].push([
        r,
        c
      ]);

      unclaimed--;
    }

    // ========================================================
    // Phase 2
    // 所有區域已經至少 2 格，
    // 現在再開始正常擴張
    // ========================================================
    const active =
      Array.from(
        { length: n },
        (_, i) => i
      );

    const dirs = [
      0,
      1,
      2,
      3
    ];

    while (unclaimed > 0) {
      shuffle(active, rng);

      let progressed = false;

      for (const region of active) {
        const q =
          queues[region];

        const head =
          heads[region];

        if (
          head >= q.length
        ) {
          continue;
        }

        const [r, c] =
          q[head];

        shuffle(dirs, rng);

        let claimed = false;

        for (const d of dirs) {
          const nr =
            r + DR[d];

          const nc =
            c + DC[d];

          if (
            nr < 0 ||
            nr >= n ||
            nc < 0 ||
            nc >= n
          ) {
            continue;
          }

          const p =
            idx(
              n,
              nr,
              nc
            );

          if (
            owner[p] !== -1
          ) {
            continue;
          }

          owner[p] =
            region;

          q.push([
            nr,
            nc
          ]);

          unclaimed--;

          progressed = true;
          claimed = true;

          break;
        }

        if (!claimed) {
          heads[region]++;
        }
      }

      // 理論上正常不應發生。
      // 如果所有區域都無法再擴張，
      // 此盤直接放棄。
      if (
        !progressed &&
        unclaimed > 0
      ) {
        return null;
      }
    }

    return owner;
  }

  // ============================================================
  // 計算每個區域的格數
  // ============================================================
  function getRegionSizes(
    owner,
    n
  ) {
    const sizes =
      new Int16Array(n);

    for (
      let p = 0;
      p < owner.length;
      p++
    ) {
      sizes[
        owner[p]
      ]++;
    }

    return sizes;
  }

  // ============================================================
  // 確認所有區域都有達到最低格數
  // ============================================================
  function hasMinimumRegionSize(
    owner,
    n,
    minSize =
      MIN_REGION_SIZE
  ) {
    const sizes =
      getRegionSizes(
        owner,
        n
      );

    for (
      let region = 0;
      region < n;
      region++
    ) {
      if (
        sizes[region] <
        minSize
      ) {
        return false;
      }
    }

    return true;
  }

  // ============================================================
  // 建立每個區域的 bit mask
  // ============================================================
  function buildRegionMasks(
    owner,
    n
  ) {
    const masks =
      Array.from(
        { length: n },
        () =>
          new Uint16Array(n)
      );

    for (
      let r = 0;
      r < n;
      r++
    ) {
      for (
        let c = 0;
        c < n;
        c++
      ) {
        masks[
          owner[
            idx(n, r, c)
          ]
        ][r] |=
          1 << c;
      }
    }

    return masks;
  }

  function popcount(x) {
    x >>>= 0;

    let c = 0;

    while (x) {
      x &= x - 1;
      c++;
    }

    return c;
  }

  // ============================================================
  // 檢查區域是否保持上下左右連通
  // ============================================================
  function isConnectedMask(
    maskRows,
    n,
    sr,
    sc
  ) {
    if (
      (
        (
          maskRows[sr] >>>
          sc
        ) &
        1
      ) === 0
    ) {
      return false;
    }

    let total = 0;

    for (
      let r = 0;
      r < n;
      r++
    ) {
      total +=
        popcount(
          maskRows[r]
        );
    }

    const seen =
      new Uint16Array(n);

    const queue = [
      [sr, sc]
    ];

    seen[sr] |=
      1 << sc;

    let found = 0;

    for (
      let head = 0;
      head < queue.length;
      head++
    ) {
      const [r, c] =
        queue[head];

      found++;

      for (
        let d = 0;
        d < 4;
        d++
      ) {
        const nr =
          r + DR[d];

        const nc =
          c + DC[d];

        if (
          nr < 0 ||
          nr >= n ||
          nc < 0 ||
          nc >= n
        ) {
          continue;
        }

        if (
          (
            (
              maskRows[nr] >>>
              nc
            ) &
            1
          ) === 0
        ) {
          continue;
        }

        if (
          (
            (
              seen[nr] >>>
              nc
            ) &
            1
          ) !== 0
        ) {
          continue;
        }

        seen[nr] |=
          1 << nc;

        queue.push([
          nr,
          nc
        ]);
      }
    }

    return found === total;
  }

  // ============================================================
  // 唯一解修復
  //
  // 如果有其他答案，就嘗試把某些格子
  // 移到鄰近區域，讓另一組答案失效。
  //
  // 重要：
  // 不允許任何區域被削到少於 MIN_REGION_SIZE。
  // ============================================================
  function repairUniqueness(
    owner,
    n,
    catCols,
    rng,
    maxIters = 400
  ) {
    const masks =
      buildRegionMasks(
        owner,
        n
      );

    const sizes =
      getRegionSizes(
        owner,
        n
      );

    const dirs = [
      0,
      1,
      2,
      3
    ];

    for (
      let iter = 0;
      iter < maxIters;
      iter++
    ) {
      const alt =
        findAlternate(
          owner,
          n,
          catCols
        );

      // 找不到另一組解
      // 代表已經是唯一解
      if (!alt) {
        return true;
      }

      const diffRows = [];

      for (
        let r = 0;
        r < n;
        r++
      ) {
        if (
          alt[r] !==
          catCols[r]
        ) {
          diffRows.push(r);
        }
      }

      shuffle(
        diffRows,
        rng
      );

      let moved = false;

      for (
        const row of diffRows
      ) {
        if (moved) break;

        const c =
          alt[row];

        if (
          c ===
          catCols[row]
        ) {
          continue;
        }

        const p =
          idx(
            n,
            row,
            c
          );

        const oldRegion =
          owner[p];

        // 不允許把 2 格區域再削成 1 格
        if (
          sizes[oldRegion] <=
          MIN_REGION_SIZE
        ) {
          continue;
        }

        let usedBefore = 0;

        for (
          let r2 = 0;
          r2 < row;
          r2++
        ) {
          usedBefore |=
            1 <<
            owner[
              idx(
                n,
                r2,
                alt[r2]
              )
            ];
        }

        const candidates = [];
        const seen = new Set();

        for (
          let d = 0;
          d < 4;
          d++
        ) {
          const nr =
            row + DR[d];

          const nc =
            c + DC[d];

          if (
            nr < 0 ||
            nr >= n ||
            nc < 0 ||
            nc >= n
          ) {
            continue;
          }

          const region =
            owner[
              idx(
                n,
                nr,
                nc
              )
            ];

          if (
            region !== oldRegion &&
            !seen.has(region)
          ) {
            seen.add(region);
            candidates.push(region);
          }
        }

        if (
          !candidates.length
        ) {
          continue;
        }

        const preferred =
          candidates.filter(
            (region) =>
              (
                usedBefore &
                (1 << region)
              ) !== 0
          );

        const pool =
          preferred.length
            ? preferred
            : candidates;

        const newRegion =
          pool[
            randomInt(
              rng,
              pool.length
            )
          ];

        // 先暫時移除
        masks[
          oldRegion
        ][row] &=
          ~(1 << c);

        // 原區域必須仍然連通
        if (
          !isConnectedMask(
            masks[oldRegion],
            n,
            oldRegion,
            catCols[oldRegion]
          )
        ) {
          masks[
            oldRegion
          ][row] |=
            1 << c;

          continue;
        }

        // 加入新區域
        masks[
          newRegion
        ][row] |=
          1 << c;

        owner[p] =
          newRegion;

        sizes[
          oldRegion
        ]--;

        sizes[
          newRegion
        ]++;

        moved = true;
      }

      // 如果針對 alternate 的修正找不到可移動格，
      // 再做一次隨機邊界調整
      if (!moved) {
        const r =
          randomInt(
            rng,
            n
          );

        const c =
          randomInt(
            rng,
            n
          );

        // 不能移動答案貓格
        if (
          c ===
          catCols[r]
        ) {
          continue;
        }

        const p =
          idx(n, r, c);

        const oldRegion =
          owner[p];

        if (
          sizes[oldRegion] <=
          MIN_REGION_SIZE
        ) {
          continue;
        }

        shuffle(dirs, rng);

        for (
          const d of dirs
        ) {
          const nr =
            r + DR[d];

          const nc =
            c + DC[d];

          if (
            nr < 0 ||
            nr >= n ||
            nc < 0 ||
            nc >= n
          ) {
            continue;
          }

          const newRegion =
            owner[
              idx(
                n,
                nr,
                nc
              )
            ];

          if (
            newRegion ===
            oldRegion
          ) {
            continue;
          }

          masks[
            oldRegion
          ][r] &=
            ~(1 << c);

          if (
            !isConnectedMask(
              masks[oldRegion],
              n,
              oldRegion,
              catCols[
                oldRegion
              ]
            )
          ) {
            masks[
              oldRegion
            ][r] |=
              1 << c;

            continue;
          }

          masks[
            newRegion
          ][r] |=
            1 << c;

          owner[p] =
            newRegion;

          sizes[
            oldRegion
          ]--;

          sizes[
            newRegion
          ]++;

          break;
        }
      }
    }

    return (
      countSolutions(
        owner,
        n,
        2
      ) === 1
    );
  }

  // ============================================================
  // 對外的隨機關卡生成函式
  // ============================================================
  function generateRandomLevel(
    n,
    seed
  ) {
    if (
      !Number.isInteger(n) ||
      n < 6 ||
      n > 12
    ) {
      throw new Error(
        "盤面大小必須介於 6 到 12"
      );
    }

    const actualSeed =
      seed == null
        ? (
            (
              Date.now() ^
              Math.floor(
                Math.random() *
                0xffffffff
              )
            ) >>>
            0
          )
        : seed >>> 0;

    const rng =
      makeRng(
        actualSeed
      );

    // 最多重抽 100 組答案排列
    for (
      let permAttempt = 0;
      permAttempt < 100;
      permAttempt++
    ) {
      const catCols =
        randomPermNoAdj(
          n,
          rng
        );

      if (!catCols) {
        continue;
      }

      // 同一組答案最多重新長 20 次區域
      for (
        let growAttempt = 0;
        growAttempt < 20;
        growAttempt++
      ) {
        const owner =
          growRegions(
            n,
            catCols,
            rng
          );

        if (!owner) {
          continue;
        }

        // 雙重確認：
        // 理論上 growRegions 已保證至少 2 格，
        // 這裡再確認一次避免後續修改造成異常
        if (
          !hasMinimumRegionSize(
            owner,
            n
          )
        ) {
          continue;
        }

        const unique =
          countSolutions(
            owner,
            n,
            2
          ) === 1;

        const repaired =
          unique ||
          repairUniqueness(
            owner,
            n,
            catCols,
            rng
          );

        if (
          repaired &&
          hasMinimumRegionSize(
            owner,
            n
          )
        ) {
          const regions =
            Array.from(
              { length: n },
              (_, r) =>
                Array.from(
                  { length: n },
                  (_, c) =>
                    owner[
                      idx(
                        n,
                        r,
                        c
                      )
                    ]
                )
            );

          return {
            n,
            seed:
              actualSeed,
            regions,
            solution:
              catCols.slice()
          };
        }
      }
    }

    throw new Error(
      "無法在限制次數內生成唯一解關卡"
    );
  }

  const api = {
    generateRandomLevel,
    countSolutions
  };

  root.MeowdokuRandomGenerator =
    api;

  // Worker 執行模式
  if (
    typeof WorkerGlobalScope !==
      "undefined" &&
    root instanceof
      WorkerGlobalScope
  ) {
    root.onmessage =
      (event) => {
        try {
          const {
            n,
            seed
          } =
            event.data || {};

          const level =
            generateRandomLevel(
              Number(n),
              seed
            );

          root.postMessage({
            ok: true,
            level
          });
        } catch (error) {
          root.postMessage({
            ok: false,
            error:
              error?.message ||
              String(error)
          });
        }
      };
  }

  // Node.js 測試用
  if (
    typeof module !==
      "undefined" &&
    module.exports
  ) {
    module.exports =
      api;
  }
})(
  typeof globalThis !==
    "undefined"
    ? globalThis
    : self
);
