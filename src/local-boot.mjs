const time=value=>typeof value==='string'?Date.parse(value):NaN;

// A local SYSTEM probe is useful startup evidence, but is not a remote-player or Home qualification.
export function assessLocalBoot(run) {
  const blockers=[];
  const result=()=>({schemaVersion:1,status:blockers.length?'blocked':'ready-for-external-playback-test',
    qualified:false,homeCompatibility:'unverified',blockers});
  if(!run || run.schemaVersion!==1 || !run.capture?.service || !run.capture?.audit || !run.probe) {
    blockers.push('evidence-incomplete');return result();
  }
  const baseline=time(run.baselineBootAt),boot=time(run.bootAt),start=time(run.probe.startedAt),end=time(run.probe.endedAt);
  const audit=run.capture.audit,service=run.capture.service,transcode=run.probe.transcode;
  if(![baseline,boot,start,end].every(Number.isFinite) || !(baseline<boot && boot<=start && start<end)) blockers.push('new-boot-required');
  if(service.name!=='MediaHubLabJellyfin' || service.startMode!=='Auto' || service.sessionId!==0 ||
    !/^NT AUTHORITY\\Network\s?Service$/i.test(service.identity||'')) blockers.push('isolated-session-zero-service-required');
  if(audit.enabledBeforeBoot!==true || audit.enabledAtCollection!==true || audit.complete!==true || audit.cleared!==false ||
    !Array.isArray(audit.policyChanges) || audit.policyChanges.length ||
    !Number.isFinite(time(audit.oldestEventAt)) || time(audit.oldestEventAt)>boot || time(audit.windowStart)!==boot ||
    !Number.isFinite(time(audit.windowEnd)) || time(audit.windowEnd)<end || !Array.isArray(audit.interactiveLogons)) blockers.push('logon-audit-incomplete');
  if(audit.interactiveLogons?.length) blockers.push('interactive-login-during-proof');
  if(run.probe.status!=='partial-proof' || !transcode?.hardwareDecode || !transcode.completedHardwareEncode ||
    !Array.isArray(run.probe.checks) || !['received-and-decoded-hls-video','completed-hardware-transcode-log'].every(name=>
      run.probe.checks.some(check=>check.name===name && check.passed===true))) blockers.push('hardware-playback-not-demonstrated');
  return result();
}
