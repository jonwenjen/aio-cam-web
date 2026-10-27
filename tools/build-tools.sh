#!/bin/sh
# 把 Apple ImageIO／CoreImage 量測工具編到 tools/bin/（需要 Xcode command line tools）
set -eu
cd "$(dirname "$0")"
mkdir -p bin
swiftc -O gmcheck.swift -o bin/gmcheck
swiftc -O hdrmeasure.swift -o bin/hdrmeasure
echo "built: tools/bin/gmcheck tools/bin/hdrmeasure"
