import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const launcher=fileURLToPath(new URL('../start-learning.ps1',import.meta.url));
function run(script){
  const source=`$ErrorActionPreference='Stop'; . '${launcher.replaceAll("'","''")}'; ${script}`;
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout.trim();
}
test('BAT remains ASCII CRLF and invokes the guarded launcher',async()=>{
  const batch=await readFile(new URL('../启动学习.bat',import.meta.url));
  assert.ok([...batch].every(x=>x<128));assert.ok(!batch.toString().replaceAll('\r\n','').includes('\n'));
  assert.ok(batch.toString().includes('start-learning.ps1'));
  const ps=await readFile(launcher);assert.deepEqual([...ps.subarray(0,3)],[239,187,191],'Windows PowerShell reads Chinese messages correctly');
});
test('launcher ownership checks accept exact script paths and reject unrelated commands',{skip:process.platform!=='win32'},()=>{
  const cases=JSON.parse(run(`
    $server='C:\\Study App\\server.mjs';$helper='C:\\Study App\\start-learning.ps1';$batch='C:\\Study App\\启动学习.bat';
    @(
      (Test-AppServer ([pscustomobject]@{Name='node.exe';CommandLine='"C:\\Program Files\\nodejs\\node.exe" "C:\\Study App\\server.mjs" --open'}) $server),
      (Test-AppServer ([pscustomobject]@{Name='node.exe';CommandLine='node.exe "C:\\Different App\\server.mjs"'}) $server),
      (Test-AppServer ([pscustomobject]@{Name='node.exe';CommandLine='node.exe -e "C:\\Study App\\server.mjs"'}) $server),
      (Test-AppLauncher ([pscustomobject]@{Name='powershell.exe';CommandLine='powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Study App\\start-learning.ps1"'}) $helper),
      (Test-AppLauncher ([pscustomobject]@{Name='powershell.exe';CommandLine='powershell.exe -Command "C:\\Study App\\start-learning.ps1"'}) $helper),
      (Test-AppBatchWindow ([pscustomobject]@{Name='cmd.exe';CommandLine='cmd.exe /d /s /c ""C:\\Study App\\启动学习.bat""'}) $batch),
      (Test-AppBatchWindow ([pscustomobject]@{Name='cmd.exe';CommandLine='cmd.exe /k "C:\\Study App\\启动学习.bat"'}) $batch),
      (Test-AppBatchWindow ([pscustomobject]@{Name='cmd.exe';CommandLine='cmd.exe /c "C:\\Study App\\启动学习.bat" & echo unrelated'}) $batch),
      (Test-AppBatchWindow ([pscustomobject]@{Name='cmd.exe';CommandLine='cmd.exe /c "C:\\Different App\\启动学习.bat"'}) $batch)
    ) | ConvertTo-Json -Compress
  `));
  assert.deepEqual(cases,[true,false,false,true,false,true,false,false,false]);
});
test('relative process paths cannot inherit launcher cwd and claim unrelated processes',{skip:process.platform!=='win32'},()=>{
  const cases=JSON.parse(run(`
    Set-Location '${fileURLToPath(new URL('../',import.meta.url)).replaceAll("'","''")}';
    $server=Join-Path (Get-Location).Path 'server.mjs';$helper=Join-Path (Get-Location).Path 'start-learning.ps1';$batch=Join-Path (Get-Location).Path '启动学习.bat';
    @(
      (Test-AppServer ([pscustomobject]@{Name='node.exe';CommandLine='node.exe server.mjs'}) $server),
      (Test-AppServer ([pscustomobject]@{Name='node.exe';CommandLine='node.exe .\\server.mjs'}) $server),
      (Test-AppServer ([pscustomobject]@{Name='node.exe';CommandLine='node.exe C:server.mjs'}) $server),
      (Test-AppLauncher ([pscustomobject]@{Name='powershell.exe';CommandLine='powershell.exe -File start-learning.ps1'}) $helper),
      (Test-AppBatchWindow ([pscustomobject]@{Name='cmd.exe';CommandLine='cmd.exe /c 启动学习.bat'}) $batch)
    ) | ConvertTo-Json -Compress
  `));
  assert.deepEqual(cases,[false,false,false,false,false]);
});
