import test from 'node:test';
import assert from 'node:assert/strict';
import {viewportMetrics,firstUnanswered} from '../public/tablet-ui.js';

test('M4 portrait, landscape, older iPad and Split View all get usable navigation',()=>{
 for(const [width,height] of [[834,1210],[1210,834],[834,1194],[1194,834],[500,834],[375,834]]){
  const m=viewportMetrics(width,height);
  assert.equal(m.drawer,true);assert.equal(m.compact,width<=700);assert.equal(m.height,height);assert.equal(m.keyboard,false);
 }
 assert.equal(viewportMetrics(1440,900).drawer,false);
});
test('software keyboard uses actual visible height and offset without negative geometry',()=>{
 assert.deepEqual(viewportMetrics(834,1210,750,32),{drawer:true,compact:false,height:750,top:32,keyboard:true});
 assert.equal(viewportMetrics(834,1210,1170).keyboard,false);
 assert.equal(viewportMetrics(500,834,1200,-10).height,834);
 assert.equal(viewportMetrics(500,834,1200,-10).top,0);
});
test('jump-to-unanswered skips completed radio/text questions and detects completion',()=>{
 assert.equal(firstUnanswered([{answered:true},{answered:false},{answered:true}]),1);
 assert.equal(firstUnanswered([{answered:true},{answered:true}]),-1);
 assert.equal(firstUnanswered([]),-1);
});
