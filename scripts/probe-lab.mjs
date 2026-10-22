// This integration probe is fixed to the disposable loopback lab. No production API is used.
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir, access, stat } from 'node:fs/promises';
import { inspectRunLogs } from '../src/transcode.mjs';
import { readLabPlaylist } from '../src/hls.mjs';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const root = 'C:\\ProgramData\\MediaHubLab';
const base = 'http://127.0.0.1:18796';
const machineSecret=process.argv.slice(2).includes('--machine-secret');
if(process.argv.slice(2).some(value=>value!=='--machine-secret')) throw new Error('Unknown lab probe option');
const report = { schemaVersion: 1, platform: 'Windows Pro', homeCompatibility: 'unverified',
  beforeSignIn: 'not-tested', qualified: false, startedAt:new Date().toISOString(), checks: [] };
let token;
async function protectSecret(value, decrypt = false) {
  const code = decrypt ? '$s=[Console]::In.ReadToEnd() | ConvertTo-SecureString; [Net.NetworkCredential]::new("",$s).Password' :
    '$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force; ConvertFrom-SecureString $s';
  return new Promise((resolve,reject) => {
    const child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],
      {windowsHide:true,timeout:15000,maxBuffer:16384},(error,stdout)=>error ? reject(new Error('Lab credential protection failed')) : resolve(stdout.trim()));
    child.stdin.end(value);
  });
}
const auth = 'MediaBrowser Client="Media Hub Qualification", Device="Finite lab probe", DeviceId="mediahub-lab-probe", Version="0.1.0"';
async function request(route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, { method, signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Authorization: auth, ...(token ? {'X-Emby-Token': token} : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`Lab API failed: ${method} ${route.split('?')[0]} (${response.status})`);
  return response.status === 204 ? null : response.json();
}
try {
  const network = await readFile(`${root}\\config\\network.xml`, 'utf8');
  if (!network.includes('<InternalHttpPort>18796</InternalHttpPort>') ||
      !network.includes('<AutoDiscovery>false</AutoDiscovery>') || !network.includes('127.0.0.1')) throw new Error('Lab isolation check failed');
  const info = await request('/System/Info/Public');
  const vaultPath=`${root}\\${machineSecret?'boot-credential.dpapi':'lab-credential.dpapi'}`;
  let password;
  try {
    if(machineSecret) {
      const code='Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine))';
      password=await new Promise((resolve,reject)=>{
        const child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],
          {windowsHide:true,timeout:15000,maxBuffer:16384},(error,stdout)=>error?reject(new Error('Boot lab credential unavailable')):resolve(stdout.trim()));
        readFile(vaultPath,'utf8').then(value=>child.stdin.end(value),()=>{child.stdin.end();reject(new Error('Boot lab credential unavailable'));});
      });
    } else password=await protectSecret(await readFile(vaultPath,'utf8'),true);
  }
  catch(error) {
    if(machineSecret) throw new Error('Boot credential must be explicitly prepared; no account was changed');
    try { await access(vaultPath); throw new Error('Preserve unreadable lab credential; no credential was replaced'); }
    catch(check) { if(check.code!=='ENOENT') throw check; }
    if(info.StartupWizardCompleted) throw new Error('Initialized lab is missing its credential; preserve existing lab data');
    password=randomBytes(32).toString('base64url');
    await writeFile(vaultPath,await protectSecret(password),{flag:'wx'});
  }
  if (!info.StartupWizardCompleted) {
    await request('/Startup/Configuration', 'POST', { ServerName: 'Media Hub Lab (isolated)', UICulture: 'en-US',
      MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' });
    await request('/Startup/User');
    await request('/Startup/User', 'POST', { Name: 'MediaHubLab', Password: password });
    await request('/Startup/RemoteAccess', 'POST', { EnableRemoteAccess: false });
    await request('/Startup/Complete', 'POST');
  } else if(info.ServerName!=='Media Hub Lab (isolated)') throw new Error('Lab identity mismatch');
  const session = await request('/Users/AuthenticateByName', 'POST', { Username: 'MediaHubLab', Pw: password });
  token = session.AccessToken;
  const userId = session.User.Id;
  report.checks.push({ name: 'automatic-lab-account-provisioning', passed: Boolean(token) });
  const encoding = await request('/System/Configuration/encoding');
  Object.assign(encoding, { HardwareAccelerationType: 'nvenc', EnableHardwareEncoding: true,
    HardwareDecodingCodecs: ['h264','hevc'], EnableThrottling: false, EncodingThreadCount: 2, EncoderPreset:'veryslow' });
  await request('/System/Configuration/encoding', 'POST', encoding);
  const fixture = `${root}\\media\\mediahub-qualification-h264.mkv`;
  await writeFile(`${root}\\media\\mediahub-qualification-h264.en.srt`,
    '1\n00:00:01,000 --> 00:00:04,000\nMedia Hub qualification: English subtitle\n\n2\n00:00:10,000 --> 00:00:13,000\nSecond timing marker\n');
  try { await access(fixture); }
  catch(error) { if(error.code!=='ENOENT') throw error; await execute('C:\\Program Files\\Jellyfin\\Server\\ffmpeg.exe', ['-hide_banner','-nostdin','-n',
    '-f','lavfi','-i','testsrc2=size=1280x720:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
    '-t','180','-c:v','h264_nvenc','-preset','p1','-b:v','1500k','-c:a','aac','-metadata:s:a:0','language=eng',fixture],
    { windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }); }
  const folders=await request('/Library/VirtualFolders');
  if (!folders.some(folder=>folder.Name==='Qualification')) await request('/Library/VirtualFolders?name=Qualification&collectionType=movies&refreshLibrary=true', 'POST', {
    LibraryOptions: { PathInfos: [{Path: `${root}\\media`}], EnableInternetProviders: false,
      EnableRealtimeMonitor: false, EnableChapterImageExtraction: false, EnableTrickplayImageExtraction: false,
      PreferredMetadataLanguage: 'en', SubtitleDownloadLanguages: ['eng'], RequirePerfectSubtitleMatch: true }
  });
  let item;
  for (let attempt = 0; attempt < 30; attempt++) {
    const items = await request(`/Items?userId=${userId}&recursive=true&includeItemTypes=Movie&fields=Path,MediaSources,MediaStreams`);
    item = items.Items?.find(value => value.Path === fixture || value.Name?.includes('mediahub-qualification'));
    if (item) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!item) throw new Error('Lab fixture was not indexed');
  const bitrate=700000+randomBytes(2).readUInt16BE(0);
  const playback = await request(`/Items/${item.Id}/PlaybackInfo`, 'POST', {
    UserId: userId, MaxStreamingBitrate: bitrate, EnableDirectPlay: false, EnableDirectStream: false,
    EnableTranscoding: true, AllowVideoStreamCopy: false, AllowAudioStreamCopy: false,
    DeviceProfile: { Name: 'Forced lab HLS', MaxStreamingBitrate: bitrate, DirectPlayProfiles: [],
      TranscodingProfiles: [{ Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac',
        Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '2', MinSegments: 1, SegmentLength: 3 }],
      CodecProfiles: [], ContainerProfiles: [], SubtitleProfiles: [{Format: 'srt', Method: 'External'}] }
  });
  const source = playback.MediaSources?.[0];
  if (!source?.TranscodingUrl) throw new Error('Forced lab transcode was not offered');
  const streamUrl = new URL(source.TranscodingUrl, base);
  if (streamUrl.origin !== base) throw new Error('Lab returned a non-loopback source');
  // The generated URL may contain a token. It stays in memory and is never printed.
  const hls = await fetch(streamUrl, { headers: {'X-Emby-Token': token}, signal: AbortSignal.timeout(60000) });
  const manifest = await hls.text();
  if (!hls.ok || !manifest.includes('#EXTM3U')) throw new Error('Lab HLS manifest failed');
  report.checks.push({name:'jellyfin-forced-transcode-manifest',passed:true});
  let playlist=readLabPlaylist(manifest,streamUrl.href);
  const transcodeStartedAt=Date.now();
  if(playlist.kind==='master') {
    const variant=await fetch(playlist.urls[0],{headers:{'X-Emby-Token':token},signal:AbortSignal.timeout(60000)});
    if(!variant.ok) throw new Error(`Lab HLS variant failed (${variant.status})`);
    playlist=readLabPlaylist(await variant.text(),playlist.urls[0]);
  }
  if(playlist.kind!=='media') throw new Error('Lab HLS did not return media');
  const segment=await fetch(playlist.urls[0],{headers:{'X-Emby-Token':token},signal:AbortSignal.timeout(60000)});
  const segmentData=Buffer.from(await segment.arrayBuffer());
  if(!segment.ok || segmentData.length<188) throw new Error('Lab HLS media segment failed');
  const segmentFile=new URL('../artifacts/lab-segment.ts',import.meta.url);
  await writeFile(segmentFile,segmentData);
  const decoded=await execute('C:\\Program Files\\Jellyfin\\Server\\ffmpeg.exe', ['-hide_banner','-nostdin','-i',
    fileURLToPath(segmentFile),'-map','0:v:0','-f','null','-'],
    {windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  report.checks.push({name:'received-and-decoded-hls-video',passed:/frame=\s*[1-9]/.test(decoded.stderr)});
  report.tracks = source.MediaStreams?.map(track => ({type:track.Type,language:track.Language,index:track.Index,isExternal:track.IsExternal}));
  // Wait for the finite 180-second fixture encode to finish; no TV/client is launched.
  for (let attempt = 0; attempt < 40; attempt++) {
    const files = (await readdir(`${root}\\logs`)).filter(name => name.startsWith('FFmpeg.Transcode'));
    const logs = await Promise.all(files.map(async name=>({name,modifiedAt:(await stat(`${root}\\logs\\${name}`)).mtimeMs,
      text:await readFile(`${root}\\logs\\${name}`,'utf8')})));
    const summary=inspectRunLogs(logs,transcodeStartedAt);
    if (summary) { report.transcode=summary; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  report.checks.push({name:'completed-hardware-transcode-log',passed:Boolean(report.transcode?.hardwareDecode && report.transcode?.completedHardwareEncode)});
  report.status = report.checks.every(check => check.passed) ? 'partial-proof' : 'failed';
} catch (error) {
  report.status = 'failed';
  report.error = error.cmd || error.stdout || error.stderr ? 'Lab media process failed' : error.message;
} finally {
  if(token) { try { await request('/Sessions/Logout','POST'); } catch { report.logout='failed'; } token=undefined; }
}
report.endedAt=new Date().toISOString();
await writeFile(new URL(`../artifacts/pro-lab-probe-${Date.now()}.json`, import.meta.url), `${JSON.stringify(report,null,2)}\n`, {flag:'wx'});
process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.status === 'failed') process.exitCode = 1;
