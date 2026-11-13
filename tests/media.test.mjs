import test from 'node:test';
import assert from 'node:assert/strict';
import {startRecording,stopRecording,isRecording,transcribe,cleanupMedia} from '../public/media.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(t){
 const keys=['window','navigator','MediaRecorder'],before=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),instances=[],recognitions=[];let stopped=0,permission=async()=>stream;
 const stream={getTracks:()=>[{stop(){stopped++;}}]};
 class Recorder{constructor(){this.state='inactive';this.mimeType='audio/webm';instances.push(this);}start(){this.state='recording';}stop(){this.state='inactive';void this.onstop?.();}}
 class Recognition{constructor(){recognitions.push(this);}start(){}stop(){}abort(){this.aborted=true;}}
 Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:()=>permission()}},configurable:true});Object.assign(globalThis,{window:{MediaRecorder:Recorder,SpeechRecognition:Recognition},MediaRecorder:Recorder});cleanupMedia();
 t.after(()=>{cleanupMedia();for(const [k,desc]of before){if(desc)Object.defineProperty(globalThis,k,desc);else delete globalThis[k];}});
 return {stream,instances,recognitions,get stopped(){return stopped;},set permission(value){permission=value;}};
}
test('等待麦克风授权时切换课程，迟到的授权不启动旧课程录音',async t=>{
 const f=setup(t),gate=deferred(),states=[];f.permission=()=>gate.promise;
 const pending=startRecording('old-lesson:task',s=>states.push(s),()=>assert.fail('不应回填已关闭课程'));
 cleanupMedia();gate.resolve(f.stream);assert.equal(await pending,false);assert.equal(f.instances.length,0);assert.equal(f.stopped,1);assert.equal(isRecording(),false);assert.deepEqual(states,[]);
});
test('授权等待阶段禁止重复启动，停止后可重新开始',async t=>{
 const f=setup(t),gate=deferred();f.permission=()=>gate.promise;const first=startRecording('a',()=>{},()=>{});
 await assert.rejects(startRecording('b',()=>{},()=>{}),/等待麦克风/);stopRecording();gate.resolve(f.stream);await first;
 f.permission=async()=>f.stream;assert.equal(await startRecording('b',()=>{},()=>{}),true);assert.equal(isRecording(),true);stopRecording();assert.equal(isRecording(),false);
});
test('空录音不会覆盖已经保存的有效片段',async t=>{
 const f=setup(t),states=[];await startRecording('a',s=>states.push(s),()=>assert.fail('空录音不应产生下载URL'));stopRecording();
 assert.ok(states.some(s=>s.includes('没有收到声音数据')));assert.ok(f.stopped>0);
});
test('切换课程后忽略旧语音识别结果，重启识别也不混入上一任务',t=>{
 const f=setup(t),old=[],fresh=[];transcribe(x=>old.push(x),()=>{});const first=f.recognitions[0];cleanupMedia();
 first.onresult({resultIndex:0,results:[Object.assign([{transcript:'古い結果'}],{isFinal:true})]});assert.deepEqual(old,[]);assert.equal(first.aborted,true);
 transcribe(x=>fresh.push(x),()=>{});const second=f.recognitions[1];second.onresult({resultIndex:0,results:[Object.assign([{transcript:'新しい結果'}],{isFinal:true})]});assert.deepEqual(fresh,['新しい結果']);
});
