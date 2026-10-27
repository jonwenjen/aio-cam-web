#!/bin/sh
# 下載測試圖並記錄 SHA-256。冪等。
#  - Kodak 測試圖（作者聲明可自由使用）→ test/fixtures/kodak/（提交）
#  - S20 用的 iPhone 18 實拍（Wikimedia Commons，CC BY／BY-SA／CC0）→ test/external/s20/（只放本機，不提交）
#    清單與授權在 test/s20-sources.json 與 docs/licenses.md
set -eu
cd "$(dirname "$0")/../test"
UA='aio-cam-web-test-fixtures/0.1 (https://github.com/jonwenjen/aio-cam-web)'

mkdir -p fixtures/kodak
for n in 05 15 20 23; do
  f="fixtures/kodak/kodim$n.png"
  [ -s "$f" ] || curl -fsSL -A "$UA" -o "$f" "https://r0k.us/graphics/kodak/kodak/kodim$n.png"
done
(cd fixtures && shasum -a 256 kodak/*.png > SHA256SUMS)

mkdir -p external/s20
node -e '
  for (const s of require("./s20-sources.json")) console.log(s.id + " " + s.url);
' | while read -r id url; do
  f="external/s20/$id.jpg"
  if [ ! -s "$f" ]; then
    curl -fsSL -A "$UA" -o "$f.part" "$url" && mv "$f.part" "$f"
    sleep 5 # Wikimedia 有請求頻率限制
  fi
done
(cd external && shasum -a 256 s20/*.jpg > SHA256SUMS && cat SHA256SUMS)
