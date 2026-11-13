import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name,import.meta.url),'utf8'));
test('public release contains official source links and no bundled personal-use originals',()=>{
 const resources=read('online-resources.json');assert.ok(resources.length>70);
 assert.equal(new Set(resources.map(x=>x.id)).size,resources.length);
 for(const item of resources){assert.equal(item.kind,'external');assert.match(item.url,/^https:\/\//);assert.ok(item.license&&item.sourceUrl);assert.equal(item.bytes,undefined);}
 assert.deepEqual(read('resources.json'),[]);
 assert.equal(existsSync(new URL('../public/resources',import.meta.url)),false);
});
