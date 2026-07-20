$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$toolsRoot = Join-Path $projectRoot "tools"
$targetRoot = Join-Path $toolsRoot "realesrgan-ncnn-vulkan"
$enginePath = Join-Path $targetRoot "realesrgan-ncnn-vulkan.exe"
$downloadUrl = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip"
$zipPath = Join-Path $toolsRoot "realesrgan-ncnn-vulkan-windows.zip"
$extractRoot = Join-Path $toolsRoot "_realesrgan_extract"

if (Test-Path $enginePath) {
  Write-Host "Real-ESRGAN ncnn-vulkan is already installed:"
  Write-Host $enginePath
  exit 0
}

New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

Write-Host "Downloading Real-ESRGAN ncnn-vulkan..."
Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

if (Test-Path $extractRoot) {
  $resolvedExtractRoot = Resolve-Path $extractRoot
  $resolvedToolsRoot = Resolve-Path $toolsRoot

  if (-not $resolvedExtractRoot.Path.StartsWith($resolvedToolsRoot.Path)) {
    throw "Refusing to clean a path outside tools/: $resolvedExtractRoot"
  }

  Remove-Item -LiteralPath $extractRoot -Recurse -Force
}

Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

$engineSource = Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Filter "realesrgan-ncnn-vulkan.exe" | Select-Object -First 1
if (-not $engineSource) {
  throw "Could not find realesrgan-ncnn-vulkan.exe in the downloaded package."
}

$sourceRoot = $engineSource.Directory.FullName
New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot "*") -Destination $targetRoot -Recurse -Force

$modelsRoot = Join-Path $targetRoot "models"
New-Item -ItemType Directory -Force -Path $modelsRoot | Out-Null
Get-ChildItem -LiteralPath $targetRoot -File | Where-Object { $_.Extension -in ".bin", ".param" } | Move-Item -Destination $modelsRoot -Force

if (-not (Test-Path $enginePath)) {
  throw "Install finished, but realesrgan-ncnn-vulkan.exe was not found."
}

Write-Host "Installed Real-ESRGAN ncnn-vulkan:"
Write-Host $enginePath
