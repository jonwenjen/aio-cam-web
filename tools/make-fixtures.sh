#!/bin/sh
# 產生衍生測試檔（只用 macOS 內建 sips 與 exiftool）。冪等：每次都從來源重新產生。
# 需要先跑 tools/fetch-fixtures.sh 取得 Kodak 測試圖。
set -eu
cd "$(dirname "$0")/../test/fixtures"
[ -s kodak/kodim23.png ] || { echo "run tools/fetch-fixtures.sh first" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -f "$tmp"/*; rmdir "$tmp"' EXIT

# HDR、直拍、有 GPS（EXIF 與 XMP 都有）的主測試檔
cp apple_gainmap_new.jpg gm_gps_rot6.jpg
exiftool -q -overwrite_original -Orientation#=6 \
  -GPSLatitude=22.6644 -GPSLatitudeRef=N -GPSLongitude=120.3014 -GPSLongitudeRef=E -GPSAltitude=12 \
  -XMP-exif:GPSLatitude=22.6644 -XMP-exif:GPSLongitude=120.3014 gm_gps_rot6.jpg

# 沒有 ICC 的 sRGB JPEG
sips -s format jpeg kodak/kodim23.png --out plain_srgb.jpg >/dev/null
exiftool -q -overwrite_original -icc_profile= plain_srgb.jpg

# 灰階 JPEG
sips -s format jpeg -m "/System/Library/ColorSync/Profiles/Generic Gray Profile.icc" \
  kodak/kodim23.png --out gray.jpg >/dev/null

# HEIC 與 TIFF（容器 EXIF 測試）
sips -s format heic gm_gps_rot6.jpg --out sample.heic >/dev/null
sips -s format tiff gm_gps_rot6.jpg --out sample.tif >/dev/null

# APP1 接近 65,533 上限：約 8KB 縮圖＋把 UserComment 補到 APP1 長度 = 65,520
# （再加上 Software 標籤就會超過，只要拿掉縮圖就放得下）
sips -Z 180 -s formatOptions 80 -s format jpeg plain_srgb.jpg --out "$tmp/thumb.jpg" >/dev/null
target=65520
n=1000
cp plain_srgb.jpg big_exif.jpg
printf '%*s' "$n" '' | tr ' ' 'A' > "$tmp/uc.txt"
exiftool -q -overwrite_original "-UserComment<=$tmp/uc.txt" "-ThumbnailImage<=$tmp/thumb.jpg" big_exif.jpg
app1=$(( $(exiftool -b -EXIF big_exif.jpg | wc -c) + 8 ))
n=$(( n + target - app1 ))
cp plain_srgb.jpg big_exif.jpg
printf '%*s' "$n" '' | tr ' ' 'A' > "$tmp/uc.txt"
exiftool -q -overwrite_original "-UserComment<=$tmp/uc.txt" "-ThumbnailImage<=$tmp/thumb.jpg" big_exif.jpg
app1=$(( $(exiftool -b -EXIF big_exif.jpg | wc -c) + 8 ))
[ "$app1" -eq "$target" ] || { echo "big_exif APP1 = $app1, expected $target" >&2; exit 1; }

ls -l gm_gps_rot6.jpg plain_srgb.jpg gray.jpg sample.heic sample.tif big_exif.jpg
