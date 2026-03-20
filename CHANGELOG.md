# 系統版本控制紀錄 (Changelog)

這裡記錄了本系統所有的版本更新與功能變更。

## [Release 3.3.1] - 2026-03-20

### 🐛 問題修正 (Bug Fixes)
- **修復 YouTube 爬蟲解析崩潰**：當頻道發布「Shorts 短影音」或「即將首播」時，因 YouTube 回傳資料格式改變，導致 `TypeError: Cannot read properties of undefined (reading 'title')` 的問題。已加入嚴格的型別安全判斷，自動過濾非正規影片。

### 🛡️ 資安架構升級 (Security Upgrade)
- **防禦惡意機器人掃描 (URIError 攔截)**：新增全域錯誤攔截器，防禦網路上惡意機器人盲目掃描漏洞（如 `/cgi-bin/%%32%65...`）導致 Express 框架解析報錯。現在遇到惡意請求會直接靜默丟棄並回傳 `400 Bad Request`，大幅減少 Cloud Logging 產生大量無效 Log 的監控費用。

## [Release 3.3.0] - 2026-03-16

### ✨ 新增功能 (Added)
- **自動生成 AI 摘要並寄送**：大幅優化了 CronJob 的運作邏輯。現在系統在背景偵測到新影片時，會**直接在後端呼叫 Gemini API 產生重點摘要**，並將完整的分析結果直接包含在通知信件中寄給使用者。使用者不再需要點擊連結回到網站等待生成，體驗更加絲滑且主動。
- **後端摘要快取**：CronJob 生成的摘要會自動存入 Firebase 資料庫中。當使用者後續進入 Web 介面點擊該影片時，系統會直接讀取快取，秒速顯示結果，節省 API 呼叫成本與等待時間。

## [Release 3.2.2] - 2026-03-12

### 🛡️ 資安架構升級 (Security Upgrade)
- **Firebase 憑證安全掛載**：移除 `Dockerfile` 中將 `firebase-applet-config.json` 寫死打包進 Image 的不安全做法。改用 Kubernetes 企業級標準的 **Secret Volume Mount** 機制。現在 Firebase 設定檔會作為 K8s Secret 獨立管理，並在 Pod 啟動時動態掛載至 `/app/firebase-applet-config.json`。這確保了即使 Docker Hub 映像檔外流，也不會洩漏任何資料庫存取憑證。

## [Release 3.2.1] - 2026-03-12

### 🐛 問題修正 (Bug Fixes)
- **修復 GKE 部署遺失 Firebase 設定檔問題**：修正了 `Dockerfile` 在生產環境打包階段（Production Stage）遺漏複製 `firebase-applet-config.json` 的問題。這導致 GKE 上的容器啟動時無法初始化 Firebase，進而造成 `/api/summary` 快取 API 失效，迫使系統每次都重新呼叫 Gemini 進行分析。現在設定檔已正確打包進映像檔，快取功能恢復正常。

## [Release 3.2.0] - 2026-03-12

### 🚀 系統與部署優化 (System & Deployment)
- **字幕抓取強化 (Auto-generated CC)**：大幅強化 `youtube-transcript` 的抓取邏輯。現在系統會依序嘗試抓取 `zh-TW`、`zh-Hant`、`zh` 等多種語言代碼，若皆失敗，則會自動退而求其次抓取 YouTube 的「自動生成字幕 (Auto-generated CC)」，大幅降低因語言代碼不符而抓不到字幕的機率。
- **Gemini 雙重備用方案 (urlContext + googleSearch)**：當影片完全沒有字幕（或剛直播完尚未生成）時，系統不再直接報錯。現在會啟動強大的備用方案，將 YouTube 網址直接餵給 Gemini (`urlContext`) 讀取網頁隱藏資訊，並搭配 Google 搜尋 (`googleSearch`) 補充最新財經時事，拼湊出高準確度的摘要。
- **明確的免責聲明**：當系統啟用備用方案時，會在摘要最上方顯示明確的警告標語：「⚠️ **系統提示：以下內容為GEMINI透過解析 YouTube (urlContext) 與(googleSearch)生成僅供參考**」，避免使用者將 AI 推測的內容誤認為講者的原意。
- **未來架構規劃 (Roadmap)**：確認了未來若要追求 100% 準確率的終極解法，需採用「地端 yt-dlp 下載音檔 ➡️ 地端 Whisper 轉文字 ➡️ Gemini API 摘要」的架構，目前 V1 版本先以雲端高性價比方案上線。

## [Release 3.1.0] - 2026-03-12

### 🚀 系統與部署優化 (System & Deployment)
- **嚴格財經資訊準確性**：移除無字幕影片的 Google Search 備用方案。為確保財經資訊的 100% 準確性，系統現在嚴格限制 AI 僅能基於真實影片逐字稿進行總結，避免 AI 產生幻覺或拼湊網路資訊。
- **優雅降級錯誤處理**：優化後端字幕抓取錯誤處理，當影片未提供字幕或作者關閉字幕功能時，不再觸發 500 系統錯誤，而是改為優雅降級處理，並在畫面上明確告知使用者無法進行 AI 分析。

### 🐛 問題修正 (Bug Fixes)
- **首頁導覽修復**：修復了在摘要頁面點擊下方「首頁」標籤或上方 Logo 時，畫面不會正確返回影片列表（需重新整理）的問題。現在點擊後會自動清除摘要狀態並順暢返回首頁。

## [Release 3.0.3] - 2026-03-12

### 🚀 系統與部署優化 (System & Deployment)
- **修復分析無限轉圈問題**：為所有外部 API 請求（包含 YouTube 逐字稿抓取、Firebase 資料庫讀寫、YouTube 頻道最新影片抓取）加入了嚴格的 **10 秒 Timeout 機制**。解決了當外部服務（如 YouTube 或 Firebase）無回應時，前端畫面會無限轉圈 (Spinning) 且不會報錯的問題。現在如果抓不到逐字稿，系統會自動在 10 秒後切換為 Google Search 模式進行分析。
- **清除快取說明**：確認系統中已無寫死的舊信箱 (`rose.huang@gmail.com`)，該信箱僅存在於使用者的瀏覽器 `localStorage` 中。

## [Release 3.0.2] - 2026-03-12

### 🚀 系統與部署優化 (System & Deployment)
- **強制拉取最新映像檔 (Image Pull Policy)**：在 `gke/deployment.yaml` 中明確加入 `imagePullPolicy: Always`。即使 Docker Hub CDN 快取了標籤，Kubernetes 每次啟動 Pod 時都會強制向遠端檢查並拉取最新的 Image，徹底解決雲端更新被擋住的問題。
- **重啟指令更新**：在 `README.md` 中補充了 `kubectl rollout restart` 指令，方便在不改版號的情況下強制重新拉取映像檔。

## [Release 3.0.1] - 2026-03-12

### 🚀 系統與部署優化 (System & Deployment)
- **版號更新與 CDN 快取修復**：更新系統版號至 `3.0.1`，並強制使用明確的版號標籤 (Tag) 進行部署。這是為了解決 Docker Hub CDN 機制可能會快取 `latest` 標籤，導致 Kubernetes 節點拉取到舊版 Image 的問題。
- **文件更新**：更新 `README.md`，詳細說明 Docker Hub CDN 快取問題及正確的上版流程。

## [Release 3.0.0] - 2026-03-12

### 🚀 雲端架構大升級 (迎接新生)
- **資料庫全面雲端化**：徹底移除本地端的 SQLite 資料庫，全面升級為 **Firebase Firestore**。這是一次「不可逆」的重大架構演進，讓系統正式具備「無狀態 (Stateless)」特性。
- **支援 GKE 橫向擴展 (Scale-out)**：解決了過去多個 Pod 實例無法共享快取的問題。現在無論 GKE 開出多少台機器，所有實例都會連線到同一個 Firestore 雲端資料庫，確保資料完全同步。
- **無縫接軌開發與正式環境**：你在 AI Studio 測試時產生的 AI 摘要，上線到 GKE 後可以直接共用，不再浪費 Gemini API Token。

### ✨ 新增功能 (Added)
- 導入 Firebase SDK (`firebase/app`, `firebase/auth`, `firebase/firestore`)。
- 實作 Firebase 匿名登入 (Anonymous Auth)，確保伺服器端能安全且合法地存取資料庫。
- 新增嚴格的 `firestore.rules` 安全規則，確保寫入的資料格式正確且安全。
- 新增 `firebase-blueprint.json` 靜態定義資料庫結構 (Schema)。

### 🗑️ 移除項目 (Removed)
- 徹底移除了所有 SQLite 相關套件 (`sqlite3`, `sqlite`, `better-sqlite3`)，大幅減輕了 Node.js 映像檔體積與原生編譯的負擔。

## [Release 2.3.c4d5e6f] - 2026-03-12

### 🚀 系統與排程優化 (System & CronJob)
- **AI 模型降級降本**：將分析模型從昂貴的 `gemini-3.1-pro-preview` 降級為 `gemini-3-flash-preview`，大幅降低 API 呼叫成本。
- **GKE CronJob 修復與補齊**：修正了 `gke/cronjob.yaml` 中呼叫 API 的 `channelId` 參數（改為對應新的 `gooaye_videos` 等 ID），並補上了郭哲榮分析師每天 18:00 的影片與直播排程設定。
- **內部定時任務恢復**：確認並恢復了 `server.ts` 中每 30 分鐘執行一次的內部檢查機制，確保 SQLite 正常記錄最新影片狀態，防止重複發送通知。

### 💅 設定調整 (Changed)
- **通知信箱更新**：從 `server.ts`、`.env.example` 及 `gke/configmap.yaml` 中移除了 `rose.huang@gmail.com`，目前系統僅會發送通知至主要信箱。

## [Release 2.2.b7c8d9e] - 2026-03-11

### 🚀 新增功能 (Added)
- **前端驗證系統 (取代 Basic Auth)**：實作了全新的「長輩友善」密碼鎖畫面，解決了手機內建瀏覽器（如 LINE）無法彈出原生 Basic Auth 視窗的問題。
- **自動登入記憶**：密碼驗證成功後會自動儲存於手機的 `localStorage`，未來開啟網頁不再需要重新輸入密碼。

### 💅 介面調整 (Changed)
- **手機端輸入優化**：密碼輸入框設定為 `type="tel"`，在手機上點擊時會自動彈出「數字鍵盤」，大幅提升長輩輸入密碼的便利性。

## [Release 2.1.a8f9e2b] - 2026-03-11

### 🚀 新增功能 (Added)
- **版本控制系統**：新增 `CHANGELOG.md` 檔案來追蹤版本變更，並在設定頁面底部顯示當前版號 (`Release 2.1.a8f9e2b`)。
- **新頻道支援**：新增「郭哲榮分析師-摩爾證券投顧」頻道，並細分為「影片」與「直播」兩種來源。

### 💅 介面調整 (Changed)
- **長輩友善 UI 大改版**：全面放大字體與按鈕，實作 RWD 與 App-like 底部導覽列。
- **版面高度最佳化 (本次修復)**：大幅縮減了首頁各元件的垂直間距（包含標題列高度、頻道選擇按鈕間距、圖示與文字間距）。解決了在電腦端或部分螢幕上，需要將網頁縮放至 90% 才能看到「聽最新一集」執行按鈕的問題。現在按鈕會完美顯示在第一屏的畫面中，無需額外滾動或縮放。
