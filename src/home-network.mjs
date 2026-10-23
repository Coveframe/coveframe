import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWindowsHomeNetwork} from './windows-home-network.mjs';
import {startHomeMediaGateway,privateIPv4} from './home-media-gateway.mjs';

// Owns TV access only. The setup wizard and provider services stay on loopback.
export async function createHomeNetwork({directory,windows=createWindowsHomeNetwork({directory}),
 listen=startHomeMediaGateway,isMediaRunning=()=>false,onAddress=async()=>{}}={}){
 const file=join(directory,'home-network.json');
 let saved={enabled:false},state={phase:'off',enabled:false,adapters:[]},gateway,busy=false,watch;
 try{saved=JSON.parse(await readFile(file,'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw Error('TV settings could not be read. Preserve the app folder and try again.');}
 async function persist(value){
  await mkdir(directory,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temp,file);saved=value;
 }
 const status=()=>({...structuredClone(state),enabled:saved.enabled,...gateway?.status()});
 async function scan(){
  let result;try{result=await windows.inspect();}catch{throw Error('Windows could not check the network. Connect to your home network and choose Scan again.');}
  const adapters=(result.adapters||[]).filter(x=>Number.isInteger(x.id)&&privateIPv4(x.address)&&Number.isInteger(x.prefixLength)&&x.prefixLength>=8&&x.prefixLength<=30);
  const eligible=adapters.filter(x=>x.category==='Private');
  const selected=eligible.find(x=>x.id===saved.adapterId)||(eligible.length===1?eligible[0]:null);
  state={...state,adapters,selectedId:selected?.id||null,firewallAllowed:result.firewallAllowed===true};
  return status();
 }
 async function stop(){
  clearInterval(watch);watch=null;
  if(gateway){const owned=gateway;gateway=null;await owned.close();}
  state={...state,phase:saved.enabled?'stopped':'off',url:undefined,reachable:false,deviceSeen:false};
 }
 async function activate({adapterId,confirmation}={},interactive=true){
  if(busy)throw Error('Wait for the TV connection check to finish.');busy=true;
  try{
   if(!isMediaRunning())throw Error('Start your media apps on Your household or Dashboard first.');
   await scan();
   const adapter=state.adapters.find(x=>x.id===adapterId);
   if(!adapter||adapter.category!=='Private')throw Error('Choose a Private home network. In Windows Settings → Network & internet, open your home connection and choose Private. Then scan again.');
   if(!state.firewallAllowed){
    if(!interactive||confirmation!=='ALLOW HOME TV')throw Error('TV access needs your permission to add a Private-network Windows firewall rule. Choose Enable TV access and review the permission.');
    state={...state,phase:'permission'};
    try{await windows.allow();}catch{throw Error('Windows permission was not completed. Nothing was opened. Choose Enable TV access to retry, or keep watching on this PC.');}
    await scan();if(!state.firewallAllowed)throw Error('Windows has not allowed TV access. Check with your administrator, then retry.');
   }
   await stop();
   gateway=await listen({address:adapter.address,prefixLength:adapter.prefixLength});
   if(!isMediaRunning()){await stop();throw Error('Your media apps stopped. Start them again before enabling TV access.');}
   try{await onAddress(gateway.url);await persist({enabled:true,adapterId:adapter.id});}
   catch(error){await stop();throw error;}
   state={...state,phase:'running',url:gateway.url,adapterId:adapter.id,reachable:await gateway.check(),message:'Home TV access is on.'};
   watch=setInterval(()=>{if(!busy)check().catch(async()=>{await stop();state={...state,phase:'needs-attention',message:'Windows could not confirm your home network. Enable TV access again.'};});},30000);watch.unref?.();
   return status();
  }catch(error){state={...state,phase:gateway?'running':'needs-attention',message:error.message};throw error;}
  finally{busy=false;}
 }
 async function check(){
  if(busy)return status();
  busy=true;
  try{
   await scan();
   if(gateway){
    const owned=gateway,valid=state.adapters.some(x=>x.id===state.adapterId&&x.category==='Private'&&owned.url===`http://${x.address}:18799`);
    if(!valid||!state.firewallAllowed){await stop();state={...state,phase:'needs-attention',message:'Your network or firewall changed. Enable TV access again to update the address.'};}
    else{const reachable=await owned.check();if(gateway===owned)state={...state,reachable};}
   }
   return status();
  }finally{busy=false;}
 }
 return {status,scan,enable:activate,stop,check,
  async resume(){
   if(!saved.enabled)return status();
   try{return await activate({adapterId:saved.adapterId},false);}catch{return status();}
  },
  async disable(){if(busy)throw Error('Wait for TV setup to finish.');await stop();await onAddress(null);await persist({enabled:false});state={...state,phase:'off'};return status();},
  async removePermission(){await stop();await windows.remove();saved={enabled:false};},
 };
}
