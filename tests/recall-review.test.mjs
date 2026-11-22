import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoachMessages, coachReply } from '../lib/coach.mjs';
import { sectionAnswers, buildSectionAssignment } from '../public/section-assignment.js';

const lesson = {
  id: 'recall-test',
  title: '敬语与请求表达',
  level: 'N2',
  track: 'business',
  goals: ['区分尊敬语与谦让语', '礼貌地向客户确认日程'],
  sections: [{ heading: '核心说明', body: ['对外部对象抬高对方、放低己方。'] }],
  summary: { professional: '依据内外关系选择尊敬语或谦让语。', plain: '对别人客气抬高，说自己放低姿态。' },
  quiz: [{ id: 'q1', type: 'choice', prompt: '给客户发资料时说？', options: ['お送りいたします', 'お送りになります'], answer: 0, explanation: '自己动作使用谦让语。' }],
  translation: [{ id: 't1', direction: 'zh-ja', prompt: '我稍后把资料发给您。', reference: '後ほど資料をお送りいたします。' }],
  speaking: [{ id: 's1', scene: '邮件确认', task: '确认会议时间', modelAnswer: 'ご都合はいかがでしょうか。' }],
};

test('recall 模式要求填写「我的回忆与例子」，由服务端重建权威任务并支持 OpenAI 与 Gemini', async () => {
  assert.throws(() => buildCoachMessages({ lessonId: lesson.id, mode: 'recall', submission: '   ', question: '评审' }, lesson), /我的回忆与例子/);
  assert.throws(() => buildCoachMessages({ lessonId: lesson.id, mode: 'recall', submission: 'あ'.repeat(3001), question: '评审' }, lesson), /3,000/);

  for (const provider of ['openai', 'gemini']) {
    let captured;
    const out = await coachReply({
      config: { provider, baseUrl: provider === 'gemini' ? 'https://example.test/v1beta' : 'http://127.0.0.1:9988/v1', model: 'mock', apiKey: 'fake-key' },
      lessonId: lesson.id,
      contextId: lesson.id + ':review:recall1',
      mode: 'recall',
      submission: '核心意思：对客户用谦让语。\n我的例子：後ほど資料をお送りいたします。\n疑问：いつ使える？',
      context: { task: { rating: 'apply', summary: { professional: '伪造总结' } } },
      question: '请评审我的回忆与例子。',
    }, lesson, {
      fetchImpl: async (_url, options) => {
        captured = JSON.parse(options.body);
        return new Response(JSON.stringify(provider === 'gemini'
          ? { candidates: [{ content: { parts: [{ text: '教学参考分 90 分（非 JLPT 官方分数）：例句自然。' }] } }] }
          : { choices: [{ message: { content: '教学参考分 90 分（非 JLPT 官方分数）：例句自然。' } }] }));
      },
    });
    assert.match(out.reply, /90 分/);
    const serialized = JSON.stringify(captured);
    assert.match(serialized, /お送りいたします/);
    assert.match(serialized, /区分尊敬语与谦让语/);
    assert.ok(!serialized.includes('伪造总结'));
    assert.ok(!serialized.includes('fake-key'));
  }
});

test('小节统一评阅自动纳入已填写的「我的回忆与例子」，未填写时保持原有结构不变', () => {
  const baseRecord = {
    answers: { q1: 0 },
    submittedAnswers: { q1: 0 },
    quizAt: 1,
    drafts: { t1: '後ほど資料をお送りいたします。', s1: '' },
    reviews: [],
  };
  const withoutRecall = sectionAnswers(lesson, baseRecord);
  assert.equal(Object.hasOwn(withoutRecall, 'reflection'), false);
  assert.equal(Object.hasOwn(buildSectionAssignment(lesson, withoutRecall).task, 'recall'), false);

  const withRecallRecord = {
    ...baseRecord,
    studyCheck: { reflection: '谦让语用于降低己方动作。\n例：資料を拝見いたしました。', rating: 'explain' },
  };
  const answers = sectionAnswers(lesson, withRecallRecord);
  assert.equal(answers.reflection, withRecallRecord.studyCheck.reflection);
  assert.equal(answers.rating, 'explain');
  const built = buildSectionAssignment(lesson, answers);
  assert.equal(built.task.recall.reflection, withRecallRecord.studyCheck.reflection);
  assert.equal(built.task.recall.rating, 'explain');
  assert.match(built.submission, /我的回忆与例子/);
  assert.match(built.submission, /資料を拝見いたしました/);

  assert.throws(() => buildSectionAssignment(lesson, { ...answers, reflection: 'あ'.repeat(3001) }), /3,000/);
});

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedNovels } from '../lib/seed-novels.mjs';
import { createNovelStore } from '../lib/novel-store.mjs';

test('seed/novels 包含 6 部公版名著与 6 部 CC BY 4.0 轻小说且均可正常载入阅读', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jp-seed-12-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const seedDir = fileURLToPath(new URL('../seed/novels', import.meta.url));
  await seedNovels(seedDir, root);
  const store = createNovelStore(root);
  const { books } = await store.list();
  assert.equal(books.length, 12);
  const ccBooks = books.filter(b => /CC BY 4\.0/.test(b.license || ''));
  assert.equal(ccBooks.length, 6);
  for (const book of ccBooks) {
    assert.ok(book.chapters.length >= 10, book.title);
    assert.ok(book.totalCharacters >= 30000, book.title);
    const first = await store.get(book.id, book.chapters[0].id);
    assert.ok(first.chapter.paragraphs.length > 0, book.title);
  }
});
