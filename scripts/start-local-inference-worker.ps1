$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectDirectory
$logDirectory = Join-Path $projectDirectory 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$workerProcess = Start-Process -FilePath $nodeExecutable `
    -ArgumentList @('--import', 'tsx', 'scripts/local-inference-worker.ts', '--loop') `
    -WorkingDirectory $projectDirectory -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardOutput (Join-Path $logDirectory 'local-inference-worker.log') `
    -RedirectStandardError (Join-Path $logDirectory 'local-inference-worker.error.log')
exit $workerProcess.ExitCode
