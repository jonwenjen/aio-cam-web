# AIO Cam Web — 設計規格

- 日期：2026-10-26
- 狀態：草稿，待使用者審閱
- 參考對象：iOS App「AIO Camera – All in one 各牌相機」（Pei Chung Wang，v5.1.0）
- 實測依據：`jonwenjen/aio-cam-spike`（commit `c3f9996`），三輪 iPhone 18 Pro Max 實機數據，摘要見附錄 A

---

## 1. 目標

做一個**網頁版、免安裝、不上傳**的「多品牌風格」相機與暗房：

- 以 **iPhone 18 Pro Max 體驗最好**為設計目標；其他支援 WebGPU 或 WebGL2 的手機也能用，只是功能會依裝置能力逐步降級。
- 比原版 AIO Camera 更好的地方：
  - 匯入照片時保留 **48MP 全尺寸、HDR、P3 廣色域，以及完整 EXIF（GPS、時間、鏡頭）**；
  - 配方可以自訂，也能用網址分享；
  - 跨平台；
  - 免費。

### 1.1 不做的事

- 不做帳號、雲端、伺服器端處理；照片永遠不離開裝置。
- 不做 App Store 原生 App。
- 不使用任何相機品牌名稱或商標。風格以自有名稱命名，只描述調性。
- v1 不做影片、RAW 真實顯影、HEIC 增益圖、批次處理（排程見 §4.2）。

### 1.2 成功標準（v1 驗收條件，全部可量測）

| # | 標準 | 量測方式 |
|---|---|---|
| S1 | 18 Pro Max 匯入 48MP 照片 → 套風格 → 存檔，**≤ 2.0 秒**（從按下「存檔」到出現分享面板） | App 內計時寫入除錯紀錄 |
| S2 | 「最相容」格式的 JPEG 原圖有 HDR 時，輸出的 HDR 峰值與原圖相差 **≤ 5%**；超過一般白色的像素比例相差 **≤ 3 個百分點**（不套風格的「原樣」模式下） | 把檔案 AirDrop 到 Mac，用 `tools/hdrmeasure`（Apple CoreImage）量測 |
| S3 | 輸出檔保留原圖 EXIF 的拍攝時間、時區、GPS、機型、鏡頭、光圈、焦段，數值完全一致 | `exiftool` 比對原圖與輸出 |
| S4 | 輸出帶 Display P3 色彩描述檔；P3 純綠 (0,1,0) 處理後再讀回，誤差 ≤ 1/255 | 自動測試 |
| S5 | 即時相機預覽套風格 **≥ 30 fps**（等於相機本身的幀率），開啟後第 2 秒起最慢單幀 ≤ 50 ms（首幀不計，實測首幀 129 ms） | App 內計時 |
| S6 | WebGPU 與 WebGL2 兩條路徑的輸出，相對於 CPU 參考實作：**ΔE2000 平均 ≤ 0.5、最大 ≤ 2.0**（10 張固定測試圖） | 自動測試，見 §13 |
| S7 | 不支援 WebGPU 的瀏覽器（WebGL2 退回路徑）功能完整、無錯誤 | 無頭 Chrome 關閉 WebGPU 跑完整流程 |

---

## 2. 使用者與情境

- **隨手拍**：打開 App 直接是即時相機，左右滑動切換風格、按快門。12MP，畫面所見即輸出。
- **認真拍**：用原生相機拍 48MP / ProRAW / HDR，再到「暗房」匯入，挑風格、微調、存回相簿。原始資訊全部保留。
- **分享配方**：把自己調的配方變成一串網址或 QR code，朋友點開或掃描就能套用。

---

## 3. 平台事實（實測，非推測）

以下數據全部來自 iPhone 18 Pro Max / iOS 27.0.1 / Safari 實機測試。這些事實決定了本規格的設計方向。

| 主題 | 事實 | 設計結論 |
|---|---|---|
| 解碼 | `createImageBitmap` 可解 48.8MP 的 JPEG、HEIC、DNG，耗時 250–500 ms | 不需要自己寫解碼器 |
| 精度 | 所有格式解碼後都只有 **8-bit**；DNG 解出來的是內嵌的 8-bit 全尺寸預覽圖 | 處理鏈用 float16 避免累積誤差，但輸入只有 8-bit |
| 畫布 | 2D 畫布到 48.8MP 都正常；同時開 7–10 張 48MP 畫布不會崩潰 | 不需要切塊處理 |
| WebGPU | 支援 `shader-f16`、`float32-filterable`；`maxBufferSize` 1 GiB；48MP 單次逐像素處理約 5–7 ms | 主引擎用 WebGPU |
| WebGPU HDR 顯示 | 畫布設定 `rgba16float` + `display-p3` + `toneMapping: extended` 有效，使用者目視確認比一般白更亮 | 預覽可以顯示 HDR |
| WebGL2 | 可設定輸出色域 `drawingBufferColorSpace=display-p3`；不支援 float16 畫布 | 作為退回路徑，只顯示 SDR |
| 色域 | 2D 畫布支援 `colorSpace:'display-p3'`；輸出的 JPEG 帶 Display P3 描述檔，讀回誤差 1/255 | 整條處理鏈用 P3 |
| 編碼 | `toBlob` 支援 JPEG、PNG、**HEIC、AVIF**；不支援 WebP、JXL | v1 輸出 JPEG；HEIC、AVIF 列為選項（見 §7.4） |
| HDR（JPEG） | 「最相容」格式的 JPEG 含 MPF 第二張圖（增益圖 2856×2142，單通道），同時有 Apple 和 ISO 21496 兩種 HDR 資料 | 可以保留，做法見 §7.3 |
| HDR 保留 | **增益圖原樣複製**（B 法）：峰值 2.56，原圖 2.58 ✅。**增益圖交給瀏覽器解碼再重新編碼**（A 法）：峰值 3.12 ❌ 失真 | 禁止交給瀏覽器解碼增益圖 |
| HDR（HEIC） | 選照片時拿到的是原始 HEIC 檔，增益圖在檔案裡；但瀏覽器解碼時把它丟掉 | v1 輸出 SDR 並提示；v1.x 自己解析 HEIC |
| EXIF | 從「照片圖庫」選取時，GPS、時間、時區、鏡頭、光圈全部保留；用頁面內的 `capture` 現拍則全部被拿掉 | 匯入一律走圖庫；不提供 `capture` 現拍按鈕 |
| 即時相機 | 虛擬三鏡頭 3024×4032 @30fps，GPU 繪製 58 fps；zoom 0.5–10、torch、whiteBalanceMode 有效 | 見 §6 |
| 即時相機限制 | exposure、ISO、focus、色溫、測光點的設定都不會報錯，**但被 Safari 忽略**（不在 supportedConstraints 裡） | 不提供這些控制；改用數位曝光補償 |
| takePhoto | 12MP，耗時 1.2 秒 | 快門改用「從預覽畫面擷取一幀」（立即、同為 12MP） |
| 前鏡頭 | 3672×4032（約 14.8MP） | |
| 畫面更新率 | `requestAnimationFrame` 上限 60 Hz | 動畫預算用 16.7 ms |
| 分享 | `navigator.share({files})` 一次可傳多個檔案，可存回照片 App 或 AirDrop | 存檔方式 |

---

## 4. 功能範圍

### 4.1 v1（本規格的實作範圍）

**即時相機**
- WebGPU 即時預覽，套用目前選擇的風格。
- 鏡頭倍率鍵：0.5 / 1 / 2 / 4 / 8×，另可雙指連續縮放。
- 閃光燈（手電筒）、白平衡鎖定、數位曝光補償 ±2 EV、點一下畫面以該處為測光區域。
- 格線、水平儀（DeviceOrientation）、倒數 3/10 秒、畫面比例 4:3 / 3:2 / 1:1 / 16:9。
- 前後鏡頭切換。
- 輸出：12MP P3 JPEG，寫入 EXIF：拍攝時間、時區、GPS（使用者授權時）、Software=AIO Cam Web、所用風格與配方。

**暗房（匯入）**
- 從照片圖庫匯入單張 JPEG / HEIC / DNG，全尺寸處理。
- 7 種風格、色彩 × 色調二維調整盤、底片顆粒、暗角，以及強度滑桿。
- 按住畫面看原圖（前後對比）。
- 存檔：JPEG，保留 EXIF；若原圖是含增益圖的 JPEG 則保留 HDR。

**風格與配方**
- 7 種內建風格（§8.2）。
- 自訂配方：以內建風格為基礎微調，存在 IndexedDB。
- 配方網址分享，掃描或點開即可套用。

**基礎**
- PWA：可加入主畫面、離線可用。
- 裝置能力偵測與降級（§9）。

### 4.2 之後的版本

| 版本 | 內容 |
|---|---|
| v1.1 | 14 種濾鏡（CCD、玩具、Lo-fi…）、邊框、底片日期戳、文字；裁切與旋轉；暗房 HDR 預覽（以上涉及增益圖的部分需先通過 §7.3.3 的驗證） |
| v1.2 | HEIC 增益圖解析 → 輸出 HDR JPEG；HEIC / AVIF 輸出選項 |
| v1.3 | Snap 模式（拍後依場景自動選配方，在裝置上計算）、批次處理、匯入 `.cube` LUT |
| v2 | ProRAW 真實顯影（JS 解 10-bit 無損 JPEG 小區塊 + DNG 色彩管線）、多幀夜景堆疊、保留單一色彩 / 保留主角（GPU 分割模型） |

---

## 5. 架構

### 5.1 技術選擇

- **純 ES modules，不需建置工具**，部署到 GitHub Pages。理由：與使用者其他專案一致，沒有建置步驟，也能直接在手機上除錯。
- 不用前端框架；介面元件很少，用原生 DOM 加一個很小的狀態管理。
- 第三方相依：**無**。QR code 產生器自寫（約 300 行），或 vendored 一份 MIT 授權的單檔版本。

### 5.2 檔案結構

```
aio-cam-web/
  index.html            介面骨架（相機 / 暗房兩個畫面）
  manifest.webmanifest
  sw.js                 Service Worker：離線快取（cache-first，版本號控制）
  css/app.css
  js/
    main.js             啟動、路由、全域狀態
    device.js           能力偵測 → DeviceProfile
    ui/                 camera-view.js, darkroom-view.js, look-strip.js, pad.js, sheet.js
    capture/camera.js   getUserMedia、zoom/torch/WB、擷取一幀
    io/
      jpeg.js           JPEG 區段 / MPF / ICC 解析與重組（來自實測程式，加上測試）
      exif.js           EXIF 讀取；為即時拍攝產生 EXIF
      heif.js           (v1.2) HEIC box 解析、取出增益圖
      import.js         檔案 → SourceImage（像素 + 中繼資料 + 增益圖位元組）
      export.js         處理結果 → 檔案（編碼、轉回儲存方向、重組、分享）
    engine/
      engine.js         統一介面：render(source, recipe, target)
      webgpu.js         WebGPU 實作（主路徑）
      webgl2.js         WebGL2 實作（退回路徑）
      shaders/          WGSL 與 GLSL，兩者共用同一份參數定義
      cpu-ref.js        CPU 參考實作（只給測試用，不打包進 App）
    looks/
      recipe.js         配方資料模型、驗證、網址編碼與解碼
      builtin.js        7 種內建風格
      lut.js            由配方產生 33³ 3D LUT
    store/db.js         IndexedDB：自訂配方、設定
  tools/
    hdrmeasure.swift    Mac 端 HDR 量測（CoreImage）
    gmcheck.swift       Mac 端增益圖檢查（ImageIO）
  test/                 node --test 單元測試 + 無頭 Chrome 影像測試
  docs/
```

### 5.3 單元邊界

| 單元 | 輸入 → 輸出 | 不負責 |
|---|---|---|
| `io/import` | `File` → `SourceImage { bitmap, storedSize, orientation, exif(bytes+parsed), icc, gainMap?(原始位元組), kind }` | 色彩處理 |
| `looks/*` | 配方 JSON → `RenderParams`（uniform 數值 + LUT 資料） | GPU |
| `engine/*` | `(bitmap or video, RenderParams, target)` → 像素結果（畫布或 ImageBitmap） | 檔案格式、中繼資料 |
| `io/export` | `(處理後的畫布, SourceImage, 輸出選項)` → `File[]` | 色彩處理 |
| `capture/camera` | 相機約束條件 → `HTMLVideoElement` + 控制方法 | 套風格 |

`engine` 不認識檔案，`io` 不認識 GPU。風格在預覽和輸出時呼叫同一個 `engine.render`，只差輸出解析度，**保證所見即所得**。

---

## 6. 即時相機

- **開啟**：`getUserMedia({video:{facingMode:'environment', width:{ideal:4032}, height:{ideal:3024}}})`。實測得到 3024×4032 @30fps 的虛擬三鏡頭。
- **倍率鍵**：直接把 `zoom` 設為 0.5/1/2/4/8，由 iOS 自動切換實體鏡頭。調整時**不可**同時帶入 width/height 約束，否則會出錯（實測已知的坑）。
- **預覽**：每次 `requestVideoFrameCallback` → 把畫面導入 WebGPU（`importExternalTexture`）→ 套風格 → 顯示在畫布上。預覽解析度 = 螢幕像素（1320×2868），不是 12MP，以節省 GPU。
- **快門**：按下時把 `<video>` 當下影格複製成一張 3024×4032 的獨立紋理（`copyExternalImageToTexture`），再用全解析度跑一次 `engine.render` → 匯出。**不用** `takePhoto`（實測要 1.2 秒）。
- **數位曝光補償 / 測光點**：在 shader 的線性空間乘上 2^EV。點擊畫面時，以點擊處 9% 面積的平均亮度推算 EV，使該區趨近 18% 灰。這是軟體做法，不控制硬體曝光，介面上會寫明「數位」。
- **白平衡鎖定**：切換 `whiteBalanceMode: manual/continuous`（硬體）。
- **權限與錯誤**：拒絕權限時顯示引導畫面，並保留「改用暗房」入口。相機被其他 App 占用或開啟失敗時，重試一次（第一輪實測曾在開啟時崩潰一次）。
- **相機 → 存檔**：即時拍攝沒有增益圖，輸出 SDR。

---

## 7. 匯入與輸出管線

### 7.1 匯入

1. `<input type=file accept="image/*">`（不加 `capture`）。
2. 讀取檔頭判斷格式：JPEG / HEIC / DNG。
3. 讀取中繼資料：
   - JPEG：APP1 EXIF、ICC、MPF、增益圖位元組範圍；
   - HEIC / DNG：掃描 TIFF 區塊取得 EXIF，原始位元組保留，供之後寫入。
4. `createImageBitmap(file)` 解碼，取得已轉正的像素。
5. 記錄 `storedSize`（JPEG SOF 尺寸）與 `orientation`，供輸出時轉回儲存方向。

### 7.2 色彩管線

```
8-bit P3 (sRGB 轉換曲線) ──解碼──▶ float16 線性 P3
  → 曝光 / 白平衡偏移
  → 3D LUT（33³，風格本體，在對數編碼空間取樣）
  → 色彩 × 色調調整盤
  → 膚色保護（v1.1）
  → 暗角
  → 顆粒（依輸出解析度縮放顆粒大小，48MP 與預覽觀感一致）
  → 編回 P3 sRGB 轉換曲線 8-bit
```

- 工作色域固定為 Display P3；輸入如果是 sRGB，就先轉成 P3。
- 顆粒用確定性雜訊（以座標雜湊產生），同一張圖、同一組參數，輸出位元完全相同，方便測試。

### 7.3 HDR 保留

#### 7.3.1 原理
增益圖記錄的是「HDR 渲染 ÷ SDR 基底」的比例。只改 SDR 基底的色調、不改幾何時，原增益圖疊到新基底上仍是合理的 HDR。實測 B 法證實：峰值相差 0.8%。

#### 7.3.2 v1 規則（B 法）
1. 原圖是 JPEG、有 MPF 增益圖，且這次編輯**不改尺寸、不裁切**時，才輸出 HDR。
2. 處理時用轉正後的像素；匯出時把結果**轉回原本的儲存方向**（orientation 6 用 8 轉回，依此類推），寬高等於 `storedSize`，再編成 JPEG。
3. 重新組合檔案，依序為：SOI → 原 EXIF（Orientation 不變）→ 原 XMP → 新 ICC（P3）→ 新 MPF（重算偏移）→ 原 ISO 21496 APP2 → 新主圖 → **原增益圖位元組（逐位元組複製）**。
4. 原圖的 `APP10:AROT` 區段不帶入。它是 Apple 的私有資料，用途不明；實測拿掉後 HDR 仍正常。
5. 每次輸出都要自我檢查：重新解析輸出檔，確認 MPF 指得到增益圖、尺寸一致；失敗時改輸出 SDR 並告知使用者。

#### 7.3.3 會改變尺寸的操作（v1.1 前置驗證）
裁切、旋轉、加框都需要對增益圖做同樣的幾何變換。實測 A 法（瀏覽器解碼增益圖再重新編碼）失真了 21%。原因推測是增益圖帶有特殊的 PQ ICC 描述檔，解碼時被做了色彩轉換。

**v1.1 開工前要先驗證**：拿掉增益圖的 ICC 後再用 `colorSpaceConversion:'none'` 解碼，像素值是否與原始值一致。驗證通過，增益圖就可以用 GPU 做幾何變換；不通過則改用 JS 自行解碼 baseline JPEG。

**在驗證通過前**，對 HDR 照片做裁切或加框時一律輸出 SDR，並在存檔按鈕旁顯示「此編輯會輸出 SDR」。

#### 7.3.4 預覽
v1 的暗房預覽一律顯示 **SDR**，HDR 照片只在畫面角落加上「HDR」標籤，表示輸出會保留 HDR。要在預覽中呈現 HDR，必須在 shader 裡套用增益圖，這需要正確解碼增益圖，與 R1 是同一個問題，因此延到 v1.1 一起處理。§3 中「WebGPU 可顯示 HDR」的結論保留給 v1.1 使用。

#### 7.3.5 HEIC
v1 輸出 SDR。暗房會顯示一次性提示：「想保留 HDR：設定 → 相機 → 格式 → 最相容」。v1.2 再實作從 HEIC 取出增益圖（`auxC` = `urn:com:apple:photo:2020:aux:hdrgainmap` 的 HEVC 圖塊）。

### 7.4 輸出

- v1 只輸出 JPEG，品質 0.92；48MP 編碼實測約 300 ms。
- 檔名：`AIO_YYYYMMDD_HHMMSS_<風格>.jpg`。
- 存檔：用 `navigator.share({files:[f]})` 開啟系統分享面板，由使用者點「儲存影像」。網頁無法直接寫入照片 App，這是平台限制。
- 不支援分享的瀏覽器改成下載。
- EXIF：
  - 匯入照片時，原 EXIF 整段複製。
  - 即時拍攝時，自己產生 EXIF。
  - 兩者都會加上 `Software=AIO Cam Web <版本>`，並在 `ImageDescription` 寫入配方名稱。
- HEIC 原圖的 EXIF 從 TIFF 區塊整段搬到 JPEG 的 APP1。

---

## 8. 風格與配方

### 8.1 配方資料模型

```json
{
  "v": 1,
  "name": "日和",
  "base": "hiyori",
  "intensity": 1.0,
  "wb": { "temp": 0, "tint": 0 },
  "tone": { "contrast": 0, "highlights": 0, "shadows": 0, "blacks": 0 },
  "color": { "saturation": 0, "pad": [0, 0] },
  "grain": { "amount": 0.2, "size": 1.0 },
  "vignette": { "amount": 0.15 },
  "lensAware": true
}
```

- 數值皆為有界的浮點數，`recipe.js` 負責檢查範圍並把超出的值夾回範圍內。未知欄位一律忽略，以保持往後相容。
- **網址編碼**：只寫入與內建風格不同的欄位 → 用 JSON 壓縮 → base64url → `#r=…`。目標是網址 ≤ 200 字元，QR code 才容易掃。
- `pad`：色彩 × 色調二維調整盤，x = 冷↔暖，y = 淡↔濃，與原版操作一致。

### 8.2 內建 7 種風格

名稱沿用原版的命名方式；調性用文字描述，不提及任何品牌。

| 代號 | 名稱 | 調性 |
|---|---|---|
| `asshot` | 原樣 | 不改色，只套顆粒與暗角 |
| `hiyori` | 日和 | 柔和高光、偏青綠的陰影、膚色溫潤、低對比 |
| `street` | 街景 | 高對比、低飽和、偏冷綠的中間調、粗顆粒 |
| `classic` | 經典 | 濃郁紅黃、深陰影、輕微暗角、厚實感 |
| `clear` | 清透 | 提亮、青藍偏移、高光乾淨、低顆粒 |
| `natural` | 自然 | 接近原樣，輕微 S 曲線、膚色保護 |
| `chiaro` | 光影 | 強烈明暗、壓暗陰影、保留高光細節 |

每種風格 = 程式產生的 33³ LUT + 預設的色調與顆粒參數。LUT 由參數化的色彩模型生成（色相偏移、分區飽和度、分離色調、色調曲線），不使用任何第三方 LUT，避免授權問題。

**調色驗收**：以 10 張固定測試圖（涵蓋膚色、天空、植物、夜景、高反差、白牆）輸出對照表。由使用者目視選定後凍結成**金樣本**；之後任何修改都要通過 S6 的 ΔE 比對，避免回歸。調校以整組測試圖為準，不針對單張圖。

### 8.3 依鏡頭自動微調（`lensAware`）

依 EXIF 調整，只在數值存在時作用：

| 條件 | 調整 |
|---|---|
| FNumber ≤ 1.6 | 顆粒 × 0.8（低光、雜訊多時避免疊加過重） |
| FNumber ≥ 2.8 | 暗角 × 0.7 |
| 等效焦段 ≤ 15mm | 暗角 × 0.5（超廣角本身邊緣已偏暗） |
| 等效焦段 ≥ 90mm | 高光柔化 +0.1 |
| ISO ≥ 1600 | 顆粒尺寸 × 1.2 |

所有調整都會顯示在介面的「自動調整」小標籤上，可以一鍵關閉。

---

## 9. 裝置能力與降級

`device.js` 在啟動時產生 `DeviceProfile`：

| 能力 | 偵測方式 | 有 | 沒有 |
|---|---|---|---|
| WebGPU | `navigator.gpu` + adapter | 主引擎 | WebGL2 |
| WebGPU HDR 畫布 | configure `rgba16float` + `extended`，讀回設定確認 | 記錄在 profile，供 v1.1 的 HDR 預覽使用 | — |
| P3 畫布 | `getContextAttributes().colorSpace` | P3 管線 | sRGB 管線 |
| 相機 zoom / torch | `getCapabilities()` | 顯示對應按鈕 | 隱藏按鈕 |
| 分享檔案 | `navigator.canShare({files})` | 分享面板 | 下載 |
| 最大畫布 | 測試 48MP / 24MP / 16MP | 全尺寸 | 縮小到可行的最大尺寸，並告知使用者 |

**iPhone 18 Pro Max 專屬設定**（依 EXIF `Model` 或螢幕 440×956@3x 判定）：
- 倍率鍵預設 0.5 / 1 / 2 / 4 / 8，對應 13 / 24 / 48 / 100 / 200mm。
- 版面依 6.9 吋螢幕的安全區域配置。

其他機型的倍率鍵依 `zoom` 範圍自動產生。

---

## 10. 介面

- 兩個主畫面：**相機**（預設）與**暗房**，用底部的大型分段切換。
- **單手操作**：快門、風格列、倍率鍵都在螢幕下方 1/3，觸控區域 ≥ 56pt。常用控制（閃光燈、曝光、比例、格線）放在頂部工具列，**不收進選單**。
- **風格列**：在取景區左右滑動切換風格，底部的縮圖列同步顯示。
- **調整盤**：長按風格名稱展開二維調整盤，拖曳時即時預覽。
- 按住暗房畫面顯示原圖。
- 介面一律使用深色背景。

---

## 11. 儲存與隱私

- 照片不寫入 IndexedDB，也不上傳；只存在當次使用的記憶體中。存檔一律交給系統分享面板。
- IndexedDB 只存自訂配方、設定，以及最近使用的風格。
- Service Worker 只快取 App 本身的檔案。
- 不使用任何第三方分析或追蹤；GitHub Pages 本身會有存取紀錄，這點寫在說明頁。

---

## 12. 錯誤處理

| 情況 | 行為 |
|---|---|
| 相機權限被拒 | 顯示引導畫面（設定路徑），提供「改用暗房」 |
| 開相機失敗 | 自動重試 1 次；再失敗時顯示錯誤，並提供重試鍵 |
| 解碼失敗（格式不支援） | 告知格式，建議改成「最相容」格式或改選其他照片 |
| 畫布或 GPU 記憶體不足 / 裝置遺失（device lost） | 重建 GPU 裝置，以 24MP 重試，並告知使用者已降低解析度 |
| HDR 重組自我檢查失敗 | 輸出 SDR，並提示「此張未能保留 HDR」 |
| 分享取消 | 不視為錯誤；存檔按鈕保持可用 |
| 配方網址無效 | 忽略，並提示「配方連結無法讀取」 |

---

## 13. 測試策略

| 層級 | 內容 | 工具 |
|---|---|---|
| 單元 | `jpeg.js`（區段解析、MPF 重算、remux、方向）、`exif.js`、`recipe.js`（驗證、網址編解碼來回一致） | `node --test` |
| 容器正確性 | 用 Apple 增益圖範例（libultrahdr `apple_gainmap_new.jpg`），重組後 ImageIO 仍偵測到增益圖，headroom 不變 | `tools/gmcheck`（Mac） |
| 影像一致性 | 10 張固定測試圖 × 7 種風格：WebGPU / WebGL2 vs `cpu-ref.js`，比 ΔE2000（S6） | 無頭 Chrome + CDP |
| HDR 數值 | B 法輸出 vs 原圖：峰值、p99.9、超過一般白色的像素比例（S2） | `tools/hdrmeasure`（Mac） |
| 實機 | 18 Pro Max 驗收清單：S1–S5，含一次 AirDrop 量測 | 手動，結果記錄於 `docs/device-runs/` |

除錯頁 `?debug=1` 會顯示 `DeviceProfile` 與各階段耗時，並可一鍵複製 JSON，沿用實測頁的做法。

---

## 14. 里程碑

| 階段 | 內容 | 完成條件 |
|---|---|---|
| M1 | `io/*` + `engine`（WebGPU + WebGL2 + CPU 參考實作）+ 暗房最小介面 + JPEG HDR 輸出 | S1、S2、S3、S4、S6、S7 |
| M2 | 即時相機 | S5 |
| M3 | 7 種風格調色定案 + 配方編輯與網址分享 + PWA | 使用者通過調色金樣本 |
| M4 | 介面打磨、實機驗收 | 18 Pro Max 驗收清單全部通過 |

---

## 15. 風險與未決事項

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R1 | 改變尺寸的編輯會使增益圖失真（A 法） | v1.1 的裁切與邊框 | §7.3.3 驗證門檻；未通過前輸出 SDR |
| R2 | SDR 基底套風格後，原增益圖的比例可能讓高光過亮或色偏 | HDR 觀感 | 以 S2 量測；若某風格超標，該風格對增益圖做強度衰減（需能改寫增益圖，與 R1 同解） |
| R3 | `APP10:AROT` 用途不明 | 未知的相容性問題 | 目前實測拿掉無影響；若照片 App 出現異常再研究 |
| R4 | iOS 更新改變相機 API 行為（例如開始支援曝光控制） | 功能差異 | 以 `getCapabilities` 動態偵測，有支援就自動顯示控制 |
| R5 | 「所見即所得」：預覽用螢幕解析度、輸出用全尺寸，顆粒觀感可能不同 | 輸出結果與預期不符 | 顆粒尺寸依輸出解析度縮放；兩種解析度都納入金樣本 |
| R6 | 使用者帳號與 repo 名稱 | — | 預設 `jonwenjen/aio-cam-web`，部署到 GitHub Pages |

---

## 16. 待使用者確認

1. **v1 範圍**：§4.1 為建議範圍（即時相機 + 暗房 + 7 種風格 + 配方分享，不含 14 濾鏡、邊框）。是否同意？
2. **風格名稱**：沿用原版的「日和、街景、經典、清透、自然、光影」，或自訂新名稱？
3. **Repo**：`~/Projects/aio-cam-web` → `github.com/jonwenjen/aio-cam-web`（public）是否可以？

---

## 附錄 A：實測數據摘要（iPhone 18 Pro Max / iOS 27.0.1）

| 項目 | 數值 |
|---|---|
| 48.8MP JPEG/HEIC/DNG 解碼 | 226–499 ms |
| 48.8MP 上傳 GPU 紋理 | 148 ms |
| 48.8MP JPEG 編碼（q0.92） | 265–323 ms |
| WebGPU 48MP 逐像素運算 | 5.4–7.0 ms |
| 即時預覽 12MP GPU 繪製 | 58.5 fps（相機 29.5 fps），最慢單幀 129 ms（首幀） |
| `takePhoto` | 12MP，1218 ms |
| 同時存在的 48MP 2D 畫布 | ≥ 7–10 張不崩潰 |
| HDR B 法 vs 原圖（IMG_0040） | 峰值 2.56 vs 2.58；p99.9 2.03 vs 2.00；>1.0 像素 16.6% vs 14.0%（含測試用暖色疊層） |
| HDR A 法 vs 原圖 | 峰值 3.12 vs 2.58 ❌ |
| Apple HDR 參數（IMG_0040） | maker tag 33 = 1.01、48 = 2.503；ISO 21496 同時存在 |
| 增益圖 | 2856×2142，單通道，ICC：Display P3 Primaries; PQ (Adaptive Gain Curve) |
