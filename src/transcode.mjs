export function inspectTranscodeLog(text) {
  const report = {
    hardwareDecode: text.match(/-hwaccel\s+(cuda|qsv|d3d11va|dxva2)\b/i)?.[1]?.toLowerCase() || null,
    hardwareEncoder: text.match(/-(?:c|codec):v(?::\d+)?\s+(h264_nvenc|hevc_nvenc|av1_nvenc|h264_qsv|hevc_qsv|av1_qsv|h264_amf|hevc_amf|av1_amf)\b/i)?.[1]?.toLowerCase() || null,
    encodedFrames: Math.max(0, ...Array.from(text.matchAll(/\bframe=\s*(\d+)/g), match => Number(match[1]))),
    fatalError: /conversion failed|no capable devices found|cannot load (?:nvcuda|libcuda)|device setup failed|error while opening encoder|hardware acceleration failed/i.test(text),
    completedHardwareEncode: false,
  };
  report.completedHardwareEncode = Boolean(report.hardwareEncoder && report.encodedFrames > 0 &&
    /\bvideo:\s*\d/i.test(text) && !report.fatalError);
  return report;
}

export function inspectRunLogs(entries, startedAt) {
  for (const entry of entries) {
    if (!Number.isFinite(entry.modifiedAt) || entry.modifiedAt < startedAt) continue;
    const summary=inspectTranscodeLog(entry.text);
    if (summary.completedHardwareEncode) return {name:entry.name,...summary};
  }
  return null;
}
