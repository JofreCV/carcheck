# Arranca el servidor de desarrollo y un túnel HTTPS de cloudflared para probar en el móvil.
# La geolocalización y la cámara solo funcionan en HTTPS (o en localhost). El túnel da una URL
# https://….trycloudflare.com con certificado válido, así que el móvil no tiene que instalar nada.
param([int]$Port = 8080)

$root = Split-Path -Parent $PSScriptRoot
$cloudflared = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
if (-not (Test-Path $cloudflared)) { $cloudflared = "cloudflared" }

$server = Start-Process python -ArgumentList "`"$root\tools\devserver.py`" $Port" -PassThru -NoNewWindow
Write-Host "Servidor local: http://localhost:$Port"

try {
    # La URL pública aparece en la salida del túnel ("https://xxxx.trycloudflare.com").
    & $cloudflared tunnel --no-autoupdate --url "http://localhost:$Port" 2>&1 | ForEach-Object {
        $line = "$_"
        if ($line -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            # Texto sin tildes: PowerShell 5 lee este archivo como ANSI y las desfiguraría.
            Write-Host "`n>>> Abre en el movil: $($Matches[0])`n" -ForegroundColor Green
            Set-Content -Path "$root\tools\.tunnel-url" -Value $Matches[0]
        }
    }
}
finally {
    Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
}
