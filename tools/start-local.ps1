[CmdletBinding()]
param(
 [switch]$Build,
 [switch]$Check,
 [string]$RepositoryRoot=(Split-Path -Parent $PSScriptRoot),
 [string]$CodexModel='gpt-6.1-sol',
 [string]$CodexProxy='http://127.0.0.1:10808',
 [string]$AuthHome=(Join-Path $env:USERPROFILE '.codex')
)
$ErrorActionPreference='Stop'
function To-WslPath([string]$Value) {
 $full=[IO.Path]::GetFullPath($Value)
 if($full -notmatch '^([A-Za-z]):\\(.*)$'){throw 'Use a local Windows drive path.'}
 return '/mnt/'+$Matches[1].ToLower()+'/'+$Matches[2].Replace('\','/')
}
function Quote-Argument([string]$Value) {
 if($Value.Contains('"') -or $Value.Contains("`n") -or $Value.Contains("`r")){throw 'Unsupported quote/newline in argument.'}
 if($Value -match '\s' -or $Value.Length -eq 0){return '"'+$Value+'"'}
 return $Value
}
$root=To-WslPath $RepositoryRoot
$script=$root+'/tools/start-local.sh'
if($Check){& wsl.exe -u root -- bash $script check $root; if($LASTEXITCODE -ne 0){throw 'Local verification failed.'}; return}
$cli=Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Recurse -File -Filter codex.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $cli){throw 'Installed Codex CLI was not found. Open Codex and sign in first.'}
if($Build){& wsl.exe -u root -- bash $script build $root; if($LASTEXITCODE -ne 0){throw 'Build failed; running services were not stopped.'}}
$node=(Get-Command node.exe -ErrorAction Stop).Source
$arguments=@('-u','root','--','bash',$script,'start',$root,(To-WslPath $cli.FullName),(To-WslPath $AuthHome),$CodexModel,$CodexProxy,(To-WslPath $node))
 $logRoot=Join-Path $env:LOCALAPPDATA 'ElseLife\logs'
 New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
 $launch=Start-Process -FilePath 'wsl.exe' -ArgumentList (($arguments | ForEach-Object {Quote-Argument $_}) -join ' ') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'launcher.log') -RedirectStandardError (Join-Path $logRoot 'launcher-error.log') -PassThru
$launch.WaitForExit()
if($launch.ExitCode -ne 0){throw 'Startup refused or failed. Run -Check and inspect /root/.cache/elselife-local/logs. No existing process was stopped.'}
for($attempt=0;$attempt -lt 20;$attempt++){
 Start-Sleep -Milliseconds 500
 & wsl.exe -u root -- bash $script check $root
 if($LASTEXITCODE -eq 0){Write-Host 'ElseLife ready: http://127.0.0.1:18080';return}
}
throw 'Services did not become ready. Inspect /root/.cache/elselife-local/logs.'
