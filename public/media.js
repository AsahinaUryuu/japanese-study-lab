let utterance=null,recorder=null,recognizer=null,recordingAttempt=0,recordingPending=false,mediaEpoch=0;
const voiceOptions=()=>speechSynthesis.getVoices().filter(v=>v.lang.toLowerCase().startsWith('ja'));
export function speak(text,{rate=.9,onState=()=>{}}={}){
  if(!('speechSynthesis'in window)){onState('当前浏览器不支持朗读');return;}
  speechSynthesis.cancel();const voices=voiceOptions();
  if(!voices.length){onState('没有可用的日语语音。可使用资料库音频，或安装系统日语语音包后重试。');return;}
  utterance=new SpeechSynthesisUtterance(String(text).slice(0,8000));utterance.lang='ja-JP';utterance.voice=voices[0];utterance.rate=rate;utterance.onend=()=>onState('朗读结束');utterance.onerror=()=>onState('朗读中断');speechSynthesis.speak(utterance);onState('正在朗读（合成语音）');
}
export function stopSpeech(){if('speechSynthesis'in window)speechSynthesis.cancel();}
export function voiceStatus(){return 'speechSynthesis'in window?voiceOptions().map(v=>v.name):[];}
function recordingDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open('kotoba-recordings',1);request.onupgradeneeded=()=>request.result.createObjectStore('clips');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function putClip(key,blob){const db=await recordingDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('clips','readwrite');tx.objectStore('clips').put({blob,at:Date.now()},key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export async function getClip(key){const db=await recordingDB();try{return await new Promise((resolve,reject)=>{const r=db.transaction('clips').objectStore('clips').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
export async function startRecording(key,onState,onReady){
  if(recordingPending||recorder?.state==='recording')throw new Error('正在等待麦克风或录音中，请先停止当前录音');
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('当前浏览器不支持录音，请使用 Chrome');
  const attempt=++recordingAttempt,epoch=mediaEpoch;recordingPending=true;let ownStream;
  try{
    ownStream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(attempt!==recordingAttempt||epoch!==mediaEpoch){ownStream.getTracks().forEach(t=>t.stop());return false;}
    const ownChunks=[],ownRecorder=new MediaRecorder(ownStream);recorder=ownRecorder;
    ownRecorder.ondataavailable=e=>{if(e.data.size)ownChunks.push(e.data);};
    ownRecorder.onstop=async()=>{
      ownStream.getTracks().forEach(t=>t.stop());if(recorder===ownRecorder)recorder=null;
      const blob=new Blob(ownChunks,{type:ownRecorder.mimeType||'audio/webm'});if(!blob.size){if(epoch===mediaEpoch)onState('录音没有收到声音数据，请重新录制');return;}
      let message='录音已保存在本浏览器，可回放或下载';try{await putClip(key,blob);}catch{message='录音未能持久保存，请下载留存';}
      // A completed old recording is still saved to its original task, but its
      // late callback must not alter the newly opened lesson or create lost URLs.
      if(epoch===mediaEpoch){onState(message);onReady(URL.createObjectURL(blob),blob);}
    };
    ownRecorder.onerror=()=>{ownStream.getTracks().forEach(t=>t.stop());if(recorder===ownRecorder)recorder=null;if(epoch===mediaEpoch)onState('录音出现错误，请重试');};
    ownRecorder.start();onState('正在录音，完成后点停止');return true;
  }catch(error){ownStream?.getTracks().forEach(t=>t.stop());if(attempt!==recordingAttempt||epoch!==mediaEpoch)return false;throw error;}
  finally{if(attempt===recordingAttempt)recordingPending=false;}
}
export function stopRecording(){recordingAttempt++;recordingPending=false;if(recorder?.state==='recording')recorder.stop();}
export function isRecording(){return recorder?.state==='recording';}
export function transcribe(onResult,onState){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){onState('此浏览器不支持语音转写，可手动填写表达内容');return;}
  stopTranscription(true);const own=new Recognition();recognizer=own;own.lang='ja-JP';own.interimResults=false;own.continuous=true;
  own.onresult=e=>{if(recognizer!==own)return;let text='';for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)text+=e.results[i][0].transcript;if(text)onResult(text);};
  own.onerror=e=>{if(recognizer===own)onState('转写未完成：'+e.error+'。录音和手工输入仍可使用。');};own.onend=()=>{if(recognizer===own){recognizer=null;onState('转写结束');}};
  try{own.start();onState('正在转写日语（浏览器服务可能联网）');}catch(error){if(recognizer===own)recognizer=null;onState('无法开始转写：'+error.message);}
}
export function stopTranscription(discard=false){const previous=recognizer;if(discard)recognizer=null;try{if(discard&&previous?.abort)previous.abort();else previous?.stop();}catch{}}
export function cleanupMedia(){mediaEpoch++;stopSpeech();stopRecording();stopTranscription(true);}
