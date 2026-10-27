# AIO Cam Web — 專案規則（Claude Code 自動載入）

- 回報一律用**繁體中文**。
- 目前工作：照 `docs/superpowers/plans/2026-10-27-m1-core.md` 實作 M1。規格：`docs/superpowers/specs/2026-10-26-aio-cam-web-design.md`。計畫與規格衝突時以規格為準，並在回報中指出。
- 純 HTML/CSS/ES modules，**沒有建置工具**。npm 只用來跑測試（devDependency 只有 culori）。
- TDD：先寫失敗測試、確認失敗、再實作、確認通過、commit。**不得為了通過而放寬 spec 的驗收門檻**（S1–S19）；門檻有問題就停下來問。
- 品牌名稱、底片型號只能寫在 `docs/`。`node tools/check-brands.mjs` 必須通過。
- 不上傳任何資料、不加任何分析或追蹤程式。
- HDR：增益圖逐位元組照抄，**永遠不要讓瀏覽器解碼增益圖**（JPEG 解碼只餵 `bytes.subarray(0, primaryEnd)`）。
- CPU 參考實作與 WebGPU、WebGL2 的數學必須逐式一致（計畫「釘死的數學」一節）。改一邊就同時改另外兩邊。
- 影像管線先做空操作測試（所有參數歸零 → 輸出與輸入位元相同）。
- 瀏覽器測試用 `tools/run-browser.mjs`（獨立的無頭 Chrome，不碰使用者自己的 Chrome）。WebGPU 需要 `--enable-unsafe-webgpu --use-angle=metal` 且不能加 `--disable-gpu`；要模擬「沒有 WebGPU」只能注入腳本把 `navigator.gpu` 設成 undefined（Chrome 旗標關不掉）。
- `test/private/` 是使用者的私人照片，**絕不 commit、絕不上傳**。
- 檢查點 A、B 一定要停下來等使用者回覆。repo 已在 GitHub（`jonwenjen/aio-cam-web`，公開）。`git push` 與開 Pages 只在檢查點 B 得到同意後才做。
