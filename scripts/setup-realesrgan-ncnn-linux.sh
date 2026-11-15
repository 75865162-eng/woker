#!/usr/bin/env bash
set -euo pipefail

tools_root="${TOOLS_ROOT:-tools}"
target_root="$tools_root/realesrgan-ncnn-vulkan"
model_root="$target_root/models"
archive="$tools_root/realesrgan-ncnn-vulkan-ubuntu.zip"
url="${REALESRGAN_NCNN_LINUX_URL:-https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip}"

mkdir -p "$tools_root"
if [ ! -x "$target_root/realesrgan-ncnn-vulkan" ]; then
  command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }
  command -v unzip >/dev/null || { echo "unzip is required." >&2; exit 1; }
  rm -rf "$target_root" "$tools_root/_realesrgan_extract"
  mkdir -p "$target_root" "$model_root" "$tools_root/_realesrgan_extract"
  curl -fL "$url" -o "$archive"
  unzip -q "$archive" -d "$tools_root/_realesrgan_extract"
  binary="$(find "$tools_root/_realesrgan_extract" -type f -name realesrgan-ncnn-vulkan | head -n 1)"
  [ -n "$binary" ] || { echo "Could not find realesrgan-ncnn-vulkan in the downloaded package." >&2; exit 1; }
  cp "$binary" "$target_root/realesrgan-ncnn-vulkan"
  find "$tools_root/_realesrgan_extract" -type f \( -name "*.bin" -o -name "*.param" \) -exec cp {} "$model_root/" \;
  chmod +x "$target_root/realesrgan-ncnn-vulkan"
  rm -rf "$tools_root/_realesrgan_extract" "$archive"
fi

echo "Real-ESRGAN Linux engine ready: $target_root/realesrgan-ncnn-vulkan"
