# 第三方授權

只接受 MIT／Apache-2.0／BSD／ISC／CC0（spec §5.4）。App 本身目前不含任何第三方程式碼。

| 名稱 | 授權 | 用途 | 位置 |
|---|---|---|---|
| culori | MIT | 只在測試（CIEDE2000 對照） | `node_modules/`（devDependency） |
| Kodak 測試圖 kodim05/15/20/23 | 作者聲明可自由使用（無限制） | 只在測試 | `test/fixtures/kodak/` |
| libultrahdr 測試檔 `apple_gainmap_new.jpg` | Apache-2.0 | 只在測試（及其衍生檔 `gm_gps_rot6.jpg`、`sample.heic`、`sample.tif`） | `test/fixtures/` |
| S20 實拍 `s20_01`：Misti Cordell.jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [Ktkvtsh](https://commons.wikimedia.org/wiki/File:Misti_Cordell.jpg) |
| S20 實拍 `s20_02`：Former Masonic Temple (Tallulah, Louisiana) 02.jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [Ktkvtsh](https://commons.wikimedia.org/wiki/File:Former_Masonic_Temple_%28Tallulah%2C_Louisiana%29_02.jpg) |
| S20 實拍 `s20_03`：Cotton Field (Madison Parish, Louisiana) 03.jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [Ktkvtsh](https://commons.wikimedia.org/wiki/File:Cotton_Field_%28Madison_Parish%2C_Louisiana%29_03.jpg) |
| S20 實拍 `s20_04`：Fall Webworm (Hyphantria Cunea) Delta, Louisiana 03.jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [Ktkvtsh](https://commons.wikimedia.org/wiki/File:Fall_Webworm_%28Hyphantria_Cunea%29_Delta%2C_Louisiana_03.jpg) |
| S20 實拍 `s20_05`：Water tower Lake Saint John, Louisiana.jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [Ktkvtsh](https://commons.wikimedia.org/wiki/File:Water_tower_Lake_Saint_John%2C_Louisiana.jpg) |
| S20 實拍 `s20_06`：North American river otter (Lontra canadensis) in Tensas River National Wildlife Refuge, Louisiana 01.jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [Ktkvtsh](https://commons.wikimedia.org/wiki/File:North_American_river_otter_%28Lontra_canadensis%29_in_Tensas_River_National_Wildlife_Refuge%2C_Louisiana_01.jpg) |
| S20 實拍 `s20_07`：Walmart (Vicksburg, Mississippi).jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [Ktkvtsh](https://commons.wikimedia.org/wiki/File:Walmart_%28Vicksburg%2C_Mississippi%29.jpg) |
| S20 實拍 `s20_08`：Salle de lecture de Bibliothèque du Campus Saint-Jean.jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [BiblioQC](https://commons.wikimedia.org/wiki/File:Salle_de_lecture_de_Biblioth%C3%A8que_du_Campus_Saint-Jean.jpg) |
| S20 實拍 `s20_09`：Madison Parish Courthouse, September 2026 01.jpg | CC BY 4.0 | 只在本機測試（S20），不提交、不散布 | [Ktkvtsh](https://commons.wikimedia.org/wiki/File:Madison_Parish_Courthouse%2C_September_2026_01.jpg) |
| S20 實拍 `s20_10`：Pontru - La Croix blanche.2026.jpg | CC0 | 只在本機測試（S20），不提交、不散布 | [ErwannK](https://commons.wikimedia.org/wiki/File:Pontru_-_La_Croix_blanche.2026.jpg) |
| S20 實拍 `s20_11`：At London 2026 0395.jpg | CC BY-SA 4.0 | 只在本機測試（S20），不提交、不散布 | [Photograph by Mike Peel (www.mikepeel.net).](https://commons.wikimedia.org/wiki/File:At_London_2026_0395.jpg) |
| S20 實拍 `s20_12`：At London 2026 0411.jpg | CC BY-SA 4.0 | 只在本機測試（S20），不提交、不散布 | [Photograph by Mike Peel (www.mikepeel.net).](https://commons.wikimedia.org/wiki/File:At_London_2026_0411.jpg) |

S20 實拍由 `tools/fetch-fixtures.sh` 從 Wikimedia Commons 下載到 `test/external/s20/`（已在 `.gitignore`），repo 只提交來源清單 `test/s20-sources.json`。
