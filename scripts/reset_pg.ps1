Write-Output "Stopping any postgres processes..."
Get-Process -Name postgres -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | ForEach-Object { Write-Output ("Stopping PID: " + $_); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
$pidfile = 'C:\Program Files\PostgreSQL\18\data\postmaster.pid'
if (Test-Path $pidfile) {
    Write-Output "Removing postmaster.pid"
    Remove-Item $pidfile -Force
} else {
    Write-Output "postmaster.pid not present"
}
Write-Output "Running pg_resetwal -f"
& 'C:\Program Files\PostgreSQL\18\bin\pg_resetwal.exe' -D 'C:\Program Files\PostgreSQL\18\data' -f
Write-Output "Starting Windows service postgresql-x64-18"
Start-Service -Name 'postgresql-x64-18' -Verbose -ErrorAction Stop
Get-Service -Name 'postgresql-x64-18' | Select-Object Name,Status | Format-List
Write-Output "Done"
