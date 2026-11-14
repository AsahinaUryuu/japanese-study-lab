import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStudyCheck,updateStudyCheck,scheduledReviews,studyCheckMarkup,studyQueueMarkup} from '../public/study-check.js';
const now=new Date(2026,10,14,9,30).getTime();
test('self assessment is independent of scores and later scheduling preserves reflection',()=>{
 const original={reflection:'我能解释原因',rating:'relearn',dueAt:1},before=structuredClone(original);
 const rated=updateStudyCheck(original,'rating','explain',now),scheduled=updateStudyCheck(rated,'schedule',3,now);
 assert.deepEqual(original,before);assert.equal(scheduled.reflection,original.reflection);assert.equal(scheduled.rating,'explain');
 const expected=new Date(now);expected.setDate(expected.getDate()+3);assert.equal(scheduled.dueAt,expected.getTime());assert.equal(scheduled.ratedAt,now);
 assert.ok(!('score' in scheduled));assert.ok(!('completed' in scheduled));
});
test('finishing a review clears only its appointment and preserves the self assessment',()=>{
 const original=updateStudyCheck({reflection:'新的场景',rating:'apply'},'schedule',1,now);
 const done=updateStudyCheck(original,'reviewed',undefined,now+1000);assert.equal(done.dueAt,0);assert.equal(done.reviewedAt,now+1000);assert.equal(done.reflection,original.reflection);assert.equal(done.rating,'apply');
 assert.equal(updateStudyCheck(done,'cancel',undefined,now+2000).reviewedAt,now+1000);
});
test('imported malformed fields are bounded and cannot become a bogus progress rating',()=>{
 const result=normalizeStudyCheck({reflection:'文'.repeat(4000),rating:'100分',dueAt:Infinity,ratedAt:-1,reviewedAt:'now',apiKey:'do-not-export'});
 assert.equal(result.reflection.length,3000);assert.equal(result.rating,'');assert.equal(result.dueAt,0);assert.ok(!('apiKey' in result));
 assert.throws(()=>updateStudyCheck({},'schedule',0,now));assert.throws(()=>updateStudyCheck({},'rating','guaranteed',now));
});
test('review queue uses only scheduled existing lessons and correctly separates future items',()=>{
 const lessons=[{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',title:'C'}],records={a:{studyCheck:{dueAt:now+5000}},b:{studyCheck:{dueAt:now-1}},c:{studyCheck:{dueAt:0}},gone:{studyCheck:{dueAt:now-10}}};
 const rows=scheduledReviews(lessons,records,now);assert.deepEqual(rows.map(r=>r.id),['b','a']);assert.equal(rows[0].due,true);assert.equal(rows[1].due,false);assert.equal(records.c.studyCheck.dueAt,0);
});
test('reflection and goal text render literally; return links select the correct conclusion stage',()=>{
 const html=studyCheckMarkup({reflection:'</textarea><script>alert(1)</script>'},{goals:['<img src=x>'],kind:'japanese'});
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;/textarea&gt;'));assert.ok(html.includes('&lt;img src=x&gt;'));
 const lessons=[{id:'safe',title:'A'}],records={safe:{studyCheck:{dueAt:now}}};
 assert.match(studyQueueMarkup(lessons,records,{kind:'frontend',now}),/stage=conclusion/);
 assert.match(studyQueueMarkup(lessons,records,{kind:'japanese',now}),/stage=summary/);
 assert.match(studyQueueMarkup([],{}, {now}),/还没有安排/);
});
