# Legge dal pannello multimediale di Windows (GSMTC) cosa sta suonando
# e stampa una riga JSON ogni ~400 ms. Va eseguito con Windows PowerShell 5.1
# (powershell.exe), non con PowerShell 7 (pwsh), che non carica i tipi WinRT.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    return $task.Result
}

function Emit($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgrType   = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

try {
    $manager = Await ($mgrType::RequestAsync()) $mgrType
} catch {
    Emit @{ type = 'error'; message = "GSMTC non disponibile: $($_.Exception.Message)" }
    exit 1
}

while ($true) {
    try {
        # Preferisci una sessione che sta suonando davvero
        $chosen = $null
        foreach ($s in @($manager.GetSessions())) {
            if ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { $chosen = $s; break }
        }
        if (-not $chosen) { $chosen = $manager.GetCurrentSession() }

        if (-not $chosen) {
            Emit @{ type = 'none' }
        } else {
            $p = Await ($chosen.TryGetMediaPropertiesAsync()) $propsType
            $tl = $chosen.GetTimelineProperties()
            $status = $chosen.GetPlaybackInfo().PlaybackStatus.ToString()

            $pos = $tl.Position.TotalSeconds
            if ($status -eq 'Playing') {
                # La posizione e' "fotografata" a LastUpdatedTime: aggiungi il tempo trascorso
                $elapsed = ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
                if ($elapsed -gt 0 -and $elapsed -lt 36000) { $pos += $elapsed }
            }

            Emit ([ordered]@{
                type     = 'track'
                app      = [string]$chosen.SourceAppUserModelId
                title    = [string]$p.Title
                artist   = [string]$p.Artist
                album    = [string]$p.AlbumTitle
                status   = $status
                position = [double]$pos
                duration = [double]$tl.EndTime.TotalSeconds
            })
        }
    } catch {
        Emit @{ type = 'error'; message = $_.Exception.Message }
    }
    Start-Sleep -Milliseconds 400
}
