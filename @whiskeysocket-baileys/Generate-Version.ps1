$ErrorActionPreference = "Stop"

$zipFile   = "WhatsAppLibrary.zip"
$jsFile    = "server.js"
$appFile   = "Badel Soft Messages.zip"                 # 👈 new – rename if your app zip has a different name
$jsonFile  = "version.json"

# ----------------------------------------------------------------------
# Helper: check if a file exists and exit if missing (except app which is optional?)
# ----------------------------------------------------------------------
function Check-File {
    param([string]$Path, [string]$Name)
    if (!(Test-Path $Path)) {
        Write-Host "$Name not found" -ForegroundColor Red
        Read-Host -Prompt "Press Enter to exit..."
        exit 1
    }
}

Check-File $zipFile "WhatsAppLibrary.zip"
Check-File $jsFile  "server.js"
# For app, we require it, but you could make it optional – uncomment if you want to enforce:
# Check-File $appFile "Badel Soft Messages.zip"

# ----------------------------------------------------------------------
# Generate date‑based version
# ----------------------------------------------------------------------
$now = Get-Date
$newVersion = $now.ToString("yy.M.d")
$createdDate = $now.ToString("yyyy-MM-dd hh:mm tt")

# ----------------------------------------------------------------------
# Compute hashes and sizes
# ----------------------------------------------------------------------
$zipHash = (Get-FileHash $zipFile -Algorithm SHA256).Hash
$jsHash  = (Get-FileHash $jsFile  -Algorithm SHA256).Hash

$zipSize = (Get-Item $zipFile).Length
$jsSize  = (Get-Item $jsFile).Length

# App file – handle gracefully if missing (we'll still create the object with empty values)
$appHash = $null
$appSize = 0
$appExists = Test-Path $appFile
if ($appExists) {
    $appHash = (Get-FileHash $appFile -Algorithm SHA256).Hash
    $appSize = (Get-Item $appFile).Length
}

# ----------------------------------------------------------------------
# Load or create version.json
# ----------------------------------------------------------------------
if (Test-Path $jsonFile) {
    $json = Get-Content $jsonFile | ConvertFrom-Json
}
else {
    $json = [ordered]@{
        engine   = [ordered]@{ version = ""; library = "baileys"; sha256 = ""; size = 0 }
        serverJs = [ordered]@{ version = ""; sha256 = ""; size = 0 }
        app      = [ordered]@{ version = ""; sha256 = ""; size = 0 }  # 👈 new
        created  = ""
    }
}

# Ensure the app object exists even if it wasn't in the previous version
if ($null -eq $json.app) {
    $json | Add-Member -MemberType NoteProperty -Name "app" -Value ([ordered]@{ version = ""; sha256 = ""; size = 0 })
}

# ----------------------------------------------------------------------
# Track changes for each component
# ----------------------------------------------------------------------
$engineChanged = $json.engine.sha256 -ne $zipHash
$jsChanged     = $json.serverJs.sha256 -ne $jsHash
$appChanged    = $false

if ($appExists) {
    # If app file exists, compare with stored hash
    $appChanged = $json.app.sha256 -ne $appHash
}
else {
    # If app file does not exist, but there is a stored app hash, consider it changed (removed) – we'll clear it.
    if ($json.app.sha256 -ne "") {
        $appChanged = $true
    }
}

# ----------------------------------------------------------------------
# Update each component if changed
# ----------------------------------------------------------------------
if ($engineChanged) {
    Write-Host "Engine changed → updating metadata" -ForegroundColor Yellow
    $json.engine.version = $newVersion
    $json.engine.sha256  = $zipHash
    $json.engine.size    = $zipSize
}

if ($jsChanged) {
    Write-Host "server.js changed → updating metadata" -ForegroundColor Yellow
    $json.serverJs.version = $newVersion
    $json.serverJs.sha256  = $jsHash
    $json.serverJs.size    = $jsSize
}

if ($appChanged) {
    Write-Host "app.zip changed → updating metadata" -ForegroundColor Yellow
    if ($appExists) {
        $json.app.version = $newVersion
        $json.app.sha256  = $appHash
        $json.app.size    = $appSize
    } else {
        # If the app file is missing, clear the app metadata (so it won't be considered an update)
        $json.app.version = ""
        $json.app.sha256  = ""
        $json.app.size    = 0
    }
}

# ----------------------------------------------------------------------
# Update created date if anything changed
# ----------------------------------------------------------------------
if ($engineChanged -or $jsChanged -or $appChanged) {
    $json.created = $createdDate
    $json | ConvertTo-Json -Depth 5 | Out-File $jsonFile -Encoding UTF8
    Write-Host "version.json updated successfully" -ForegroundColor Green
}
else {
    Write-Host "No changes detected. version.json unchanged." -ForegroundColor Cyan
}

# ----------------------------------------------------------------------
# Keep window open
# ----------------------------------------------------------------------
Write-Host "`nScript finished."
Read-Host -Prompt "Press Enter to close this window..."
