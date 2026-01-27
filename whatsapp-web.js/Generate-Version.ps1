$ErrorActionPreference = "Stop"

$zipFile = "WhatsAppLibrary.zip"
$jsFile  = "server.js"
$jsonFile = "version.json"

if (!(Test-Path $zipFile)) {
    Write-Host "WhatsAppServer.zip not found" -ForegroundColor Red
    Read-Host -Prompt "Press Enter to exit..." # Add this here too!
    exit 1
}

if (!(Test-Path $jsFile)) {
    Write-Host "server.js not found" -ForegroundColor Red
    Read-Host -Prompt "Press Enter to exit..." # Add this here too!
    exit 1
}

# Generate date-based version
$now = Get-Date
$newVersion = $now.ToString("yy.M.d")
$createdDate = $now.ToString("yyyy-MM-dd hh:mm tt")

# Compute hashes
$zipHash = (Get-FileHash $zipFile -Algorithm SHA256).Hash
$jsHash  = (Get-FileHash $jsFile  -Algorithm SHA256).Hash

# Sizes
$zipSize = (Get-Item $zipFile).Length
$jsSize  = (Get-Item $jsFile).Length

# Load or create version.json
if (Test-Path $jsonFile) {
    $json = Get-Content $jsonFile | ConvertFrom-Json
}
else {
    $json = [ordered]@{
        engine = [ordered]@{
            version = ""
            library = "whatsapp-web.js"
            minServerJsVersion = ""
            sha256 = ""
            size = 0
        }
        serverJs = [ordered]@{
            version = ""
            sha256 = ""
            size = 0
        }
        created = ""
    }
}

# Track changes
$engineChanged = $json.engine.sha256 -ne $zipHash
$jsChanged     = $json.serverJs.sha256 -ne $jsHash

# Update engine if changed
if ($engineChanged) {
    Write-Host "Engine changed → updating metadata" -ForegroundColor Yellow
    $json.engine.version = $newVersion
    $json.engine.sha256  = $zipHash
    $json.engine.size    = $zipSize
    $json.engine.minServerJsVersion = $newVersion
}

# Update server.js if changed
if ($jsChanged) {
    Write-Host "server.js changed → updating metadata" -ForegroundColor Yellow
    $json.serverJs.version = $newVersion
    $json.serverJs.sha256  = $jsHash
    $json.serverJs.size    = $jsSize
}

# Update created date if anything changed
if ($engineChanged -or $jsChanged) {
    $json.created = $createdDate
    $json | ConvertTo-Json -Depth 5 | Out-File $jsonFile -Encoding UTF8
    Write-Host "version.json updated successfully" -ForegroundColor Green
}
else {
    Write-Host "No changes detected. version.json unchanged." -ForegroundColor Cyan
}

# --- This part keeps the window open ---
Write-Host "`nScript finished."
Read-Host -Prompt "Press Enter to close this window..."