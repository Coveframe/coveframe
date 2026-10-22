import { readFile } from 'node:fs/promises';
import { assessLocalBoot } from '../src/local-boot.mjs';
const run=JSON.parse((await readFile(process.argv[2],'utf8')).replace(/^\uFEFF/,''));
console.log(JSON.stringify(assessLocalBoot(run)));
