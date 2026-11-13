import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name,import.meta.url),'utf8'));
test('public release only bundles the individually licensed government PDF',()=>{
 const resources=read('online-resources.json');assert.ok(resources.length>70);
 assert.equal(new Set(resources.map(x=>x.id)).size,resources.length);
 const bundled=resources.filter(item=>item.kind!=='external');
 assert.deepEqual(bundled.map(item=>item.id),['bunka-keigo-guidelines']);
 for(const item of resources){assert.ok(item.license&&item.sourceUrl);if(item.id==='bunka-keigo-guidelines')continue;assert.equal(item.kind,'external');assert.match(item.url,/^https:\/\//);assert.equal(item.bytes,undefined);}
 const book=bundled[0],bytes=readFileSync(new URL('../public'+book.url,import.meta.url));
 assert.equal(book.redistributable,true);assert.equal(book.kind,'pdf');assert.equal(book.pageCount,82);
 assert.equal(bytes.length,book.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),book.sha256);
 assert.equal(book.sha256,'3a567c6d85e990e0f90f0698c1403ba5826c7c6f9e7e50c93ea5d4da9336882d');
 assert.deepEqual(readdirSync(new URL('../public/resources',import.meta.url)),['bunka-keigo-guidelines.pdf']);
 assert.deepEqual(read('resources.json'),[]);
});
