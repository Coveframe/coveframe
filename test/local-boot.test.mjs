import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLocalBoot } from '../src/local-boot.mjs';

const run=()=>({schemaVersion:1,platform:'Windows Pro',mode:'pro-development',
  baselineBootAt:'2026-10-20T10:00:00Z',bootAt:'2026-10-20T11:00:00Z',
  capture:{service:{name:'MediaHubLabJellyfin',startMode:'Auto',identity:'NT Authority\\NetworkService',sessionId:0},
    audit:{enabledBeforeBoot:true,enabledAtCollection:true,complete:true,cleared:false,interactiveLogons:[],policyChanges:[],
      oldestEventAt:'2026-10-19T00:00:00Z',windowStart:'2026-10-20T11:00:00Z',windowEnd:'2026-10-20T11:02:00Z'}},
  probe:{status:'partial-proof',startedAt:'2026-10-20T11:00:30Z',endedAt:'2026-10-20T11:01:00Z',
    checks:[{name:'received-and-decoded-hls-video',passed:true},{name:'completed-hardware-transcode-log',passed:true}],
    transcode:{hardwareDecode:'cuda',hardwareEncoder:'h264_nvenc',encodedFrames:4320,completedHardwareEncode:true}}});

test('real reboot plus audited service playback advances only to external playback testing',()=>{
  const result=assessLocalBoot(run());
  assert.equal(result.status,'ready-for-external-playback-test');
  assert.equal(result.qualified,false);
  assert.equal(result.homeCompatibility,'unverified');
  assert.deepEqual(result.blockers,[]);
});

test('running while signed in, reusing the old boot, or losing audit coverage cannot pass',()=>{
  const signedIn=run();signedIn.capture.audit.interactiveLogons=[{logonType:2}];
  assert.ok(assessLocalBoot(signedIn).blockers.includes('interactive-login-during-proof'));
  const old=run();old.bootAt=old.baselineBootAt;
  assert.ok(assessLocalBoot(old).blockers.includes('new-boot-required'));
  const incomplete=run();incomplete.capture.audit.complete=false;
  assert.ok(assessLocalBoot(incomplete).blockers.includes('logon-audit-incomplete'));
  const software=run();software.probe.transcode.hardwareDecode=null;
  assert.ok(assessLocalBoot(software).blockers.includes('hardware-playback-not-demonstrated'));
  assert.equal(assessLocalBoot(null).status,'blocked');
});
