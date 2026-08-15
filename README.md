# Vibe Coding Usage

Vibe Coding Usage 是一個本地端的 AI 程式碼助手使用量統計與成本估算儀表板。它能夠自動解析 **Claude Code** 與 **Google Antigravity (Gemini)** 的本地 Log，並透過玻璃擬態 (Glassmorphism) 的美觀介面來視覺化你的 Token 消耗與花費。

## ✨ 核心功能

- **多平台 Log 解析**：
  - 支援讀取 `Claude Code` (位於 `.claude`, `.claude-personal`, `.claude-work` 等資料夾)
  - 支援讀取 `Antigravity` (位於 `.gemini/antigravity` 資料夾)
  - 具備易於擴充的架構，保留支援 `Codex` 等其他 AI 工具的擴展空間
- **極簡啟動與零設定體驗 (Zero-Config First Run)**：
  - 若首次啟動未發現 `config.json`，系統會自動根據當前作業系統 (Windows/macOS/Linux) 與終端使用者目錄，探測並載入預設的 `.claude` 與 `.gemini/antigravity` 路徑。
  - 首次開啟前端將自動彈出視覺化設定介面，確認後即可一鍵完成初始化與日誌同步。
- **視覺化設定中心 (Visual Settings Window)**：
  - 具備「搜尋設定」與「設定分類」側欄。
  - 提供寬版主設定區，包含備份路徑、資料庫路徑以及**可動態增刪修改的資料來源互動表格**（支援切換平台、設定檔名稱與路徑）。
- **視覺化儀表板**：
  - **Usage Heatmap (熱點圖)**：支援 `Daily` (過去一年) 與 `Hourly` (過去 30 天，8x3 排列) 檢視，並提供獨立的 `Tokens` / `Dollars` 切換開關與懸停詳細數據卡片。
  - **Usage Trends (趨勢圖)**：支援依照 `Type`、`Model`、`Profile`、`Project` 等維度繪製長條圖，支援獨立的 `Tokens` / `Dollars` 切換，並依模型家族自動計算彩度階層、Top 7 專案高對比色區分。
  - **Detailed Data Table (詳細表格)**：
    - **雙維度次分組展開 (Drill-Down)**：提供 `Primary Group` 與 `Detail By` 雙維度下拉選單，點擊任意資料列或展開箭頭 `▶`，即可就地展開樹狀子項目（如 By Profile 展開各 Profile 的 By Model 統計）。
    - 雙切換控制項：`Tokens / Dollars` 與 `Value / %`（可自選查看 Token 數、金額或精確至 0.01% 的佔比）。
    - 專案路徑簡稱：預設只顯示工作根目錄名稱，並提供 `Expand Path` 一鍵展開完整絕對路徑。
    - 獨立捲軸：固定顯示約 5 行資料高度，Header 與 TOTAL 列固定置頂/底不透光。
- **動態成本估算與自動爬蟲**：
  - 伺服器啟動時會自動透過 LiteLLM 的開源資料庫同步最新的 API 價格，並轉換為本地的 `pricing.json`。
- **強大過濾器**：
  - 簡潔 2-Row 佈局，支援依據時間（包含自訂小時範圍）、平台/Profile、專案、模型、類別來篩選資料（遵守「不選 = 全選」規則）。
- **自動備份機制**：
  - 伺服器啟動時，會自動備份指定的 Log 目錄至設定路徑，避免數據遺失。

## 🚀 如何啟動

### 1. 安裝依賴套件
```bash
npm install
```

### 2. 啟動伺服器
專案使用 `tsx` 與 `esbuild` 進行即時編譯與啟動：
```bash
npm run dev
```
啟動後打開瀏覽器前往：`http://localhost:3000`

> 💡 **提示**：系統具備自動探測機制，若無 `config.json`，開啟瀏覽器時會自動帶出偵測到的路徑並引導您完成首次設定；亦可點擊右上角 **⚙️ Settings** 隨時修改資料來源。

## 🛠 技術棧
- **後端**：Node.js, Express, better-sqlite3
- **前端**：Vanilla TypeScript, Chart.js, HTML/CSS (Glassmorphism UI)
- **建置工具**：esbuild, tsx

## 📁 專案結構
- `/src` - 後端 Express 伺服器與 Log 解析器 (Claude/Antigravity)。
- `/public` - 前端 HTML, CSS 與靜態資源。
- `/public/js` - 前端 TypeScript 原始碼 (UI, Charts, Filters, Table)。
- `/data` - 預設存放 SQLite 資料庫 `usage.db` 的位置。

## 📖 架構與 Agent 開發指南
詳細的系統架構、資料庫 Schema、Log Parsers 邏輯、視覺化色系規範與二次開發指南，請參閱 [ARCHITECTURE.md](ARCHITECTURE.md)。


