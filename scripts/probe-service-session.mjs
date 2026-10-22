// Explicit integration experiment; never discovered by the unit-test command.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const cwd=fileURLToPath(new URL('..',import.meta.url));
let readyResolve, readyReject, output='';
const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
const capture=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',
  fileURLToPath(new URL('./Capture-ServiceGpu.ps1',import.meta.url)),'-DurationSeconds','25','-ReadySignal'],
  {cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
capture.stdout.on('data',chunk=>{output+=chunk; if(output.includes('MEDIAHUB_CAPTURE_READY')) readyResolve();});
const finished=new Promise((resolve,reject)=>{
  capture.on('error',reject);
  capture.on('close',code=>code===0?resolve():reject(new Error('GPU capture failed')));
});
finished.catch(readyReject);
const timeout=setTimeout(()=>{capture.kill();readyReject(new Error('GPU capture readiness timed out'));},15000);
let probe;
try {
  await ready; clearTimeout(timeout);
  probe=JSON.parse((await execute(process.execPath,['scripts/probe-lab.mjs'],
    {cwd,windowsHide:true,timeout:65000,maxBuffer:65536})).stdout);
  await finished;
  const gpu=JSON.parse(output.split(/\r?\n/).findLast(line=>line.startsWith('{')));
  const report={schemaVersion:1,at:new Date().toISOString(),platform:'Windows Pro',homeCompatibility:'unverified',
    qualified:false,beforeSignIn:'not-tested',probe,gpu};
  const destination=new URL(`../artifacts/service-session-${Date.now()}.json`,import.meta.url);
  await writeFile(destination,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:probe.status,serviceIdentity:gpu.serviceIdentity,sessionId:gpu.sessionId,
    ffmpegProcesses:gpu.ffmpegProcesses,gpuSamples:gpu.gpuSamples.length,artifact:fileURLToPath(destination)}));
} finally { clearTimeout(timeout); if(capture.exitCode===null) capture.kill(); }
