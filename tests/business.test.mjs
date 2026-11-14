import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const lessons=JSON.parse(await readFile(new URL('../public/data/business.json',import.meta.url),'utf8'));
test('商务课程覆盖三个阶段，每课有完整教学和真实任务',()=>{
  assert.ok(lessons.length>=40);
  assert.equal(new Set(lessons.map(l=>l.id)).size,lessons.length);
  assert.equal(new Set(lessons.map(l=>l.title)).size,lessons.length);
  assert.deepEqual([...new Set(lessons.map(l=>l.level))].sort(),['N1','N2','N3']);
  for(const l of lessons){
    assert.equal(l.track,'business');assert.ok(l.id.startsWith('b-'));
    assert.ok(l.sections.length>=3,l.id);
    for(const section of l.sections){assert.ok(section.heading);assert.ok(section.body.join('').length>=60,l.id);}
    const examples=l.sections.flatMap(s=>s.examples);
    assert.ok(examples.length>=2,l.id);
    examples.forEach(e=>{assert.ok(e.ja.length>8);assert.ok(e.zh.length>5);assert.ok(!e.ja.includes('¦'));});
    assert.ok(l.summary.professional.length>60);assert.ok(l.summary.plain.length>30);
    assert.ok(!/TODO|待补充|占位符|報表機能/.test(JSON.stringify(l)));
  }
});
test('客观题答案索引、解析与选项有效，答案位置均衡',()=>{
  const positions=new Set();const ids=new Set();
  for(const l of lessons){
    assert.equal(l.quiz.filter(q=>q.introducedIn!=='1.7.0').length,3,l.id);
    for(const q of l.quiz){
      assert.ok(!ids.has(q.id));ids.add(q.id);assert.equal(q.type,'choice');
      assert.ok(q.prompt.length>10);assert.equal(q.options.length,3);
      assert.equal(new Set(q.options).size,3,q.id);
      assert.ok(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.options.length);
      assert.ok(q.explanation.endsWith(q.options[q.answer]),q.id);
      assert.ok(q.explanation.length>q.options[q.answer].length+20,q.id);
      positions.add(q.answer);
    }
  }
  assert.equal(positions.size,3);
});
test('每课包含双向翻译与可独立完成的角色扮演',()=>{
  const examples=new Set(),tasks=new Set();
  for(const l of lessons){
    const originalTranslations=l.translation.filter(t=>t.introducedIn!=='1.7.0');
    assert.equal(originalTranslations.length,2);
    assert.deepEqual(originalTranslations.map(t=>t.direction).sort(),['ja-zh','zh-ja']);
    l.translation.forEach(t=>{assert.ok(t.prompt.length>5,t.id);assert.ok(t.reference.length>5,t.id);assert.ok(t.notes.length>=2);examples.add(t.reference);});
    assert.ok(l.speaking.length>=1);
    for(const s of l.speaking){assert.ok(s.scene.length>15);assert.ok(s.task.length>20);assert.ok(s.modelAnswer.length>30);assert.ok(s.checks.length>=3);tasks.add(s.task);}
  }
  assert.ok(examples.size>=lessons.length*1.9);
  assert.equal(tasks.size,lessons.length);
});
test('五分类、许可受益和二重敬语保留官方核验来源',()=>{
  for(const id of ['b-five-keigo','b-sasete','b-double-keigo']){
    const l=lessons.find(x=>x.id===id);assert.ok(l);
    assert.ok(l.sourceRefs.some(u=>new URL(u).hostname==='www.bunka.go.jp'));
  }
  assert.ok(lessons.find(l=>l.id==='b-double-keigo').sourceRefs.some(u=>new URL(u).hostname==='kotoba.ninjal.ac.jp'));
  const headings=lessons.map(l=>l.title).join('\n');
  for(const topic of ['电话','邮件','交期','需求','报价','交接','验收','口译','会议','翻译']) assert.ok(headings.includes(topic),topic);
});
