#!/usr/bin/env bash
# Replaces Capacitor's default launcher icons with the HANTER GAMES icon (needs ImageMagick).
set -euo pipefail
RES=android/app/src/main/res
SRC=public/icons/icon-512.png
IM=$(command -v magick || command -v convert)
rm -rf "$RES/mipmap-anydpi-v26"   # use plain PNG icons instead of the default adaptive icon
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${pair%%:*}; s=${pair##*:}
  mkdir -p "$RES/mipmap-$d"
  "$IM" "$SRC" -resize "${s}x${s}" "$RES/mipmap-$d/ic_launcher.png"
  cp "$RES/mipmap-$d/ic_launcher.png" "$RES/mipmap-$d/ic_launcher_round.png"
  rm -f "$RES/mipmap-$d/ic_launcher_foreground.png"
done
