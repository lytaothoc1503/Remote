<#
.SYNOPSIS
  Khoi chay VibeCode Remote: VS Code (CDP 9333) + Host Bridge (9334) + tuy chon Tunnel/LAN.

.PARAMETER Lan
  Cho phep truy cap trong mang LAN (bridge lang nghe 0.0.0.0 va mo tuong lua chi cho LocalSubnet, profile Private).
.PARAMETER Tunnel
  Bat Cloudflare Quick Tunnel (can cloudflared). Bridge van chi lang nghe 127.0.0.1.
.PARAMETER Root
  Thu muc goc cho phep duyet/ghi. Mac dinh: thu muc nguoi dung.
.PARAMETER Pin
  PIN tuy chon (>= 6 ky tu). Mac dinh: sinh ngau nhien.
#>
param(
    [switch]$Lan,
    [switch]$Tunnel,
    [string]$Root = $env:USERPROFILE,
    [string]$Pin = ''
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeFile = Join-Path $here 'server\bridge.cjs'

Write-Host "`n>>> [VIBECODE REMOTE] DANG KHOI TAO..." -ForegroundColor Cyan

function Test-Cdp {
    try {
        $v = Invoke-RestMethod -Uri 'http://127.0.0.1:9333/json/version' -TimeoutSec 1
        return [bool]$v.Browser
    } catch { return $false }
}

function Test-BridgePort {
    try {
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:9334/health' -TimeoutSec 1
        return [bool]$r.ok
    } catch { return $false }
}

# 0. Kiem tra dieu kien
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '[LOI] Chua cai Node.js (can >= 22).' -ForegroundColor Red; exit 1
}
$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) {
    Write-Host "[LOI] Node $nodeMajor qua cu, can >= 22 (WebSocket tich hop)." -ForegroundColor Red; exit 1
}
if (-not (Test-Path $bridgeFile)) {
    Write-Host "[LOI] Khong thay $bridgeFile" -ForegroundColor Red; exit 1
}

# 1. VS Code voi cong 9333 - KHONG tu y dong VS Code dang chay
if (Test-Cdp) {
    Write-Host '[1/4] Cong CDP 9333 da san sang, giu nguyen VS Code dang chay.' -ForegroundColor Green
} else {
    $running = Get-Process -Name 'Code' -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host '[CANH BAO] VS Code dang chay nhung chua mo cong 9333. Can khoi dong lai de bat debug port.' -ForegroundColor Yellow
        Write-Host '           Hay luu cong viec truoc. Script se DONG CUA SO nhe nhang (khong ep buoc).' -ForegroundColor Yellow
        $ans = Read-Host 'Dong VS Code va mo lai voi cong 9333? (y/N)'
        if ($ans -notmatch '^(y|yes)$') {
            Write-Host 'Da huy. Khong thay doi VS Code.' -ForegroundColor Gray; exit 0
        }
        $running | ForEach-Object { [void]$_.CloseMainWindow() }
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Process -Name 'Code' -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
        }
        if (Get-Process -Name 'Code' -ErrorAction SilentlyContinue) {
            Write-Host '[LOI] VS Code chua dong (co the con tep chua luu). Hay dong thu cong roi chay lai.' -ForegroundColor Red; exit 1
        }
    }
    $codePaths = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft VS Code\Code.exe')
    )
    $codeExe = $codePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $codeExe) { $codeExe = 'code' }
    Write-Host '[1/4] Mo VS Code voi cong CDP 9333 (chi nhan ket noi tu may nay)...' -ForegroundColor Green
    Start-Process $codeExe -ArgumentList '--remote-debugging-port=9333', '--remote-debugging-address=127.0.0.1'
    $ok = $false
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Milliseconds 600
        if (Test-Cdp) { $ok = $true; break }
    }
    if (-not $ok) { Write-Host '[LOI] Cong 9333 khong phan hoi.' -ForegroundColor Red; exit 1 }
    Write-Host '  [OK] Cong CDP 9333 san sang.' -ForegroundColor Green
}

# 2. Bridge - chi khoi dong neu 9334 con trong
if (Test-BridgePort) {
    Write-Host '[2/4] Bridge 9334 DANG CHAY. Khong khoi dong them ban thu hai.' -ForegroundColor Yellow
    Write-Host '      Neu quen PIN, hay dung bridge cu (Stop-Process -Name node) roi chay lai script.' -ForegroundColor Yellow
} else {
    if (-not $Pin) { $Pin = '{0:D6}' -f (Get-Random -Minimum 0 -Maximum 1000000) }
    $env:VIBE_PIN = $Pin
    $env:VIBE_ROOT = $Root
    $env:VIBE_BIND = $(if ($Lan) { '0.0.0.0' } else { '127.0.0.1' })

    if ($Lan) {
        $ruleName = 'VibeCode_Bridge_9334'
        if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
            try {
                New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
                    -LocalPort 9334 -RemoteAddress LocalSubnet -Profile Private | Out-Null
                Write-Host '  [OK] Da mo tuong lua cong 9334 chi cho mang con noi bo (Private).' -ForegroundColor Green
            } catch {
                Write-Host '  [INFO] Khong tao duoc luat tuong lua (can quyen Administrator).' -ForegroundColor Yellow
            }
        }
    }

    Write-Host '[2/4] Khoi dong Host Bridge 9334...' -ForegroundColor Green
    Start-Process node -ArgumentList $bridgeFile -WindowStyle Hidden | Out-Null
    $up = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Milliseconds 400
        if (Test-BridgePort) { $up = $true; break }
    }
    if (-not $up) { Write-Host '[LOI] Bridge khong khoi dong duoc.' -ForegroundColor Red; exit 1 }
    Write-Host "  [OK] Bridge san sang. PIN cua phien nay: $Pin" -ForegroundColor Cyan
    Write-Host "  Thu muc goc: $Root" -ForegroundColor Gray
}

# 3. Tunnel (tuy chon)
if ($Tunnel) {
    if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
        if (Get-Process -Name cloudflared -ErrorAction SilentlyContinue) {
            Write-Host '[3/4] cloudflared dang chay, khong khoi dong them.' -ForegroundColor Yellow
        } else {
            Write-Host '[3/4] Khoi dong Cloudflare Quick Tunnel...' -ForegroundColor Green
            Start-Process cloudflared -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:9334'
        }
    } else {
        Write-Host "[3/4] Chua cai cloudflared: winget install Cloudflare.cloudflared" -ForegroundColor Yellow
    }
} else {
    Write-Host '[3/4] Bo qua Tunnel (dung -Tunnel de bat).' -ForegroundColor Gray
}

Write-Host '[4/4] Hoan tat.' -ForegroundColor Green
Write-Host ">>> [SAN SANG] Nhap PIN o tren vao giao dien de ket noi.`n" -ForegroundColor Green


