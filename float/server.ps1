param([int]$Port = 35731)

# Cầu nối HTTP cho widget nổi. Chạy ẩn (start-float.bat), trao đổi qua file trong %TEMP%\forest-float.
$ErrorActionPreference = "Stop"

$dir = Join-Path $env:TEMP "forest-float"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stateFile = Join-Path $dir "state.json"
$cmdFile = Join-Path $dir "cmd.json"
foreach ($f in @($stateFile, $cmdFile)) { if (Test-Path $f) { Remove-Item $f -Force } }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

function Send-Json($res, [int]$status, [string]$json) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $res.StatusCode = $status
    $res.ContentType = "application/json; charset=utf-8"
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
}

Write-Host "Forest float bridge: http://127.0.0.1:$Port  (state: $stateFile)"

while ($listener.IsListening) {
    try { $ctx = $listener.GetContext() } catch { break }
    $req = $ctx.Request
    $res = $ctx.Response
    $res.Headers.Add("Access-Control-Allow-Origin", "*")
    $res.Headers.Add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    $res.Headers.Add("Access-Control-Allow-Headers", "content-type")
    $res.Headers.Add("Cache-Control", "no-store")

    $path = $req.Url.AbsolutePath
    if ($req.HttpMethod -eq "OPTIONS") { Send-Json $res 204 ""; continue }

    switch ("$($req.HttpMethod) $path") {
        "GET /health" { Send-Json $res 200 '{"ok":true}' }
        "POST /state" {
            $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $reader.Close()
            if ($body.Trim()) { [IO.File]::WriteAllText($stateFile, $body) }
            Send-Json $res 200 '{"ok":true}'
        }
        "GET /poll" {
            if (Test-Path $cmdFile) {
                $json = Get-Content -Raw -Path $cmdFile
                Remove-Item $cmdFile -Force -ErrorAction SilentlyContinue
                Send-Json $res 200 $json
            } else {
                Send-Json $res 200 '{}'
            }
        }
        default { Send-Json $res 404 '{"error":"not found"}' }
    }
}
