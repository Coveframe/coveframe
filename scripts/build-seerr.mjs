// Build-time only: official Seerr source and a private bundled Node 22 runtime.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,cp,access,copyFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {poolSeerrDependencies} from '../src/package-dedupe.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'artifacts/upstream/seerr-3.5.1');
const revision='564bfb08b54caa374bddaf820abfd226e5e69151';
const output=resolve(process.argv[2]||join(root,'artifacts/seerr-windows-3.5.1'));
const nodeDir=join(root,'artifacts/node22/node-v22.23.4-win-x64');
const nodeSha='cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20';
const run=promisify(execFile);
const execute=(file,args,cwd=source,env={})=>run(file,args,{cwd,env:{...process.env,...env},windowsHide:true,timeout:900000,maxBuffer:4*1024*1024});
const resumeAssets=process.argv.includes('--resume-assets');
try{await access(output);if(!resumeAssets)throw Error('Output exists. Preserve it and choose a fresh directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
try{await access(source);}catch{await execute('git',['clone','--depth','1','--branch','v3.5.1','https://github.com/seerr-team/seerr.git',source],root);}
if((await execute('git',['rev-parse','HEAD'])).stdout.trim()!==revision)throw Error('Unexpected Seerr revision');
const nodeArchive=join(root,'artifacts/downloads/node-v22.23.4-win-x64.zip');
if(createHash('sha256').update(await readFile(nodeArchive)).digest('hex')!==nodeSha)throw Error('Obtain the official Node 22.23.4 Windows x64 ZIP and verify its checksum first.');
await mkdir(output,{recursive:true});
const prepared=process.argv.indexOf('--prepared');
// Same unused frontend trees excluded by Seerr's official Dockerfile.
const bundleFile=path=>!/[\\/]node_modules[\\/](?:ace-builds[\\/](?:src-noconflict|src|src-min)|country-flag-icons[\\/](?:react|string|1x1)|@heroicons[\\/]react[\\/]16)(?:[\\/]|$)/.test(path);
let production;
if(resumeAssets){
  const pkg=JSON.parse((await readFile(join(output,'runtime/package.json'),'utf8')).replace(/^\uFEFF/,''));
  if(pkg.version!=='3.5.1')throw Error('Only the prepared Seerr 3.5.1 build can resume.');
  await writeFile(join(output,'runtime/package.json'),JSON.stringify(pkg,null,2));
}else if(prepared<0){
  const config=join(source,'next.config.ts');let text=await readFile(config,'utf8');
  if(!text.includes('outputFileTracingRoot: process.cwd()'))text=text.replace('const nextConfig: NextConfig = {','const nextConfig: NextConfig = {\n  outputFileTracingRoot: process.cwd(),').replace('turbopack: {','turbopack: {\n    root: process.cwd(),');
  await writeFile(config,text);
  const env={PATH:nodeDir+';'+process.env.PATH,CYPRESS_INSTALL_BINARY:'0',NEXT_TELEMETRY_DISABLED:'1',COMMIT_TAG:'v3.5.1'};
  const npm=join(nodeDir,'node_modules/npm/bin/npm-cli.js');
  const pnpm=(args,cwd)=>execute(join(nodeDir,'node.exe'),[npm,'exec','--yes','--package','pnpm@10.24.0','--','pnpm',...args],cwd,env);
  await pnpm(['install','--frozen-lockfile'],source);await pnpm(['run','build'],source);
  const runtime=join(output+'-deps','runtime');await mkdir(runtime,{recursive:true});
  for(const name of ['package.json','pnpm-lock.yaml','.npmrc'])await copyFile(join(source,name),join(runtime,name));
  const pkg=JSON.parse(await readFile(join(runtime,'package.json'),'utf8'));pkg.scripts={};await writeFile(join(runtime,'package.json'),JSON.stringify(pkg,null,2));
  await pnpm(['install','--prod','--frozen-lockfile','--node-linker=hoisted'],runtime);
  production=runtime;
}else production=join(resolve(process.argv[prepared+1]),'runtime');
const runtime=join(output,'runtime');
if(resumeAssets) {
  // Existing dependency stage was already moved; only compiled assets are retried.
}else if(process.argv.includes('--consume-prepared')) {
  const artifactRoot=resolve(root,'artifacts')+'\\';
  if(!resolve(production).startsWith(artifactRoot)||!resolve(runtime).startsWith(artifactRoot))throw Error('Prepared runtime move must stay inside this repository artifacts directory.');
  await rename(production,runtime);
}else await cp(production,runtime,{recursive:true,filter:bundleFile});
const linksPath=join(output,'runtime-links.json');
try{await access(linksPath);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(linksPath,JSON.stringify(await poolSeerrDependencies(join(runtime,'node_modules'),output)));}
// Exclude compiler caches and absolute tracing manifests; keep .next itself for production.
for(const name of ['dist','.next','public','next.config.ts','seerr-api.yml','LICENSE'])await cp(join(source,name),join(runtime,name),{recursive:true,dereference:true,filter:path=>!path.includes('.next\\cache')&&!path.includes('.next/cache')&&!path.endsWith('.nft.json')});
await writeFile(join(runtime,'committag.json'),JSON.stringify({commitTag:'v3.5.1'}));
await mkdir(join(output,'node'),{recursive:true});
await copyFile(join(nodeDir,'node.exe'),join(output,'node/node.exe'));await copyFile(join(nodeDir,'LICENSE'),join(output,'node/LICENSE.txt'));
await copyFile(join(source,'LICENSE'),join(output,'LICENSE-Seerr'));
await writeFile(join(output,'media-hub.patch'),(await execute('git',['diff','--','next.config.ts'])).stdout);
await copyFile(fileURLToPath(import.meta.url),join(output,'build-seerr.mjs'));
await copyFile(join(root,'src/package-dedupe.mjs'),join(output,'package-dedupe.mjs'));
await copyFile(join(root,'src/package-links.mjs'),join(output,'package-links.mjs'));
await writeFile(join(output,'BUILD.txt'),`Seerr v3.5.1, MIT\nhttps://github.com/seerr-team/seerr\nRevision: ${revision}\nNode 22.23.4 Windows x64, official ZIP SHA256 ${nodeSha}\nBuild: apply media-hub.patch; use Node 22 with pnpm 10.24; pnpm install --frozen-lockfile; pnpm run build. Install production dependencies with the same package.json and lockfile, scripts cleared, pnpm install --prod --frozen-lockfile --node-linker=hoisted. Copy dist, .next (excluding cache), public, next.config.ts, seerr-api.yml and LICENSE into runtime. Bundle node.exe and its LICENSE from the verified Node ZIP.\nRun with NODE_ENV=production HOST=127.0.0.1 PORT=18802 CONFIG_DIRECTORY=<private folder>. No user data or tokens are included.\n`);
const archive=process.argv.includes('--archive')?resolve(process.argv[process.argv.indexOf('--archive')+1]):output+'.zip';
const ps="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;$p=([Console]::In.ReadToEnd()|ConvertFrom-Json);[IO.Compression.ZipFile]::CreateFromDirectory($p.source,$p.archive,[IO.Compression.CompressionLevel]::Fastest,$false)";
await new Promise((yes,no)=>{const child=execFile(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,timeout:1200000},error=>error?no(error):yes());child.stdin.end(JSON.stringify({source:output,archive}));});
process.stdout.write(JSON.stringify({archive,sha256:createHash('sha256').update(await readFile(archive)).digest('hex')})+'\n');
