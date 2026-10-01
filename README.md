# MeowDoku Web v2.0.0

MeowDoku 2.0 的 GitHub Pages 靜態網頁版。遊戲規則、探索地圖、關卡手冊、道具、隨機關卡、分享碼、進度與貓咪動畫皆沿用 Android 2.0。

網頁版不提供 BGM、盤面上傳或離開遊戲按鈕；按鍵與貓叫音效由瀏覽器直接播放。

## 執行

線上版：<https://nanbushirou.github.io/meowdoku-webp/>

本機測試請在倉庫根目錄啟動 HTTP 伺服器，再開啟 <http://localhost:8000/>：

```sh
python -m http.server 8000
```

直接雙擊 `index.html` 會因瀏覽器限制而無法讀取關卡。

`levels/normal/`、`levels/hard/` 與 `levels/extra/` 共提供 4,200 個靜態關卡。關卡清單由 `levels_index.json` 控制，遊戲紀錄儲存在瀏覽器 `localStorage`。
