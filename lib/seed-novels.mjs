import {constants} from 'node:fs';
import {mkdir,readdir,copyFile} from 'node:fs/promises';
import path from 'node:path';

// Public-domain bundled books initialize an empty library without replacing personal imports.
export async function seedNovels(source,destination){
 let names;try{names=await readdir(source);}catch(error){if(error.code==='ENOENT')return 0;throw error;}
 await mkdir(destination,{recursive:true});let count=0;
 for(const name of names){
  if(!/^novel-[a-f0-9]{24}(?:\.meta)?\.json$/.test(name))continue;
  try{await copyFile(path.join(source,name),path.join(destination,name),constants.COPYFILE_EXCL);count++;}
  catch(error){if(error.code!=='EEXIST')throw error;}
 }
 return count;
}
