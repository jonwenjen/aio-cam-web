# 發色調色與推薦規則（M1 暫定）

本文件可以寫品牌與底片名稱作為調色參考；程式、介面、i18n 一律只用代號（spec §1.1）。

## 7 組暫定發色（M1，金樣本在 M3 定版）

| 代號 | 名稱 | 家族 | 起始參數（未列 = 預設） | 調色參考（推測，見 spec §9.2） |
|---|---|---|---|---|
| asshot | 原色 | 中性 | 全部預設（顆粒 0.2、暗角 0.15） | iPhone 原始輸出 |
| natural | 自然 | 中性 | contrast −0.05、highlights −0.15、skinProtect 0.6 | Nikon Picture Control 自然／中性 |
| hiyori | 日和 | 負片 | contrast −0.15、highlights −0.2、saturation −0.05、grade.shadows [195, 0.35]、grade.highlights [60, 0.15]、hsl.orange [0.05, 0.05, 0] | Fujifilm Classic Neg／Pro Neg 類 |
| streetscape | 街景 | 負片 | saturation −0.2、blacks 0.3、shadows −0.2、grade.midtones [240, 0.2]、grain {0.35, size 1.3} | Ricoh GR Negative Film |
| heritage | 經典 | 正片 | contrast 0.1、shadows −0.2、hsl.red/orange/yellow 飽和 +0.15/+0.1/+0.15、vignette 0.25 | Leica Looks Classic |
| clearview | 清透 | 正片 | contrast 0.05、highlights −0.1、whites 0.1、hsl.blue [0, 0.15, −0.05]、hsl.aqua [0.15, 0.1, 0] | Olympus／OM System 的藍天 |
| chiaroscuro | 光影 | 電影 | contrast 0.15、shadows −0.4、highlights −0.1、saturation −0.15、grade.highlights [60, 0.2]、grade.shadows [240, 0.2] | Canon（僅憑字母推測）或 Contax／Zeiss |

## 推薦規則（`js/looks/recommend.js` 的 `RULES`）

分數 = 基本分 ＋ Σ（場景分數 × 權重）。理由 = 貢獻最大的場景（沒有場景貢獻 > 0.1 時為「通用」）。
多樣性：第 2、3 名若和第 1 名同家族，且有其他家族的分數 ≥ 第 1 名 × 0.8，改放那組。同分依 `ORDER` 排序。

| 代號 | 基本分 | 場景權重 | 調色意圖 |
|---|---|---|---|
| asshot | 0.30 | — | 不確定時的安全選擇 |
| natural | 0.35 | 人像 0.3、陰天 0.2 | 中性準確，膚色柔和 |
| hiyori | 0.20 | 人像 0.5、綠意 0.4、逆光 0.4、陰天 0.3 | 柔和負片：逆光人像、植物、陰天提氣氛 |
| streetscape | 0.20 | 高反差 0.4、陰天 0.3、夜晚 0.2 | 冷硬街拍負片 |
| heritage | 0.20 | 黃金時刻 0.6、室內暖光 0.4、人像 0.2 | 濃郁暖色正片 |
| clearview | 0.20 | 藍天 0.7、綠意 0.2、藍調 0.3 | 清澈藍天 |
| chiaroscuro | 0.15 | 霓虹 0.6、夜晚 0.4、高反差 0.3、藍調 0.2 | 低調電影感 |

數值是起始值，M3 以 S21（20 張）校準，並同步更新本表與程式。

## 場景分數（`js/looks/analyze.js`，計畫釘死的公式）

```
portrait    = smoothstep(0.02, 0.12, 膚色比例)
sky         = smoothstep(0.08, 0.30, 天空比例)
green       = smoothstep(0.10, 0.35, 綠地比例)
golden      = 光線=黃金時刻 ? 信心 : 0.5·smoothstep(0.55, 0.75, 橙＋黃色相帶占比)
blueHour    = 光線=藍調 ? 信心 : 0
night       = max(光線=夜晚 ? 信心 : 0, 1 − smoothstep(0.02, 0.08, exp(對數平均亮度)))
neon        = night · smoothstep(0.10, 0.20, 彩度 p95)
indoorWarm  = (1 − night) · smoothstep(0.01, 0.04, 色偏 b) · (白天 ? 0.3 : 1)
overcast    = (1 − smoothstep(4, 6, 動態範圍)) · (1 − smoothstep(0.04, 0.08, 平均彩度)) · (1 − night)
highContrast= smoothstep(7, 9, 動態範圍)
backlit     = 逆光 ? 1 : 0
```
