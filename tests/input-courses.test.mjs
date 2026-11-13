import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = track => JSON.parse(readFileSync(new URL('../public/data/' + track + '.json', import.meta.url), 'utf8'));
const foundation = read('foundation');
const reading = read('reading');
const listening = read('listening');
const all = [...foundation, ...reading, ...listening];
const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
const japaneseLength = text => [...text.matchAll(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu)].length;

test('original input curriculum covers 12 foundation, 20 reading and 15 listening lessons', () => {
  assert.equal(foundation.length, 12);
  assert.equal(reading.length, 20);
  assert.equal(listening.length, 15);
  assert.equal(new Set(all.map(x => x.id)).size, all.length);
  for (const level of levels) {
    assert.equal(reading.filter(x => x.level === level).length, 4);
    assert.equal(listening.filter(x => x.level === level).length, 3);
  }
});

test('each lesson teaches before practice and has complete objective, translation and speaking tasks', () => {
  for (const lesson of all) {
    assert.ok(lesson.title && lesson.subtitle && lesson.goals.length >= 3, lesson.id);
    assert.ok(lesson.sections.length >= 3, lesson.id);
    assert.ok(lesson.sections.every(x => x.body.length && x.body.join('').length > 100 && x.body.every(p => typeof p === 'string' && p.trim())), lesson.id);
    assert.ok(lesson.sections.flatMap(x => x.examples).length >= 2, lesson.id);
    assert.ok(lesson.quiz.length >= 3 && lesson.quiz.length <= 5, lesson.id);
    assert.equal(new Set(lesson.quiz.map(x => x.id)).size, lesson.quiz.length);
    for (const question of lesson.quiz) {
      assert.ok(question.prompt && question.explanation.length > 8, question.id);
      if (question.type === 'choice') {
        assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < question.options.length, question.id);
        assert.equal(new Set(question.options).size, question.options.length);
      } else {
        assert.equal(question.type, 'fill');
        assert.ok(question.accepted.includes(question.answer));
      }
    }
    assert.equal(lesson.translation.length, 2);
    assert.deepEqual(new Set(lesson.translation.map(x => x.direction)), new Set(['zh-ja', 'ja-zh']));
    assert.ok(lesson.translation.every(x => x.prompt && x.reference && x.notes.length));
    assert.ok(lesson.speaking.length >= 1);
    assert.ok(lesson.speaking.every(x => x.scene && x.task && x.modelAnswer && x.checks.length >= 3));
    assert.ok(lesson.summary.professional && lesson.summary.plain);
    assert.match(lesson.sourceNote, /原创/);
    assert.match(lesson.levelNote, /参考/);
    assert.ok(!/TODO|待补充|稍后完善/u.test(JSON.stringify(lesson)));
  }
});

test('reading passages get longer by level and N1 exceeds 500 Japanese characters', () => {
  let previousAverage = 0;
  const texts = reading.map(x => x.sections[0].body.join('\n'));
  assert.equal(new Set(texts).size, reading.length);
  for (const level of levels) {
    const group = reading.filter(x => x.level === level);
    const average = group.reduce((sum, x) => sum + japaneseLength(x.sections[0].body.join('')), 0) / group.length;
    assert.ok(average > previousAverage, level);
    previousAverage = average;
    for (const lesson of group) {
      assert.ok(lesson.sections[0].translation.length > 80, lesson.id);
      if (level === 'N1') assert.ok(japaneseLength(lesson.sections[0].body.join('')) >= 500, lesson.id);
    }
  }
});

test('listening scripts are original, labelled synthetic, hidden from teaching body and support exact dictation', () => {
  const scripts = [];
  for (const lesson of listening) {
    assert.equal(lesson.listening.length, 1);
    const exercise = lesson.listening[0];
    scripts.push(exercise.script);
    assert.equal(exercise.audioMode, 'speech-synthesis');
    assert.match(exercise.audioNotice, /合成/);
    assert.ok(exercise.translation.length > 80);
    assert.ok(exercise.script.split('\n').length >= 6);
    assert.ok(exercise.questions.length >= 3);
    assert.deepEqual(exercise.questions, lesson.quiz, 'same comprehension questions should be presented once');
    assert.ok(exercise.dictation.prompt && exercise.dictation.hint);
    assert.ok(exercise.script.includes(exercise.dictation.answer), exercise.id + ' dictation must be audible verbatim');
    assert.ok(!lesson.sections.some(section => section.body.some(p => p.includes(exercise.script))));
    if (lesson.level === 'N1') assert.ok(japaneseLength(exercise.script) >= 350, lesson.id);
  }
  assert.equal(new Set(scripts).size, scripts.length);
});

test('long-vowel teaching includes the nasal mora in aunt/grandmother contrast', () => {
  const lesson = foundation.find(x => x.id === 'foundation-mora-length');
  const contrast = lesson.sections.flatMap(x => x.examples).find(x => x.ja === 'おばさん／おばあさん');
  assert.match(contrast.note, /四拍与五拍/);
  assert.match(contrast.note, /ん.*一拍/);
});
