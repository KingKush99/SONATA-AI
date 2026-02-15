$ErrorActionPreference = 'Stop'
$port = 2924
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Output "Starting Vite dev server on port $port..."
Write-Output "Open http://localhost:$port"

& npm run dev -- --port $port --host 127.0.0.1
