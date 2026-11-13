import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflectedReading, toHiragana } from '../scripts/reader-build-core.mjs';

const read = async name => JSON.parse(await readFile(new URL('../' + name, import.meta.url), 'utf8'));
const reader = await read('public/data/reader.json');
const meta = await read('public/data/reader-meta.json');
const uncovered = await read('public/data/reader-uncovered.json');
const overrides = await read('scripts/reader-overrides.json');
const lessons = (await Promise.all(Object.keys(meta.inputs).map(name => read('public/data/' + name)))).flat();
const segments = Object.values(reader.lessons).flatMap(l => l.paragraphs.flatMap(p => p.segments));
const han = /[\u3400-\u4dbf\u4e00-\u9fff々〆ヶ]/u;
const phrase = (lesson, text) => reader.lessons[lesson].paragraphs.flatMap(p => p.segments).filter(s => s.text === text);

test('all textbook paragraphs reconstruct exactly, including internal paragraph breaks', async () => {
  assert.equal(Object.keys(reader.lessons).length, 351);
  let count = 0;
  for (const lesson of lessons) {
    const actual = reader.lessons[lesson.id].paragraphs;
    assert.equal(actual.length, lesson.textbook.paragraphs.length, lesson.id);
    for (let i = 0; i < actual.length; i++) {
      count++;
      assert.equal(actual[i].text, lesson.textbook.paragraphs[i].ja, lesson.id);
      assert.equal(actual[i].segments.map(s => s.text).join(''), actual[i].text, lesson.id);
      assert.ok(actual[i].segments.every(s => typeof s.text === 'string' && s.text.length > 0));
    }
  }
  assert.equal(count, meta.counts.paragraphs);
  for (const [name, hash] of Object.entries(meta.inputs)) {
    const body = await readFile(new URL('../public/data/' + name, import.meta.url));
    assert.equal(createHash('sha256').update(body).digest('hex'), hash, 'stale build: ' + name);
  }
});

test('all written kanji have valid surface kana while punctuation remains untouched', () => {
  let total = 0;
  for (const segment of segments) {
    if (segment.reading) assert.match(segment.reading, /^[ぁ-ゖー]+$/u);
    if (han.test(segment.text)) {
      assert.ok(segment.reading, 'missing reading: ' + segment.text);
      total += [...segment.text].filter(c => han.test(c)).length;
    }
    if (/^[\s、。「」『』（）()！？!?：:・,.;]+$/.test(segment.text))
      assert.ok(!segment.wordId, 'punctuation must not be a fake word');
  }
  assert.equal(total, meta.counts.hanCharacters);
  assert.equal(meta.counts.hanCharacters, meta.counts.annotatedHanCharacters);
  assert.equal(uncovered.unannotatedHan.length, 0);
});

test('every scoped reading correction survives the final compound and dictionary pass', () => {
  let checked = 0;
  for (const rule of overrides) {
    const paragraph = reader.lessons[rule.lessonId].paragraphs[rule.paragraph || 0];
    const positions = []; let at = 0;
    while (at <= paragraph.text.length - rule.surface.length) {
      const found = paragraph.text.indexOf(rule.surface, at); if (found < 0) break;
      positions.push(found); at = found + rule.surface.length;
    }
    let ruleHits = 0;
    positions.forEach((start, occurrence) => {
      if (rule.occurrence != null && rule.occurrence !== occurrence) return;
      if (rule.before && !paragraph.text.slice(0, start).endsWith(rule.before)) return;
      if (rule.after && !paragraph.text.slice(start + rule.surface.length).startsWith(rule.after)) return;
      let cursor = 0;
      const segment = paragraph.segments.find(s => { const hit = cursor === start; cursor += s.text.length; return hit; });
      assert.ok(segment, rule.lessonId + ' override boundary');
      assert.equal(segment.text, rule.surface, rule.lessonId);
      assert.equal(segment.reading, toHiragana(rule.reading), rule.lessonId + ' / ' + rule.surface);
      checked++; ruleHits++;
    });
    assert.ok(ruleHits > 0, 'unused override: ' + JSON.stringify(rule));
  }
  assert.equal(overrides.length, meta.counts.contextOverrides);
  assert.ok(checked >= overrides.length);
  assert.equal(uncovered.courseReadingConflicts.length, 0);
});

test('homographs resolve by context, not by written form alone', () => {
  assert.equal(phrase('g-n5-001', '林')[0].reading, 'りん');
  assert.equal(phrase('g-n5-001', '日本人')[0].reading, 'にほんじん');
  assert.equal(phrase('g-n4-001', '雨')[0].reading, 'あめ');
  assert.equal(phrase('g-n4-035', '降り')[0].reading, 'ふり');
  assert.equal(phrase('g-n3-010', '開いた')[0].reading, 'ひらいた');
  assert.equal(phrase('reading-n3-common-space', '行った')[0].reading, 'おこなった');
  assert.equal(phrase('g-n2-001', '十分')[0].reading, 'じゅっぷん');
  assert.equal(phrase('it-data-model', '値')[0].reading, 'あたい');
  assert.equal(phrase('reading-n4-cooking', '辛い')[0].reading, 'からい');
});

test('inflected and respectful surfaces keep their own reading and expose the dictionary lemma', () => {
  const application = phrase('g-n4-014', '申し込ん')[0];
  assert.equal(application.reading, 'もうしこん');
  assert.equal(application.lemma, '申し込む');
  const walk = phrase('g-n2-031', '歩ける')[0];
  assert.equal(walk.reading, 'あるける');
  assert.equal(walk.lemma, '歩く');
  const send = phrase('g-n3-006', 'お送り')[0];
  assert.equal(send.reading, 'おおくり');
  assert.equal(send.lemma, '送る');
  assert.equal(phrase('g-n4-020', '来')[0].reading, 'こ');
  assert.equal(phrase('g-n5-015', '来')[0].reading, 'き');
  assert.ok(!segments.some(s => ['許可ない', 'ほかなる'].includes(s.lemma)));
});

test('inflection helpers reject irregular kanji readings instead of inventing くました or いかった', () => {
  for (const surface of ['来ました', '来て', '来ない', '来れば'])
    assert.equal(inflectedReading({ word: '来る', reading: 'くる' }, surface), null);
  assert.equal(inflectedReading({ word: '連れて来る', reading: 'つれてくる' }, '連れて来た'), null);
  assert.equal(inflectedReading({ word: '良い', reading: 'いい' }, '良かった'), null);
  assert.equal(inflectedReading({ word: '懐かしい', reading: 'なつかしい' }, '懐かしく'), 'なつかしく');
  assert.equal(inflectedReading({ word: '出来る', reading: 'できる' }, '出来た'), 'できた');
});

test('data reports real coverage and retains source attribution without shipping runtime npm dependencies', async () => {
  assert.equal(segments.length, meta.counts.segments);
  assert.equal(reader.words.length, meta.counts.additionalWords);
  assert.ok(meta.counts.linkedContentSegments / meta.counts.contentSegments > .99);
  assert.equal(uncovered.unlinkedContentWords.length, meta.counts.contentSegments - meta.counts.linkedContentSegments);
  for (const word of reader.words) {
    assert.ok(word.meaning?.trim() && word.source && word.sourceId);
    assert.match(word.reading, /^[ぁ-ゖー]+$/u);
    if (word.sourceId === 'tomoshi-jmdict') assert.ok(word.entryIds?.length && word.senses.length);
  }
  for (const notice of meta.notices)
    assert.ok((await readFile(new URL('../public/data/' + notice, import.meta.url), 'utf8')).length > 300);
  assert.equal(meta.dictionary.license, 'CC-BY-SA-4.0');
  assert.equal(meta.analyzer.license, 'Apache-2.0');
});
