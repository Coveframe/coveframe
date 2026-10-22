export function parseEncoderSessions(text) {
  return text.split(/\r?\n/).flatMap(line=>{
    const fields=line.trim().split(/\s+/);
    if(fields.length!==8 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1]) || !/^\d+$/.test(fields[2]) ||
      !/^(H264|HEVC|AV1)$/i.test(fields[3]) || !fields.slice(4).every(value=>/^\d+(?:\.\d+)?$/.test(value))) return [];
    const [gpu,sessionId,processId]=fields.slice(0,3).map(Number);
    const [width,height,fps,latencyUs]=fields.slice(4).map(Number);
    return processId>0 && width>0 && height>0 ? [{gpu,sessionId,processId,codec:fields[3],width,height,fps,latencyUs}] : [];
  });
}
