import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gradeQuestions } from '../public/learning-core.js';

const root = new URL('../', import.meta.url);
const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
const curricula = await Promise.all(levels.map(async level => ({
  level,
  lessons: JSON.parse(await readFile(new URL(`public/data/grammar-${level.toLowerCase()}.json`, root), 'utf8')),
  source: (await readFile(new URL(`scripts/build-grammar-${level.toLowerCase()}.tsv`, root), 'utf8')).trim().split(/\r?\n/).map(line => line.split('¦'))
})));
const all = curricula.flatMap(course => course.lessons);
const lessonById = new Map(all.map(lesson => [lesson.id, lesson]));
const examplesOf = lesson => lesson.sections.flatMap(section => section.examples || []);
const text = (value, message, min = 1) => assert.ok(typeof value === 'string' && value.trim().length >= min, message);

test('five grammar levels each contain substantial, distinct lessons', () => {
  const minimum = { N5: 45, N4: 50, N3: 45, N2: 45, N1: 45 };
  assert.ok(all.length >= 230);
  assert.equal(lessonById.size, all.length, 'lesson IDs must be globally unique');
  assert.equal(new Set(all.map(lesson => lesson.title)).size, all.length, 'do not duplicate lessons under new IDs');
  for (const { level, lessons } of curricula) {
    assert.ok(lessons.length >= minimum[level], `${level} is incomplete`);
    assert.ok(lessons.every(lesson => lesson.level === level && lesson.track === 'grammar'));
  }
});

test('every lesson teaches meaning, form, context, two examples, and a usage boundary before assessment', () => {
  const seenExamples = new Map();
  for (const lesson of all) {
    assert.ok(lesson.sections.length >= 4, lesson.id);
    assert.ok(lesson.goals.length >= 3, lesson.id);
    text(lesson.subtitle, lesson.id);
    const body = lesson.sections.flatMap(section => section.body || []);
    assert.ok(body.join('').length >= 160, `${lesson.id} has too little teaching text`);
    const examples = examplesOf(lesson);
    assert.ok(examples.length >= 2, lesson.id);
    for (const example of examples) {
      text(example.ja, lesson.id, 6);
      text(example.zh, lesson.id, 4);
      assert.ok(/[ぁ-ゖァ-ヺ]/u.test(example.ja), `${lesson.id} missing Japanese text`);
      assert.ok(!/[{}]/.test(example.ja), `${lesson.id} leaked exercise markers`);
      assert.ok(!seenExamples.has(example.ja), `${lesson.id} repeats example from ${seenExamples.get(example.ja)}`);
      seenExamples.set(example.ja, lesson.id);
    }
    text(lesson.summary.professional, lesson.id, 25);
    text(lesson.summary.plain, lesson.id, 25);
  }
});

test('questions have unique IDs, unambiguous answer formats, distinct choices and explanations', () => {
  const ids = new Set();
  for (const lesson of all) {
    assert.ok(lesson.quiz.length >= 4, lesson.id);
    assert.ok(lesson.quiz.some(q => q.type === 'fill'), lesson.id);
    assert.ok(lesson.quiz.some(q => q.type === 'choice'), lesson.id);
    for (const q of lesson.quiz) {
      assert.ok(q.id.startsWith(`${lesson.id}-`));
      assert.ok(!ids.has(q.id), `duplicate exercise ${q.id}`);
      ids.add(q.id);
      text(q.prompt, q.id);
      text(q.explanation, q.id, 10);
      if (q.type === 'choice') {
        assert.ok(q.options.length >= 3, q.id);
        assert.equal(new Set(q.options).size, q.options.length, `${q.id} repeats distractors`);
        q.options.forEach(option => text(option, q.id));
        assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, q.id);
      } else {
        assert.equal(q.type, 'fill', q.id);
        text(q.answer, q.id);
        assert.ok(q.accepted.includes(q.answer), q.id);
        assert.ok(examplesOf(lesson).some(example => example.ja.includes(q.answer)), `${q.id} answer not represented in taught examples`);
      }
    }
    for (const exercise of [...lesson.translation, ...lesson.speaking]) {
      assert.ok(exercise.id.startsWith(`${lesson.id}-`));
      assert.ok(!ids.has(exercise.id), `duplicate exercise ${exercise.id}`);
      ids.add(exercise.id);
    }
  }
});

test('each lesson includes bidirectional translation and transferable speaking practice', () => {
  for (const lesson of all) {
    assert.deepEqual(new Set(lesson.translation.map(item => item.direction)), new Set(['zh-ja', 'ja-zh']), lesson.id);
    for (const item of lesson.translation) {
      text(item.prompt, item.id, 4);
      text(item.reference, item.id, 4);
      assert.ok(item.notes.length >= 2, item.id);
    }
    assert.ok(lesson.speaking.length >= 1, lesson.id);
    for (const item of lesson.speaking) {
      text(item.scene, item.id, 10);
      text(item.task, item.id, 20);
      text(item.modelAnswer, item.id, 6);
      assert.ok(item.checks.length >= 3, item.id);
    }
  }
});

test('advanced written patterns also teach natural spoken paraphrase', () => {
  for (const lesson of curricula.find(course => course.level === 'N1').lessons) {
    const speaking = lesson.speaking[0];
    assert.ok(speaking.task.includes('自然、易懂的日语'), lesson.id);
    assert.ok(speaking.task.includes('否定、时间关系'), lesson.id);
    assert.ok(!examplesOf(lesson).some(example => example.ja === speaking.modelAnswer), `${lesson.id} needs an actual spoken paraphrase`);
    assert.ok(speaking.modelAnswer.length >= 25, lesson.id);
    assert.equal(speaking.sourceSentence, examplesOf(lesson)[1].ja, `${lesson.id} spoken task is bound to another example`);
    assert.ok(speaking.task.includes(speaking.sourceSentence), `${lesson.id} does not display the bound source sentence`);
  }
  const first = lessonById.get('g-n1-001').speaking[0];
  assert.ok(first.modelAnswer.includes('扉が開く') && first.modelAnswer.includes('中へ入りました'), 'door-opening task must paraphrase the waiting crowd entering');
  assert.ok(!first.modelAnswer.includes('現場'), 'do not substitute the unrelated first example about going to an incident site');
});

test('grammar blanks accept legitimate kana spelling without accepting conjugation errors', () => {
  const fill = id => lessonById.get(id).quiz.find(q => q.type === 'fill');
  for (const [id, answer] of [['g-n5-038','あけて'],['g-n5-022','いきたい'],['g-n4-005','いったことがあります'],['g-n3-036','あいだに'],['g-n2-042','えます'],['g-n1-015','をきんじえません'],['g-n1-019','にあたいします']]) {
    const q = fill(id);
    assert.equal(gradeQuestions([q], { [q.id]: answer }).correct, 1, `${id} rejects a valid kana answer`);
  }
  for (const [id, answer] of [['g-n5-038','あけって'],['g-n2-042','うます'],['g-n1-019','にねします']]) {
    const q = fill(id);
    assert.equal(gradeQuestions([q], { [q.id]: answer }).correct, 0, `${id} accepts an incorrect reading or inflection`);
  }
  for (const lesson of all) for (const q of lesson.quiz.filter(q => q.type === 'fill' && /[\u3400-\u9fff]/u.test(q.answer))) {
    assert.ok(q.accepted.some(a => !/[\u3400-\u9fff]/u.test(a)), `${q.id} has no kana alternative`);
  }
});

test('morphology lessons ask for concrete utterances instead of saying a meta title', () => {
  for (const lesson of all) for (const speaking of lesson.speaking) {
    assert.ok(!/使用「[^」]*(?:分组|形音变|形容词|助数词|词否定|词过去|频率副词|小句修饰名词)/.test(speaking.task), `${lesson.id} treats a teaching title as a Japanese phrase`);
  }
  assert.ok(lessonById.get('g-n5-036').speaking[0].task.includes('読む、食べる、勉強する'));
  assert.ok(lessonById.get('g-n5-038').speaking[0].task.includes('连接两个动作'));
  assert.ok(lessonById.get('g-n3-001').speaking[0].task.includes('动作执行者'));
});

test('editable source records and published lesson examples remain synchronized', () => {
  for (const { level, lessons, source } of curricula) {
    assert.equal(source.length, lessons.length, level);
    source.forEach((fields, index) => {
      assert.equal(fields.length, 9, `${level} source row ${index + 1}`);
      fields.forEach(field => text(field, `${level} source row ${index + 1}`));
      const id = `g-${level.toLowerCase()}-${String(index + 1).padStart(3, '0')}`;
      const lesson = lessonById.get(id);
      assert.ok(lesson, id);
      assert.equal(lesson.title, fields[0], id);
      const [first, second] = examplesOf(lesson);
      assert.equal(first.ja, fields[4].replace(/[{}]/g, ''), id);
      assert.equal(first.zh, fields[5], id);
      assert.equal(second.ja, fields[6], id);
      assert.equal(second.zh, fields[7], id);
    });
  }
});

test('beginner learning order introduces conjugation before dependent applications', () => {
  const course = curricula.find(course => course.level === 'N5').lessons;
  const position = id => course.findIndex(lesson => lesson.id === id);
  assert.ok(position('g-n5-036') < position('g-n5-037'), 'learn verb groups before polite conjugation');
  assert.ok(position('g-n5-038') < position('g-n5-025'), 'learn te-form before requests');
  assert.ok(position('g-n5-038') < position('g-n5-028'), 'learn te-form before progressive aspect');
  assert.ok(position('g-n5-019') < position('g-n5-042'), 'learn adjectives before past adjective forms');
  assert.ok(lessonById.get('g-n5-001').sections.some(section => section.body?.some(paragraph => paragraph.includes('句子的零件'))), 'first lesson must introduce the concepts, not just name a pattern');
  const firstTranslation = lessonById.get('g-n5-001').translation.find(task => task.direction === 'zh-ja');
  assert.equal(firstTranslation.prompt, '我是留学生。');
  assert.equal(firstTranslation.reference, '私は留学生です。', 'first lesson must not require an untaught relative clause');
});

test('reviewed edge cases retain accurate polarity, conjugation and teaching-level caveats', () => {
  const allText = JSON.stringify(all);
  assert.ok(!/[\uAC00-\uD7AF\uFFFD]/u.test(allText), 'unexpected Korean characters or broken encoding');
  assert.ok(!/TODO|TBD|待补充|示例占位/.test(allText), 'unfinished content leaked into publication');
  for (const lesson of all) {
    assert.ok(lesson.levelNote.includes('未公布固定语法清单'), lesson.id);
    assert.ok(lesson.sourceNote.includes('原创'), lesson.id);
    assert.ok(lesson.sourceRefs.length >= 1 && lesson.sourceRefs.every(url => new URL(url).protocol === 'https:'), lesson.id);
  }
  const applicationAnswer = id => {
    const item = lessonById.get(id).quiz.find(item => item.id.endsWith('-q5'));
    assert.ok(item, `${id} needs its contextual discrimination question`);
    return item.options[item.answer];
  };
  assert.equal(applicationAnswer('g-n5-038'), '読む→読んで；行く→行って');
  assert.equal(applicationAnswer('g-n4-035'), 'おいしそうです。');
  assert.equal(applicationAnswer('g-n4-036'), '明日は休みだそうです。');
  assert.equal(applicationAnswer('g-n3-025'), '不是所有人都赞成');
  assert.equal(applicationAnswer('g-n2-040'), '可能引起误解，需要注意');
  assert.equal(applicationAnswer('g-n1-016'), '对大家合作不胜感激');
});
