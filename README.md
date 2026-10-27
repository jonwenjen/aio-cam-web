# AIO Cam Web

一個在瀏覽器裡跑的底片風格修圖 App（PWA）：匯入 iPhone 照片 → 一鍵自動調整並推薦發色 → 存成保留 HDR、Display P3 與 EXIF 的 JPEG。iPhone 18 Pro Max 體驗最好，其他手機與桌機瀏覽器也能用。

**線上使用：** https://jonwenjen.github.io/aio-cam-web/ （在 iPhone Safari 開啟後「分享 → 加入主畫面」，可離線使用）

## 隱私承諾

- 照片全部在你的裝置上處理，**不上傳任何資料**。
- 沒有任何分析或追蹤程式。
- 存檔前可選「保留全部／去除位置／去除全部」中繼資料。

## 目前進度

M1（核心引擎與暗房最小版）：WebGPU／WebGL2／CPU 三條一致的算圖路徑、7 組暫定發色、自動調整與發色推薦、JPEG HDR 增益圖保留、輸出隱私開關、5 種語系架構、PWA 離線。

## 本機開發

純 HTML／CSS／ES modules，沒有建置工具。需要 Node 22 以上、macOS（瀏覽器與 e2e 測試用 Apple ImageIO 量測 HDR）、Google Chrome、`exiftool`。

```bash
npm install                 # 只有測試用的 devDependency
tools/build-tools.sh        # 編譯 Swift 量測工具到 tools/bin/
tools/fetch-fixtures.sh     # 下載測試圖（Kodak、S20 用的 iPhone 實拍，後者只放本機）
npm run serve               # http://localhost:5173/  （加 ?debug=1 顯示除錯面板；?sw=1 啟用離線快取）
```

## 測試

```bash
npm test                    # 單元測試（CI 也跑這個）
npm run test:browser        # 無頭 Chrome：每頁跑「有 WebGPU」與「沒有 WebGPU」兩次
npm run test:e2e            # 真的介面匯出 → exiftool 與 Apple ImageIO 驗證 HDR、EXIF、隱私
npm run check               # 品牌名稱檢查＋以上全部
```

瀏覽器與 e2e 測試需要 macOS 的 GPU 與 Swift 工具，只在本機執行；GitHub Actions 只跑品牌檢查與單元測試。

## 文件

| 文件 | 內容 |
|---|---|
| [設計規格](docs/superpowers/specs/2026-10-26-aio-cam-web-design.md) | 功能、架構、發色與濾鏡、自動推薦、驗收標準、10 個里程碑 |
| [M1 實作計畫](docs/superpowers/plans/2026-10-27-m1-core.md) | 第一階段的逐步實作計畫 |
| [發色與推薦規則](docs/looks.md) | 7 組發色的起始參數與推薦規則表 |
| [第三方授權](docs/licenses.md) | 測試素材與開發工具的授權 |
| [在 Claude Code 執行](docs/superpowers/plans/RUN-IN-CLAUDE.md) | 怎麼讓 Claude Code 照計畫實作 |
| [計畫索引](docs/superpowers/plans/README.md) | 各里程碑計畫狀態 |
