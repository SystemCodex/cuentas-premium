$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $root ".deploy\hostinger-$stamp"
$zipPath = "$outDir.zip"

Set-Location $root
npm run build:all

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$items = @(
  "build",
  "dist",
  "src",
  "server",
  "prisma",
  "scripts",
  "deploy",
  "package.json",
  "package-lock.json",
  "index.html",
  "server.js",
  "tsconfig.json",
  "tsconfig.server.json",
  "vite.config.ts",
  ".env.example"
)

foreach ($item in $items) {
  $source = Join-Path $root $item
  if (Test-Path $source) {
    Copy-Item -Path $source -Destination $outDir -Recurse -Force
  }
}

$envProd = Join-Path $root "deploy\hostinger\.env.production.example"
Copy-Item -Path $envProd -Destination (Join-Path $outDir ".env.production.example") -Force

Compress-Archive -Path (Join-Path $outDir "*") -DestinationPath $zipPath -Force
Write-Host "Paquete Hostinger creado: $zipPath"
