import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTranscodeLog } from '../src/transcode.mjs';
import { inspectRunLogs } from '../src/transcode.mjs';

test('hardware settings without encoded frames are not a completed hardware transcode', () => {
  const report = inspectTranscodeLog('ffmpeg -hwaccel cuda -c:v h264_nvenc input.mkv');
  assert.equal(report.hardwareDecode, 'cuda');
  assert.equal(report.hardwareEncoder, 'h264_nvenc');
  assert.equal(report.encodedFrames, 0);
  assert.equal(report.completedHardwareEncode, false);
});

test('completed NVIDIA output is distinguished from software encoding and fatal GPU errors', () => {
  const success = inspectTranscodeLog('-hwaccel cuda -codec:v:0 h264_nvenc\nframe= 3600 fps=90\nvideo:1024KiB audio:42KiB');
  assert.equal(success.encodedFrames, 3600);
  assert.equal(success.completedHardwareEncode, true);
  assert.equal(inspectTranscodeLog('-c:v libx264\nframe=3600\nvideo:1024KiB').completedHardwareEncode, false);
  assert.equal(inspectTranscodeLog('-hwaccel cuda -c:v h264_nvenc\nframe=8\nConversion failed!').completedHardwareEncode, false);
});
test('a cached HLS response cannot borrow hardware proof from an earlier transcode',()=>{
  const log='-hwaccel cuda -c:v h264_nvenc\nframe=4320\nvideo:1234KiB';
  assert.equal(inspectRunLogs([{name:'old',modifiedAt:1000,text:log}],2000),null);
  assert.equal(inspectRunLogs([{name:'current',modifiedAt:3000,text:log}],2000).name,'current');
});
