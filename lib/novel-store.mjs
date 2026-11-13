import path from 'node:path';
import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {GradeError} from './config.mjs';
import {parseNovelImport,novelMetadata} from './novel-import.mjs';

const bookId=id=>typeof id==='string'&&/^novel-[a-f0-9]{24}$/.test(id);
const chapterId=id=>typeof id==='string'&&/^novel-[a-f0-9]{24}-\d{4}$/.test(id);
export function createNovelStore(directory){
 let queue=Promise.resolve(),cachedBook=null;
 async function atomic(file,value){const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value),{encoding:'utf8',flag:'wx'});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}}
 async function list(){let names;try{names=await readdir(directory);}catch(error){if(error.code==='ENOENT')return {books:[]};throw error;}const books=[];for(const name of names.filter(n=>/^novel-[a-f0-9]{24}\.meta\.json$/.test(n))){try{const value=JSON.parse(await readFile(path.join(directory,name),'utf8'));if(!bookId(value.id)||!Array.isArray(value.chapters))throw new Error();books.push(value);}catch{throw new GradeError('已有导入书籍索引损坏，原文件已保留，请恢复备份。',409);}}return {books:books.sort((a,b)=>b.importedAt-a.importedAt)};}
 async function get(id,chapter){
  if(!bookId(id)||!chapterId(chapter)||!chapter.startsWith(id+'-'))throw new GradeError('书籍或章节编号无效。',400);
  let value,metadata;try{
   const filename=path.join(directory,id+'.json'),info=await stat(filename);
   if(cachedBook?.id===id&&cachedBook.mtime===info.mtimeMs&&cachedBook.size===info.size){value=cachedBook.book;metadata=cachedBook.metadata;}
   else{value=JSON.parse(await readFile(filename,'utf8'));metadata=novelMetadata(value);cachedBook={id,mtime:info.mtimeMs,size:info.size,book:value,metadata};}
  }catch(error){if(error.code==='ENOENT')throw new GradeError('未找到这本导入书籍，请重新导入对应文件。',404);throw new GradeError('导入书籍文件损坏，原文件已保留。',409);}
  const part=value.chapters?.find(c=>c.id===chapter);if(!part)throw new GradeError('没有找到这一节。',404);return {book:metadata,chapter:part};
 }
 function importBook(input){const action=queue.then(async()=>{const book=parseNovelImport(input);await mkdir(directory,{recursive:true});const file=path.join(directory,book.id+'.json');try{const old=JSON.parse(await readFile(file,'utf8'));if(old.textHash!==book.textHash||old.id!==book.id)throw new Error();const metadata=novelMetadata(old);await atomic(path.join(directory,book.id+'.meta.json'),metadata);return {book:metadata,duplicate:true};}catch(error){if(error.code!=='ENOENT')throw new GradeError('已有同名书籍文件损坏，未覆盖，请恢复备份。',409);}
   const {books}=await list();if(books.length>=200)throw new GradeError('导入书架最多保存 200 本书，请先备份整理。',413);const names=await readdir(directory);let used=0;for(const name of names.filter(n=>/^novel-[a-f0-9]{24}\.json$/.test(n)))used+=(await stat(path.join(directory,name))).size;
   book.importedAt=Date.now();const serialized=JSON.stringify(book);if(used+Buffer.byteLength(serialized)>512*1024*1024)throw new GradeError('导入书架已达到 512 MB，请先备份整理。',413);
   await atomic(file,book);const metadata=novelMetadata(book);await atomic(path.join(directory,book.id+'.meta.json'),metadata);return {book:metadata,duplicate:false};
  });queue=action.catch(()=>{});return action;}
 return {list,get,importBook};
}
