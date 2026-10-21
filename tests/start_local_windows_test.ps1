# Real Windows child processes exercise the launcher's redirected exit-code path.
# Service discovery and readiness are isolated; this test never starts or stops services.
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'Run this regression with Windows PowerShell.'}
$launcher=Join-Path (Split-Path -Parent $PSScriptRoot) 'tools/start-local.ps1'
$temporaryRoot=Join-Path ([IO.Path]::GetTempPath()) ('elselife-launcher-test-'+[Guid]::NewGuid().ToString('N'))
$oldLocalAppData=$env:LOCALAPPDATA
New-Item -ItemType Directory -Path (Join-Path $temporaryRoot 'OpenAI/Codex/bin') -Force | Out-Null
New-Item -ItemType File -Path (Join-Path $temporaryRoot 'OpenAI/Codex/bin/codex.exe') | Out-Null

function Invoke-LauncherCase([int]$ExpectedExit) {
 $state=[pscustomobject]@{Launches=0;Checks=0;Process=$null}
 function Get-Command([string]$Name) {
  if($Name -ne 'node.exe'){throw 'Unexpected command discovery.'}
  [pscustomobject]@{Source=$env:ComSpec}
 }
 function Start-Process {
  param($FilePath,$ArgumentList,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
  if($FilePath -ne 'wsl.exe' -or $WindowStyle -ne 'Hidden' -or -not $PassThru){throw 'Unexpected launcher process options.'}
  $state.Launches++
  $process=Microsoft.PowerShell.Management\Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /c exit '+$ExpectedExit) -WindowStyle Hidden -RedirectStandardOutput $RedirectStandardOutput -RedirectStandardError $RedirectStandardError -PassThru
  $state.Process=$process
  return $process
 }
 function wsl.exe {
  $state.Checks++
  $global:LASTEXITCODE=0
 }
 $failure=$null
 try { & $launcher -RepositoryRoot $temporaryRoot -AuthHome $temporaryRoot } catch { $failure=$_.Exception.Message }
 try {
  if($state.Launches -ne 1){throw 'Expected exactly one real child process.'}
  if($ExpectedExit -eq 0){
   if($null -ne $failure){throw ('Successful launcher was rejected: '+$failure)}
   if($state.Checks -ne 1){throw 'Successful launcher did not perform readiness verification.'}
  } else {
   if($null -eq $failure -or -not $failure.StartsWith('Startup refused or failed.')){throw 'Nonzero launcher exit was not rejected.'}
   if($state.Checks -ne 0){throw 'Failed launcher incorrectly continued to readiness verification.'}
  }
  if($state.Process.ExitCode -ne $ExpectedExit){throw 'Launcher did not retain the actual child exit code.'}
  Write-Host ('PASS: redirected child exit '+$ExpectedExit)
 } finally {
  if($null -ne $state.Process){$state.Process.Dispose()}
 }
}

try {
 $env:LOCALAPPDATA=$temporaryRoot
 foreach($attempt in 1..3){
  Invoke-LauncherCase 0
  Invoke-LauncherCase 7
 }
} finally {
 $env:LOCALAPPDATA=$oldLocalAppData
 $resolvedTemporaryRoot=[IO.Path]::GetFullPath($temporaryRoot)
 $resolvedParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
 if(-not $resolvedTemporaryRoot.StartsWith($resolvedParent,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedTemporaryRoot) -notlike 'elselife-launcher-test-*'){
  throw 'Refusing to remove a path outside the test temporary directory.'
 }
 Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
}
