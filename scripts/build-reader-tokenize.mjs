/**
 * Build-time only. Runtime serves the resulting reader.json and never loads npm.
 * Install in an external work directory:
 * npm install --prefix ../japanese-research/reader-build --ignore-scripts kuromoji@0.1.2
 * node scripts/build-reader-tokenize.mjs --deps ../japanese-research/reader-build
 * python scripts/build-reader.py --source ../japanese-research/reader-build/reader-tokens.json
 */
import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { textbookWords, wordKey } from '../public/curriculum-core.js';
import { LEVELS, TRACKS } from '../public/learning-core.js';
import { toHiragana as hira, inflectedReading } from './reader-build-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argument = (key, fallback) => {
  const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1];
};
const deps = path.resolve(argument('--deps', path.join(root, '../japanese-research/reader-build')));
const output = path.resolve(argument('--out', path.join(deps, 'reader-tokens.json')));
const moduleDir = path.join(deps, 'node_modules/kuromoji');
const require = createRequire(path.join(deps, 'package.json'));
const kuromoji = require('kuromoji');
const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath: path.join(moduleDir, 'dict') }).build((err, result) => err ? reject(err) : resolve(result)));
const validReading = text => !!text && /^[ぁ-ゖー]+$/u.test(text);
const dataDir = path.join(root, 'public/data');
const lessons = [];
const inputs = {};
for (const name of (await readdir(dataDir)).filter(x => x.endsWith('.json')).sort()) {
  const raw = await readFile(path.join(dataDir, name), 'utf8');
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || !value.some(x => x?.textbook?.paragraphs)) continue;
  inputs[name] = createHash('sha256').update(raw).digest('hex');
  lessons.push(...value.filter(x => x?.textbook?.paragraphs));
}
lessons.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
  Object.keys(TRACKS).indexOf(a.track) - Object.keys(TRACKS).indexOf(b.track));
const words = textbookWords(lessons, JSON.parse(await readFile(path.join(dataDir, 'vocabulary.json'), 'utf8')));
const known = new Map(words.map(w => [wordKey(w), w]));
const overridesPath = path.join(root, 'scripts/reader-overrides.json');
let overrides = [];
try { overrides = JSON.parse(await readFile(overridesPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const usedOverrides = new Set();
const conflicts = [];
const lemmaCache = new Map();
function lemmaReading(lemma) {
  if (validReading(hira(lemma))) return hira(lemma);
  if (lemmaCache.has(lemma)) return lemmaCache.get(lemma);
  const ts = tokenizer.tokenize(lemma);
  const reading = ts.every(t => validReading(hira(t.reading))) ? ts.map(t => hira(t.reading)).join('') : null;
  lemmaCache.set(lemma, reading); return reading;
}
function rawTokens(text, offset = 0) {
  const tokens = tokenizer.tokenize(text);
  const result = []; let cursor = 0;
  for (const token of tokens) {
    const surface = token.surface_form;
    const index = text.indexOf(surface, cursor);
    if (index < 0) throw new Error('Tokenizer surface missing from input: ' + surface);
    if (index > cursor) result.push({ text: text.slice(cursor, index), start: offset + cursor, end: offset + index, pos: 'gap' });
    const supplied = hira(token.reading);
    const reading = validReading(supplied) ? supplied : validReading(hira(surface)) ? hira(surface) : '';
    const lemma = token.basic_form && token.basic_form !== '*' ? token.basic_form : surface;
    result.push({ text: surface, start: offset + index, end: offset + index + surface.length,
      reading: validReading(reading) ? reading : undefined,
      lemma, lemmaReading: lemma === surface && validReading(reading) ? reading : lemmaReading(lemma),
      pos: token.pos, detail: token.pos_detail_1, detail2: token.pos_detail_2, known: token.word_type === 'KNOWN' });
    cursor = index + surface.length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), start: offset + cursor, end: offset + text.length, pos: 'gap' });
  if (result.map(x => x.text).join('') !== text) throw new Error('Tokenizer reconstruction mismatch');
  return result;
}
function allOccurrences(text, surface) {
  const positions = []; let cursor = 0;
  while (cursor <= text.length - surface.length) {
    const start = text.indexOf(surface, cursor);
    if (start < 0) break; positions.push(start); cursor = start + surface.length;
  }
  return positions;
}
function overlap(a, b) { return a.start < b.end && b.start < a.end; }
const result = {};
for (const lesson of lessons) {
  const paragraphs = lesson.textbook.paragraphs.map((paragraph, paragraphIndex) => {
    const text = paragraph.ja;
    const raw = rawTokens(text), anchors = [];
    for (let oi = 0; oi < overrides.length; oi++) {
      const o = overrides[oi];
      if (o.lessonId !== lesson.id || (o.paragraph ?? 0) !== paragraphIndex) continue;
      if (!o.surface || !validReading(hira(o.reading))) throw new Error('Invalid override: ' + JSON.stringify(o));
      allOccurrences(text, o.surface).forEach((start, occurrence) => {
        if (o.occurrence != null && occurrence !== o.occurrence) return;
        if (o.before && !text.slice(0, start).endsWith(o.before)) return;
        if (o.after && !text.slice(start + o.surface.length).startsWith(o.after)) return;
        const anchor = { text: o.surface, start, end: start + o.surface.length, reading: hira(o.reading),
          lemma: o.lemma || o.surface, lemmaReading: hira(o.lemmaReading || o.reading),
          meaning: o.meaning, pos: o.pos || '校对词', detail: o.detail, known: true, source: 'reviewed',
          reviewReason: o.reason, overrideIndex: oi };
        if (anchors.some(a => overlap(a, anchor))) throw new Error('Overlapping reviewed overrides: ' + lesson.id);
        anchors.push(anchor); usedOverrides.add(oi);
      });
    }
    // Merge only on analyzer token boundaries; never turn 方向 into an isolated 方.
    const starts = new Set(raw.map(x => x.start)), ends = new Set(raw.map(x => x.end));
    for (const w of [...(lesson.textbook.vocabulary || [])].sort((a, b) => (b.surface || b.word).length - (a.surface || a.word).length)) {
      const surface = w.surface || w.word;
      if (!surface || !validReading(hira(w.reading))) continue;
      for (const start of allOccurrences(text, surface)) {
        const anchor = { start, end: start + surface.length };
        if (!starts.has(start) || !ends.has(anchor.end) || anchors.some(a => overlap(a, anchor))) continue;
        const parts = raw.filter(x => x.start >= start && x.end <= anchor.end);
        const observed = parts.every(x => x.reading) ? parts.map(x => x.reading).join('') : null;
        const expected = surface === w.word ? hira(w.reading) : inflectedReading(w, surface);
        // Course readings can repair compound segmentation, but a conflicting single-word
        // homograph is left for the explicit, lesson-scoped review file.
        if (parts.length === 1 && observed && expected && observed !== expected) {
          conflicts.push({ lessonId: lesson.id, paragraph: paragraphIndex, surface, observed, courseReading: expected,
            context: text.slice(Math.max(0, start - 16), Math.min(text.length, anchor.end + 16)) });
          continue;
        }
        const reading = expected || observed;
        if (!validReading(reading)) continue;
        anchors.push({ ...anchor, text: surface, reading, lemma: w.word, lemmaReading: hira(w.reading),
          existingWordId: known.get(wordKey(w))?.id, meaning: w.meaning, pos: '教材词', known: true, source: 'textbook' });
      }
    }
    anchors.sort((a, b) => a.start - b.start);
    const untouched = (start, end) => raw.flatMap(token => {
      if (token.end <= start || token.start >= end) return [];
      if (token.start >= start && token.end <= end) return [token];
      const from = Math.max(start, token.start), to = Math.min(end, token.end);
      return rawTokens(text.slice(from, to), from);
    });
    const segments = []; let cursor = 0;
    for (const anchor of anchors) {
      segments.push(...untouched(cursor, anchor.start), anchor);
      cursor = anchor.end;
    }
    segments.push(...untouched(cursor, text.length));
    if (segments.map(s => s.text).join('') !== text) throw new Error('Anchor reconstruction mismatch: ' + lesson.id);
    return { text, segments };
  });
  result[lesson.id] = { level: lesson.level, title: lesson.title, paragraphs };
}
const unused = overrides.map((o, i) => ({ ...o, index: i })).filter(o => !usedOverrides.has(o.index));
if (unused.length) throw new Error('Unused reading overrides: ' + JSON.stringify(unused));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ version: 1, lessons: result, words, inputs, conflicts,
  analyzer: { name: 'kuromoji', version: require('kuromoji/package.json').version, license: 'Apache-2.0',
    url: 'https://github.com/takuyaa/kuromoji.js', dictionary: 'mecab-ipadic-2.7.0-20070801' },
  overrideCount: overrides.length }), 'utf8');
await mkdir(path.join(dataDir, 'licenses'), { recursive: true });
await copyFile(path.join(moduleDir, 'LICENSE-2.0.txt'), path.join(dataDir, 'licenses/kuromoji-LICENSE-2.0.txt'));
await copyFile(path.join(moduleDir, 'NOTICE.md'), path.join(dataDir, 'licenses/kuromoji-ipadic-NOTICE.md'));
console.log(JSON.stringify({ lessons: lessons.length, paragraphs: Object.values(result).reduce((n, l) => n + l.paragraphs.length, 0),
  words: words.length, conflicts: conflicts.length, overrides: overrides.length, output }));
