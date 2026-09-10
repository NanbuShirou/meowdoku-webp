# Meowdoku

GitHub Pages 版 Meowdoku。

## 目前結構

```text
meowdoku/
├─ index.html
├─ game.js
├─ random-generator.js
├─ styles.css
├─ levels_index.json
├─ themes/
│  ├─ default.css
│  ├─ cell-styles.css
│  └─ cell-style-images/
│     ├─ original.webp
│     ├─ glass.webp
│     ├─ pixel.webp
│     ├─ tile.webp
│     ├─ paper.webp
│     └─ neon.webp
├─ levels/
└─ tools/
```

## 部署方式

GitHub Pages 直接設定：
- Branch：`main`
- Folder：`/(root)`

不需要再透過 `/web/` 轉址，網站根目錄就是遊戲本體。

## 備註

- 樣式貓咪圖示已由 CSS 內嵌 Base64 改為獨立 WebP 檔案。
- `cell-styles.css` 已大幅縮小，較利於快取與維護。
