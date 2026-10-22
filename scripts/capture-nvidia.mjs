import {execFile} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {parseEncoderSessions} from '../src/nvidia.mjs';
const startedAt=new Date().toISOString();
const result=await new Promise(resolve=>execFile('C:\\Windows\\System32\\nvidia-smi.exe',['encodersessions','-l','1'],
  {windowsHide:true,timeout:45000,maxBuffer:65536},(error,stdout)=>resolve({error,stdout})));
const report={schemaVersion:1,startedAt,endedAt:new Date().toISOString(),qualified:false,
  status:result.error && !result.error.killed?'unavailable':'captured',sessions:parseEncoderSessions(result.stdout||'')};
await writeFile(new URL(`../artifacts/nvidia-sessions-${Date.now()}.json`,import.meta.url),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({status:report.status,samples:report.sessions.length,processIds:[...new Set(report.sessions.map(s=>s.processId))]}));
