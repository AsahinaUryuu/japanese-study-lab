import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const data = fileURLToPath(new URL('../public/data/', import.meta.url));
const read = name => JSON.parse(readFileSync(path.join(data, name), 'utf8'));
const vocabulary = read('vocabulary.json');
const kanji = read('kanji.json');
const resources = read('resources.json');
const meta = read('vocabulary-meta.json');
const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];

test('vocabulary covers all levels with at least 8,000 distinct verified word/reading pairs', () => {
  assert.ok(vocabulary.length >= 8000);
  assert.equal(new Set(vocabulary.map(x => x.id)).size, vocabulary.length);
  assert.equal(new Set(vocabulary.map(x => `${x.word}\0${x.reading}`)).size, vocabulary.length);
  for (const level of levels) assert.ok(vocabulary.filter(x => x.level === level).length >= 600, level);
  for (const word of vocabulary) {
    assert.ok(word.word && word.reading && word.meaning, word.id);
    assert.equal(word.meaningLang, 'zh', word.word);
    assert.ok(word.entryId && word.sourceId && word.levelSource, word.word);
    assert.ok(levels.includes(word.level));
    assert.ok(!/[\uFFFD]/u.test(word.word + word.reading + word.meaning), word.word);
    assert.ok(word.senses.length >= 1);
  }
});

test('basic words and corrected ambiguous readings retain usable Chinese definitions', () => {
  const find = (word, reading) => vocabulary.find(x => x.word === word && x.reading === reading);
  assert.match(find('学校', 'がっこう').meaning, /学校/);
  assert.match(find('食べる', 'たべる').meaning, /吃|食/);
  assert.equal(find('管', 'くだ').entryId, '2868440');
  assert.notEqual(find('管', 'くだ').entryId, '1577650');
  assert.equal(vocabulary.some(x => x.word === '依' && x.reading === 'い'), false);
});

test('kanji have distinct characters, readings, strokes, attributed definitions and all levels', () => {
  assert.ok(kanji.length >= 2100);
  assert.equal(new Set(kanji.map(x => x.char)).size, kanji.length);
  for (const item of kanji) {
    assert.equal([...item.char].length, 1);
    assert.ok(item.meaning && item.strokes >= 1 && item.strokes <= 64, item.char);
    assert.ok(Array.isArray(item.onyomi) && Array.isArray(item.kunyomi));
    assert.ok(item.onyomi.length + item.kunyomi.length > 0, item.char);
    assert.ok(['zh', 'en'].includes(item.meaningLang));
    assert.ok(levels.includes(item.level));
  }
});

test('metadata counts agree and required attribution accompanies derived data', () => {
  assert.equal(meta.vocabularyCount, vocabulary.length);
  assert.equal(meta.kanjiCount, kanji.length);
  for (const level of levels) {
    assert.equal(meta.vocabularyByLevel[level], vocabulary.filter(x => x.level === level).length);
    assert.equal(meta.kanjiByLevel[level], kanji.filter(x => x.level === level).length);
  }
  assert.equal(meta.license, 'CC-BY-SA-4.0');
  assert.match(meta.levelNotice, /社区/);
  assert.match(meta.translationNotice, /AI/);
  assert.ok(meta.sources.every(source => /^https:\/\//u.test(source.url)));
  for (const file of ['tomoshi-LICENSE.md', 'tomoshi-NOTICE.md', 'waller-license.txt', 'edrdg-license.html']) {
    assert.ok(existsSync(path.join(data, 'licenses', file)), file);
  }
});

test('local library indexes source files safely without treating reading levels as JLPT levels', () => {
  assert.equal(resources.length, 0, 'Public release must not include a private library index');
  
  assert.equal(new Set(resources.map(x => x.id)).size, resources.length);
  for (const resource of resources) {
    assert.ok(!path.isAbsolute(resource.relativePath));
    assert.ok(!resource.relativePath.split(/[\\/]/u).includes('..'));
    assert.ok(!resource.relativePath.startsWith('hsqsl/'));
    assert.ok(resource.bytes > 0);
    if (resource.kind === 'pdf') assert.ok(resource.pageCount > 0);
    if (resource.readingLevel) {
      assert.match(resource.readingLevel, /^L[0-5]$/u);
      assert.ok(!levels.includes(resource.level));
    }
  }
});
