// The preparation gate is weaker than boot qualification: it only permits arming a test.
export function assessBootPreparation(evidence, options = {}) {
  const dry = evidence?.dryRun;
  const blockers = [];
  if (options.taskState !== 'Ready' || options.taskResult !== 0) blockers.push('dry-run-task-not-successful');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(options.attemptId || '') ||
      dry?.attemptId !== options.attemptId || evidence?.result?.attemptId !== options.attemptId) {
    blockers.push('dry-run-attempt-mismatch');
  }
  if (dry?.schemaVersion !== 1 || dry?.dryRun !== true || evidence?.result?.schemaVersion !== 1 ||
      evidence?.result?.collectionCompleted !== true || evidence?.result?.dryRun !== true) {
    blockers.push('dry-run-collection-incomplete');
  }
  if (dry?.probe?.status !== 'partial-proof' || dry?.capture?.service?.sessionId !== 0 ||
      dry?.capture?.service?.name !== 'MediaHubLabJellyfin' || dry?.capture?.audit?.complete !== true ||
      dry?.probe?.transcode?.hardwareDecode !== true || dry?.probe?.transcode?.completedHardwareEncode !== true ||
      !['received-and-decoded-hls-video', 'completed-hardware-transcode-log'].every(name =>
        dry?.probe?.checks?.some?.(check => check?.name === name && check.passed === true))) {
    blockers.push('system-dry-run-incomplete');
  }
  return { schemaVersion: 1, status: blockers.length ? 'blocked' : 'ready-to-arm',
    qualified: false, homeCompatibility: 'unverified', blockers };
}
