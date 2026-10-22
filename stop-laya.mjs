import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MODELS } from './server.mjs';
import { unloadSessionModels } from './ollama-session.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// Identify this checkout by its Electron executable, then include only its
// verified launcher ancestors. Never stop processes by a shared image name.
const command = String.raw`
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath($env:LAYA_STOP_ROOT)
$executable = Join-Path $project 'node_modules\electron\dist\electron.exe'
$processes = @(Get-CimInstance Win32_Process)
$targets = @{}
foreach ($item in $processes) {
  if ($item.ExecutablePath -eq $executable) { $targets[[int]$item.ProcessId] = $item }
}
foreach ($item in @($targets.Values)) {
  $parent = $processes | Where-Object { $_.ProcessId -eq $item.ParentProcessId } | Select-Object -First 1
  if ($parent.Name -eq 'node.exe' -and $parent.CommandLine -match '(?:^|\s)["'']?(?:[^"'']*\\)?desktop\.mjs["'']?\s*$') {
    $targets[[int]$parent.ProcessId] = $parent
    $wrapper = $processes | Where-Object { $_.ProcessId -eq $parent.ParentProcessId } | Select-Object -First 1
    if ($wrapper.Name -eq 'cmd.exe' -and $wrapper.CommandLine -match '(?i)/c\s+"?\.\\Start-Laya\.cmd"?\s*$') {
      $targets[[int]$wrapper.ProcessId] = $wrapper
      $launcher = $processes | Where-Object { $_.ProcessId -eq $wrapper.ParentProcessId } | Select-Object -First 1
      if ($launcher.Name -match '^python(?:w|\d+)?\.exe$' -and ($launcher.CommandLine -replace '/', '\') -match ([regex]::Escape((Join-Path $project 'run.py')) + '["'']?\s*$')) {
        $targets[[int]$launcher.ProcessId] = $launcher
      }
    }
  }
}
$stopped = @()
foreach ($item in @($targets.Values)) {
  $live = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $item.ProcessId)
  if ($live -and $live.CreationDate -eq $item.CreationDate -and $live.ExecutablePath -eq $item.ExecutablePath) {
    Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped += [int]$item.ProcessId
  }
}
foreach ($idValue in $stopped) { Wait-Process -Id $idValue -Timeout 10 -ErrorAction SilentlyContinue }
$remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $executable })
if ($remaining.Count) { throw 'Some Laya processes did not stop.' }
Write-Output ('Stopped ' + $stopped.Count + ' Laya process(es).')
`;

try {
  if (process.platform !== 'win32') throw new Error('This stop command requires Windows.');
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile','-NonInteractive','-Command',command], {
    cwd:root, env:{...process.env,LAYA_STOP_ROOT:root}, windowsHide:true, timeout:30000,
  });
  console.log(stdout.trim());
  await unloadSessionModels(MODELS);
} catch (error) {
  console.error(`Could not stop Laya: ${error.stderr?.trim() || error.message}`);
  process.exitCode = 1;
}
