import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEncoderSessions } from '../src/nvidia.mjs';

test('NVIDIA session evidence retains numeric encoder activity and discards empty rows',()=>{
  const text='# GPU Session Process Codec H V Average Average\n0 - - - - - - -\n0 8 97840 H264 1280 720 400 700\n';
  assert.deepEqual(parseEncoderSessions(text),[{gpu:0,sessionId:8,processId:97840,codec:'H264',width:1280,height:720,fps:400,latencyUs:700}]);
  assert.deepEqual(parseEncoderSessions('unavailable'),[]);
});
