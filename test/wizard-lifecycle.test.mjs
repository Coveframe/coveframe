import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSetupPreview} from '../ui/setup-preview-client.mjs';
import {getSetupCatalog} from '../src/onboarding.mjs';
import {composeSetupPlan,saveSetupPlan,resolveWizardStep} from '../src/setup-plan.mjs';

test('late navigation and progress callbacks preserve the stopped wizard screen',()=>{
  const prior=globalThis.document, nodes=new Map(), callbacks={};
  for(const id of ['guide-data','content','steps','progress','back','next','announcement']) nodes.set(id,{
    isConnected:true,addEventListener:(type,fn)=>{callbacks[id+':'+type]=fn;},removeAttribute:()=>{},setAttribute:()=>{},focus:()=>{},
  });
  nodes.get('guide-data').textContent=JSON.stringify(getSetupCatalog());
  globalThis.document={getElementById:id=>nodes.get(id)||null};
  let progress;
  try{
    initializeSetupPreview({composeSetupPlan,saveSetupPlan,resolveWizardStep,runtime:{welcome:'',decorate:(_c,_s,_g,render)=>{progress=render;}}});
    const content=nodes.get('content'),before=content.innerHTML;
    content.isConnected=false;nodes.delete('progress');nodes.delete('back');nodes.delete('next');
    assert.doesNotThrow(()=>callbacks['steps:click']({target:{closest:()=>({dataset:{step:'2'}})}}));
    assert.doesNotThrow(()=>progress());
    assert.equal(content.innerHTML,before);
  }finally{globalThis.document=prior;}
});
