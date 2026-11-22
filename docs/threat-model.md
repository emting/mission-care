# Mission Care 威脅模型（提案 MVP）

**狀態：未經教會核准、非正式服務、不得使用真實宣教資料。** 依主 PRD §4 列出目前程式控制與殘餘風險；不是安全認證、法遵結論或上線批准。驗收證據見 [checklist-coverage.md](checklist-coverage.md)，尚待決策見 [pending-church-decisions.md](pending-church-decisions.md)。

## 資產、分級與信任邊界

- 保護資產：當事人身分／地點、原稿與照片、LINE subject、會友授權與互動、管理員憑證／MFA、加密金鑰、稽核與備份。
- A（public）：仍須登入；只展示經核准發布的安全摘要、代號與泛化區域，不代表全網匿名公開。受限信件仍須逐位授權。
- B（invite_only）：使用者 × 宣教士有效授權；兩名不同且非作者的審核人及當事人同意；通知僅中性文字。過期／撤銷後阻擋後續 API、媒體與候發通知。
- C（offline）：禁止儲存詳細內容，只留必要行政代號；不以技術功能取代教會獨立安全聯繫渠道。新宣教士預設未啟用、邀請制。
- 瀏覽器／LIFF／會員輸入均不可信；BFF 每次驗證會友或獨立管理員身分與即時權限。LINE 驗證、Messaging API、儲存、資料庫、執行環境及備份是各自邊界。
- PostgreSQL 使用後端憑證，不對瀏覽器開放。PGlite、模擬登入、種子帳號、自簽憑證僅供本機虛構資料試用。

## PRD §4：威脅 → 已實作控制 → 殘餘風險

| 威脅 | 已實作控制與程式位置 | 殘餘風險／正式發布前要求 |
| --- | --- | --- |
| 使用者截圖、下載、轉傳 | `policy.ts` 最小可見範圍；`ui-reads.ts` 安全投影；`ui/member.tsx` 不轉傳提醒；所有內容頁／媒體 no-store | 無法技術阻止截圖、複製、相機拍攝，也無法撤回已取得資料。需當事人同意、教育、降低內容敏感度；高風險維持 C 級不上線。 |
| 已核准帳號被盜、登入 CSRF、token 重播 | `services.ts`、`liff-auth.ts` 服務端 LINE 驗證；原 OIDC nonce 流程保留；LIFF challenge cookie＋body＋Origin、一次性消耗、新鮮 iat、ID token hash 防重播；短效雜湊 session 與安全 cookie；`security.ts` CSRF／限流 | LINE 帳號及終端裝置仍可能失陷；被竊的有效 session 在到期／撤銷前可被使用。需裝置與事件應變政策；記憶體限流不適用多實例，正式需可信邊緣／分散式限流。 |
| 內部管理員濫權、自行核准、跨範圍讀取 | `policy.ts` 預設拒絕、精確 scope、角色分離；`services.ts` 密碼＋強制 TOTP、即時啟用與任職檢查；`workflows/editorial.ts` 不可變修訂、編輯撤銷核准、非作者雙審；`governance.ts` 公開降級／奉獻異動雙人控制、高風險近期 MFA；中繼資料稽核 | 兩人串通、錯誤同意或社交工程仍可能成功。DB／主機特權者不受應用層角色保護。需核定角色名冊、獨立覆核、定期權限回顧及管理員恢復程序；金鑰同主機無法抵禦整機入侵。 |
| 公用網址爬取、猜 ID、列表／搜尋／計數推斷 | `policy.ts`、`workflows/reads.ts`、`ui-reads.ts` 與薄 route 每次授權；不可見資源 404；管理頁直接 URL 亦檢查，403；`workflows/media.ts` 私有代理；低樣本統計抑制；no-store | URL 被知悉不等於有權限，但流量特徵、時間差、已授權內容間交叉比對仍有推斷風險。無宣稱抗所有側通道；需部署快取／代理測試與侵入性安全測試。 |
| 伺服器金鑰或 session 資料外洩 | `security.ts` AES-256-GCM；`LINE_SUBJECT_ENC_KEY` 與一般加密金鑰分離、保留 subject hash 供查找；只有發送 worker 解密 LINE subject；session 僅存 hash；`governance.ts` lockdown 可降低可見性／撤 session；CI gitleaks | 加密不是對主機／金鑰同時失陷的保護。金鑰管理、最小權限 DB 帳號、輪替、稽核外存及復原演練尚未驗證；secret scanner 非萬能，疑似外洩必須撤銷／輪替而非只刪檔。 |
| 照片 EXIF 或背景洩漏地點 | `storage.ts` 限型別／大小、sharp 解碼重編碼移除 EXIF；照片政策、修訂綁定及媒體審核；私有儲存不在 public；`workflows/media.ts` 每次讀取重查權限 | 文字、服裝、地標、臉孔仍可識別；重編碼不等於完整惡意檔掃描。無專用防毒服務，也無背景辨識安全保證；需人工視覺檢查、解碼器更新、資源限制與正式惡意檔防護。 |
| 文件原檔隱藏資訊 | 媒體只收 jpeg/png/webp 並重編碼；拒絕 PDF 等文件；原稿與修訂加密保存、只交同 scope 有權編輯／審核角色 | 貼上文字可能含個資、暗示或隱藏字元。需人工來源清理、同意與保留期限執行；不得把不支援的原文件另放公用目錄規避限制。 |
| 生成式 AI 反推身分、地點／prompt injection | `ai.ts` 確定性敏感資訊掃描、zod 輸出驗證、預設本機 provider；invite_only／高風險禁止送外部 provider；AI 僅產草稿，沒有自動發布；核准綁定修訂 | 掃描可漏判／誤判，模型可從普通內容推斷敏感資訊；本機建議不代表匿名化完成。需人工逐篇審核；任何外部模型啟用須另核定授權、資料處理契約與跨境政策。 |
| 推播預覽畫面曝光、撤權後仍發送 | `workflows/delivery.ts` 限定內容只發「有新的關懷消息」；發送時重查發布狀態、授權、opt-in、好友／封鎖、暫停與配額；撤稿／撤權取消候發工作；固定 retry key；預設全域暫停、月配額零 | 中性通知仍暴露平台使用／訊息時間；已送到 LINE 或裝置的預覽無法撤回。API 接受不代表實際收到；正在外部傳輸的訊息不能保證追回。需真實 LINE／裝置測試、正式 OA 所有權及通知政策。 |
| 備份與日誌洩漏、保留過久 | `workflows/core.ts` 中繼資料稽核，不含原稿／token／完整 subject；錯誤僅安全碼＋request_id；原稿保留期限欄位；刪除申請立即停用存取並建立保留審查期限；`.gitignore` 排除本機資料／憑證／環境檔 | 稽核事件仍是敏感中繼資料；應用層記錄不能保證主機／代理／APM 不外洩。沒有聲稱已完成排程清除、備份實體刪除、外存不可竄改或備份還原。需教會核定保留、委外、位置、刪除證據與事故窗口。 |
| 外部 AI 跨境傳輸 | 預設不呼叫外部 AI；provider 邊界及 restricted／high-risk 拒送測試；UI 明示需人工審稿；lockdown 可停用 AI import | 供應商、資料位置、跨境法律依據與契約均未核准。日後設定外部 provider 不等於取得授權；非受限且掃描未標記也不代表安全，須另外審查。 |

## 驗證與發布限制

`tests/security.test.ts`、`policy.test.ts`、`editorial.test.ts`、`ai-media.test.ts`、`delivery-members.test.ts`、`governance-reads.test.ts`、`liff.test.ts`、`ui.test.ts` 涵蓋服務／route 的可測邊界；本機 Chromium 截圖及互動檢查見 README。CI 使用 Node 22、相同 SQL migrations 的 PGlite 測試及正式建置；gitleaks 掃描 Git 變更，禁止把開發憑證或原稿當成例外放行。第三方 Actions 固定 commit、工作權限僅讀取，不使用 `pull_request_target`，不向 PR 提供正式憑證。

CI 通過不代表教會批准、安全認證或完整 PRD 驗收。真實 LINE、部署快取、金鑰輪替、災難復原、刪除履行、WCAG／螢幕閱讀器、專業安全與法務審查仍是待辦。套件／Action 及供應鏈本身亦須持續追蹤；gitleaks 使用固定版本、驗證 release checksum 的開源 CLI 掃描完整 Git 歷史，不使用需組織授權金鑰的 Action 包裝器。
