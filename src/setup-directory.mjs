import {resolve} from 'node:path';
import {mkdir,realpath} from 'node:fs/promises';

export async function resolveSetupDirectory({directory,localAppData=process.env.LOCALAPPDATA}={}){
 // Explicit paths retain lifecycle's strict link checks. Windows may transparently
 // redirect the default AppData location for packaged hosts such as Codex.
 if(directory)return directory;
 const requested=resolve(localAppData,'MediaHub','Setup');
 await mkdir(requested,{recursive:true});
 return realpath(requested);
}
