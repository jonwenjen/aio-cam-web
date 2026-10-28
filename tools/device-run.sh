#!/bin/sh
# iPhone 實機驗收判讀（Task 18）：對 AirDrop 回來的 5 個檔案跑 verify-output，結果附加到 docs/device-runs/M1.md。
# 用法：tools/device-run.sh <原圖> <原色-保留全部> <日和-保留全部> <去除位置> <去除全部>
set -eu
[ $# -eq 5 ] || { echo "usage: tools/device-run.sh <original> <asshot-keep> <hiyori-keep> <noLocation> <minimal>" >&2; exit 2; }
cd "$(dirname "$0")/.."
orig=$1
out=docs/device-runs/M1.md
status=0

run() { # 標題 輸出檔 隱私 [--no-s2]
  title=$1; file=$2; privacy=$3; shift 3
  printf '\n### %s：`%s`（%s）\n\n```\n' "$title" "$(basename "$file")" "$privacy" >> "$out"
  if node tools/verify-output.mjs "$orig" "$file" --privacy="$privacy" "$@" >> "$out" 2>&1; then r=PASS; else r=FAIL; status=1; fi
  printf '```\n結果：%s\n' "$r" >> "$out"
  echo "$r  $title"
}

{ printf '\n## 自動判讀結果（%s）\n\n原圖：`%s`\n' "$(date '+%Y-%m-%d %H:%M')" "$(basename "$orig")"
  printf '\n原圖 Apple ImageIO：\n\n```\n'; tools/bin/gmcheck "$orig"; tools/bin/hdrmeasure "$orig"; printf '```\n'; } >> "$out"
run "S2＋S3 原色、保留全部" "$2" keep
run "S3 日和、保留全部" "$3" keep --no-s2
run "S16 去除位置" "$4" noLocation
run "S16 去除全部" "$5" minimal
echo "結果已附加到 $out"
exit $status
