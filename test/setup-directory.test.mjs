import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveSetupDirectory} from '../src/setup-directory.mjs';
import {createAppLifecycle} from '../src/app-lifecycle.mjs';

test('the default setup opens in the physical Windows app-data folder when its app folder is redirected',async t=>{
 const base=await mkdtemp(join(tmpdir(),'hub-default-'));
 t.after(()=>rm(base,{recursive:true,force:true}));
 const localAppData=join(base,'Local'),physical=join(base,'PackageLocal');
 await mkdir(localAppData);await mkdir(join(physical,'Setup'),{recursive:true});
 await symlink(physical,join(localAppData,'MediaHub'),'junction');
 const directory=await resolveSetupDirectory({localAppData});
 const lifecycle=await createAppLifecycle({directory});
 assert.equal(directory,await realpath(join(physical,'Setup')));
 assert.equal((await lifecycle.review()).dataDirectory,directory);
});

test('an explicitly supplied linked setup folder is still rejected',async t=>{
 const base=await mkdtemp(join(tmpdir(),'hub-custom-'));
 t.after(()=>rm(base,{recursive:true,force:true}));
 const physical=join(base,'Physical'),directory=join(base,'Custom');
 await mkdir(physical);await symlink(physical,directory,'junction');
 assert.equal(await resolveSetupDirectory({directory}),directory);
 await assert.rejects(createAppLifecycle({directory}),/must not be a link/);
});
