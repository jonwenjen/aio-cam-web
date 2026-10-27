#!/bin/sh
# 下載測試圖（Kodak 測試圖，作者聲明可自由使用），並記錄 SHA-256。冪等。
set -eu
cd "$(dirname "$0")/../test/fixtures"
mkdir -p kodak
for n in 05 15 20 23; do
  f="kodak/kodim$n.png"
  [ -s "$f" ] || curl -fsSL -o "$f" "https://r0k.us/graphics/kodak/kodak/kodim$n.png"
done
shasum -a 256 kodak/*.png > SHA256SUMS
cat SHA256SUMS
