import { inspectTranscodeLog } from './transcode.mjs';

const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;

export function assessBootRun(run) {
  const blockers = [];
  const block = message => { if (!blockers.includes(message)) blockers.push(message); };
  if (!run || run.schemaVersion !== 1 || !run.machineId ||
      !run.service || !run.audit || !run.observer || !run.transcode) {
    return { status: 'blocked', qualified: false, blockers: ['evidence-incomplete'] };
  }
  const { service, audit, observer, transcode } = run;
  const boot = instant(run.bootStartedAt), start = instant(observer.startedAt), end = instant(observer.endedAt);
  const serviceStart = instant(service.processStartedAt), collected = instant(run.collectedAt);
  if (![boot,start,end,serviceStart,collected].every(Number.isFinite) ||
      !(boot <= serviceStart && serviceStart <= start && start < end && end <= collected)) block('invalid-evidence-timeline');
  if (!['cold','restart'].includes(run.bootKind)) block('boot-kind-required');
  if (service.startMode !== 'Auto' || service.sessionId !== 0 ||
      !/^nt authority\\network\s?service$/i.test(service.identity || '') ||
      !Number.isInteger(service.processId) || service.processId <= 0) block('session-zero-service-required');
  if (audit.enabledBeforeBoot !== true || audit.enabledAtCollection !== true || audit.complete !== true ||
      audit.cleared !== false || !Array.isArray(audit.interactiveLogons) || !Array.isArray(audit.policyChanges) ||
      audit.policyChanges.length > 0 || !Number.isFinite(instant(audit.oldestEventAt)) ||
      instant(audit.oldestEventAt) > boot || instant(audit.windowStart) !== boot ||
      !Number.isFinite(instant(audit.windowEnd)) || instant(audit.windowEnd) < end) block('logon-audit-incomplete');
  if (audit.interactiveLogons?.length > 0) block('interactive-login-during-proof');
  if (!observer.machineId || observer.machineId === run.machineId) block('separate-observer-required');
  if (!Number.isFinite(observer.clockOffsetMs) || Math.abs(observer.clockOffsetMs) > 2000) block('observer-clock-unverified');
  if (!Number.isFinite(observer.receivedVideoSeconds) || observer.receivedVideoSeconds < 120 ||
      observer.receivedVideoSeconds > (end - start) / 1000 + 2 || observer.seekVerified !== true) {
    block('sustained-playback-and-seek-required');
  }
  if (!/^mediahub-qualification-[a-z0-9-]+$/.test(observer.fixtureId || '') ||
      transcode.fixtureId !== observer.fixtureId || transcode.parentProcessId !== service.processId ||
      !Number.isInteger(transcode.processId) || transcode.processId <= 0) block('fixture-process-correlation-required');
  const inspected = inspectTranscodeLog(typeof transcode.log === 'string' ? transcode.log : '');
  if (!inspected.hardwareDecode || !inspected.completedHardwareEncode) block('hardware-transcode-not-demonstrated');
  const engines = ['VideoEncode','VideoDecode'];
  if (!Array.isArray(transcode.gpuSamples) || !engines.every(engine => transcode.gpuSamples.some(sample => sample && sample.processId === transcode.processId &&
      sample.engine === engine && Number.isFinite(sample.utilization) && sample.utilization > 0 && sample.utilization <= 100))) {
    block('matching-gpu-activity-required');
  }
  return { status: blockers.length ? 'blocked' : 'ready-for-review', qualified: false, blockers };
}
