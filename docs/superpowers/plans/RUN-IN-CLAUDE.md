# 在 Claude Code 執行 M1 計畫

本文件給使用者看：怎麼讓 Claude Code 照 `2026-10-27-m1-core.md` 寫出 M1。計畫本身已寫好決策、介面、測試與驗收數字，Claude 只需要照著做。

## 0. 前置（一次性，約 2 分鐘）

```bash
cd ~/Projects/aio-cam-web
git status                      # 應該是乾淨的
claude                          # 開互動模式
```

在 Claude Code 裡安裝 superpowers（計畫使用它的「逐 Task 執行＋審查」流程）：

```
/plugin install superpowers@claude-plugins-official
```

裝不起來也沒關係，計畫第一行有備援做法（一次做一個 Task）。

專案已附好：
- `CLAUDE.md`：每次對話自動載入的專案規則（品牌字詞禁用、TDD、檢查點）。
- `.claude/settings.json`：允許 Claude 不問就跑測試、node、exiftool、swiftc、git commit；**禁止** `git push`、`gh repo create`（要等檢查點 B 你同意才做）。

## 1. 開始（貼這段給 Claude）

```
讀 docs/superpowers/plans/2026-10-27-m1-core.md 與它引用的 spec。
用 superpowers:subagent-driven-development 從 Task 0 開始執行。
每完成一個 Task 就 commit；到「檢查點 A」停下來用繁體中文回報，等我說繼續。
```

## 2. 檢查點

| 何時 | Claude 會給你 | 你要做的 |
|---|---|---|
| 檢查點 A（Task 11 後） | `npm run check` 結果、7 組發色 × 3 種引擎的色差表 | 看數字是否都在門檻內（mean ≤ 0.5、max ≤ 2.0），回「繼續」 |
| 檢查點 B（Task 15 後） | 完整測試結果、輸出檔驗證表、兩張手機尺寸截圖 | 決定是否建立公開 repo 並部署；同意就回「部署」 |
| Task 17 | 實機操作清單 `docs/device-runs/M1.md` | 用 iPhone 照清單做，把 5 個檔案 AirDrop 到 Mac mini |

## 3. 也可以不用互動模式（無人值守）

一次只跑一個 Task，方便中途檢查：

```bash
cd ~/Projects/aio-cam-web
claude -p "照 docs/superpowers/plans/2026-10-27-m1-core.md 執行 Task 0，完成後 commit 並用繁體中文回報。不要開始下一個 Task。" \
  --permission-mode acceptEdits --max-turns 80
```

把 `Task 0` 換成下一個編號重複執行。print 模式不能詢問權限，超出 `.claude/settings.json` 允許清單的指令會被自動拒絕；若回報「permission denied」，把需要的指令加進允許清單再重跑。

## 4. 如果卡住

- 測試一直失敗：請 Claude 用 `superpowers:systematic-debugging`，不要改測試門檻。門檻來自 spec，改門檻要先問你。
- 色差超標（檢查點 A）：問題一定在 CPU 與 GPU 的數學不一致，計畫的「釘死的數學」是唯一標準。
- Swift 工具編不過：`xcode-select --install`。
