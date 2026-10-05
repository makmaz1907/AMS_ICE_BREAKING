@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$pids = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if ($pids.Count -eq 0) { Write-Host '3000 portunda çalışan sunucu bulunamadı.' } else { $pids | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('3000 portundaki süreç kapatıldı. PID: ' + $_) } }"
pause
