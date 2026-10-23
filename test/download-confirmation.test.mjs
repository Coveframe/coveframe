import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmDownloadApps} from '../ui/library-client.mjs';

function dialogDocument(){
 const buttons={cancel:{focus(){this.focused=true;}},confirm:{}},listeners={};
 const dialog={setAttribute(){},addEventListener(type,fn){listeners[type]=fn;},querySelector(selector){return buttons[selector.includes('cancel')?'cancel':'confirm'];},
  showModal(){this.open=true;},close(value=''){this.returnValue=value;listeners.close();},remove(){this.removed=true;}};
 return {dialog,buttons,document:{createElement(){return dialog;},body:{append(node){assert.equal(node,dialog);}}}};
}
test('optional download consent names the executable and defaults to cancel; dismissal never approves',async()=>{
 const {document,dialog,buttons}=dialogDocument();
 const pending=confirmDownloadApps({document});
 assert.equal(dialog.open,true);assert.equal(buttons.cancel.focused,true);
 assert.match(dialog.innerHTML,/Decypharr\.exe/);assert.match(dialog.innerHTML,/github\.com\/sirrobot01\/decypharr/);
 assert.match(dialog.innerHTML,/unsigned/);assert.match(dialog.innerHTML,/Radarr/);assert.match(dialog.innerHTML,/Sonarr/);
 dialog.close();assert.equal(await pending,false);assert.equal(dialog.removed,true);
});
test('install and restart both require an explicit continue action',async()=>{
 for(const configured of [false,true]){
  const {document,dialog,buttons}=dialogDocument(),pending=confirmDownloadApps({document,configured});
  assert.match(dialog.innerHTML,configured?/Start download apps/:/Install and start download apps/);
  buttons.confirm.onclick();assert.equal(await pending,true);assert.equal(dialog.removed,true);
 }
});
