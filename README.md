# CT 牙齒判讀練習

學生遠端練習判讀牙科 CBCT 的 AI 結果（找出 AI 標錯的牙號、骨頭外框、神經管）。

- `index.html`：學生練習（不需要 Google 帳號）
- `teacher.html`：老師總覽、評分與修改、下載結果（需要老師碼）
- `review.html`：審閱版（需要老師碼，不存檔）
- `manual-student.html`、`manual-teacher.html`：說明書

這個網站只有畫面，不含任何病人資料。資料存在老師的 Google 雲端，經由 Google Apps Script 讀寫（`config.js`）。
