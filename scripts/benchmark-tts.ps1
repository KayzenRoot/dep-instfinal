param(
  [Parameter(Mandatory = $true)][string]$PlanPath,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [string]$WorkingDirectory = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$baseline = Get-Process -Name node, piper, ffmpeg -ErrorAction SilentlyContinue
$baselineMemory = ($baseline | Measure-Object WorkingSet64 -Sum).Sum
$baselineCpu = ($baseline | Measure-Object CPU -Sum).Sum
$started = Get-Date
$log = Join-Path $OutputDir 'benchmark-process.log'
$previousPlan = $env:TTS_PLAN_FILE
$previousOutput = $env:TTS_OUTPUT_DIR
$env:TTS_PLAN_FILE = $PlanPath
$env:TTS_OUTPUT_DIR = $OutputDir
try {
  $process = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/d', '/s', '/c', 'npx tsx scripts/narration-tts.ts' `
    -WorkingDirectory $WorkingDirectory -PassThru -NoNewWindow `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  $peakMemory = 0
  $peakCpu = 0
  while (-not $process.HasExited) {
    $running = Get-Process -Name node, piper, ffmpeg -ErrorAction SilentlyContinue
    if ($running) {
      $memory = ($running | Measure-Object WorkingSet64 -Sum).Sum
      $cpu = ($running | Measure-Object CPU -Sum).Sum
      if ($memory -gt $peakMemory) { $peakMemory = $memory }
      if ($cpu -gt $peakCpu) { $peakCpu = $cpu }
    }
    Start-Sleep -Milliseconds 100
  }
  $process.WaitForExit()
  $elapsedMs = [math]::Round(((Get-Date) - $started).TotalMilliseconds)
  $report = [ordered]@{
    schemaVersion = 1
    platform = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    processorCount = [Environment]::ProcessorCount
    elapsedMs = $elapsedMs
    exitCode = $process.ExitCode
    baselineMemoryBytes = [math]::Max(0, $baselineMemory)
    peakWorkingSetBytes = $peakMemory
    incrementalPeakMemoryBytes = [math]::Max(0, $peakMemory - $baselineMemory)
    incrementalCpuSeconds = [math]::Max(0, [math]::Round($peakCpu - $baselineCpu, 2))
  }
  $report | ConvertTo-Json | Set-Content -Path (Join-Path $OutputDir 'benchmark.json') -Encoding utf8
  $report | ConvertTo-Json
} finally {
  $env:TTS_PLAN_FILE = $previousPlan
  $env:TTS_OUTPUT_DIR = $previousOutput
}
