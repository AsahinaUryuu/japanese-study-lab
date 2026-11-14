/**
 * Additional teaching fields and stories, with Chinese-safe annotation spans.
 * Writes only external build intermediates. Does NOT rewrite reader.json.
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { textbookWords, wordKey } from '../public/curriculum-core.js';
import { LEVELS, TRACKS } from '../public/learning-core.js';
import { toHiragana as hira, inflectedReading } from './reader-build-core.mjs';
import { mixedJapaneseRanges, plausibleJapaneseTitle, mergeRanges, HAS_KANA, HAS_HAN } from './supplement-language-core.mjs';
import { countCandidates } from './supplement-counts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.join(root, 'public/data');
const buildArg = process.argv.indexOf('--build-dir');
const buildDir = path.resolve(buildArg >= 0 ? process.argv[buildArg + 1] : path.join(root, '../japanese-research/reader-build'));
const require = createRequire(path.join(buildDir, 'package.json'));
const kuromoji = require('kuromoji');
const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath: path.join(buildDir, 'node_modules/kuromoji/dict') }).build((e, t) => e ? reject(e) : resolve(t)));
const valid = s => !!s && /^[ぁ-ゖー]+$/u.test(s);
const hash = text => createHash('sha256').update(text).digest('hex');
const read = async name => JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
const inputs = {}, lessons = [];
for (const name of (await readdir(dataDir)).filter(n => n.endsWith('.json')).sort()) {
  const value = await read(name);
  if (Array.isArray(value) && value.some(l => l?.textbook?.paragraphs && l?.sections)) {
    lessons.push(...value); inputs[name] = hash(await readFile(path.join(dataDir, name)));
  }
}
lessons.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
  Object.keys(TRACKS).indexOf(a.track) - Object.keys(TRACKS).indexOf(b.track));
const oldReaderRaw = await readFile(path.join(dataDir, 'reader.json'), 'utf8');
const oldReader = JSON.parse(oldReaderRaw);
const words = textbookWords(lessons, await read('vocabulary.json'));
const known = new Map(words.map(w => [wordKey(w), w]));
for (const w of oldReader.words) if (!known.has(wordKey(w))) { words.push(w); known.set(wordKey(w), w); }
const allWordForms = new Set(words.map(w => w.word));
const lemmaCache = new Map(), tokenCache = new Map();
function tokenize(text) {
  if (tokenCache.has(text)) return tokenCache.get(text).map(t => ({ ...t }));
  let cursor = 0; const result = [];
  for (const t of tokenizer.tokenize(text)) {
    const start = text.indexOf(t.surface_form, cursor);
    if (start < 0) throw new Error('Unrecoverable tokenizer surface');
    if (start > cursor) result.push({ text: text.slice(cursor, start), start: cursor, end: start, pos: 'gap' });
    const surface = t.surface_form;
    const reading = valid(hira(t.reading)) ? hira(t.reading) : valid(hira(surface)) ? hira(surface) : undefined;
    const lemma = t.basic_form && t.basic_form !== '*' ? t.basic_form : surface;
    let lemmaReading = reading;
    if (lemma !== surface) {
      if (!lemmaCache.has(lemma)) {
        const ts = tokenizer.tokenize(lemma);
        lemmaCache.set(lemma, ts.every(x => valid(hira(x.reading))) ? ts.map(x => hira(x.reading)).join('') : valid(hira(lemma)) ? hira(lemma) : undefined);
      }
      lemmaReading = lemmaCache.get(lemma);
    }
    result.push({ text: surface, reading, lemma, lemmaReading, start, end: start + surface.length,
      pos: t.pos, detail: t.pos_detail_1, detail2: t.pos_detail_2, known: t.word_type === 'KNOWN' });
    cursor = start + surface.length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), start: cursor, end: text.length, pos: 'gap' });
  if (result.map(t => t.text).join('') !== text) throw new Error('Raw tokenizer changed text');
  tokenCache.set(text, result);
  return result.map(t => ({ ...t }));
}
const reviewed = JSON.parse(await readFile(path.join(root, 'scripts/reader-overrides.json'), 'utf8'));
const reviewedBySurface = new Map();
for (const row of reviewed) {
  if (!reviewedBySurface.has(row.surface)) reviewedBySurface.set(row.surface, []);
  reviewedBySurface.get(row.surface).push(row);
}
// Only reuse unambiguous complete compounds, never a context-dependent single
// character, date or verb. New source-specific rules live in a separate file.
const ambiguous = new Set(['十分', '一日', '一日中', '行った', '行く', '行って', '開く', '開いた', '開いて', '空く', '辛い', '辛く', '堪える', '堪えない']);
const safeReviewed = [...reviewedBySurface].filter(([surface, rs]) =>
  surface.length > 1 && !ambiguous.has(surface) && new Set(rs.map(r => r.reading)).size === 1 &&
  !surface.includes('許可なく') && !surface.includes('ほかなら')).map(([, rs]) => rs[0]);
let specialRules = [];
try { specialRules = JSON.parse(await readFile(path.join(root, 'scripts/reader-supplement-overrides.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const appliedRules = new Set(), boundaryAudit = [], uncertain = [], sourceRubyAudit = [];
const grammarBoundaries = [
  {surface:'許可',reading:'きょか',after:'なく',meaning:'许可、允许',priority:4},
  {surface:'にほかならない',reading:'にほかならない',meaning:'正是……；不外乎……',priority:4},
  {surface:'に際して',reading:'にさいして',meaning:'在某个正式事项发生或实施之际',priority:4},
  {surface:'に際し',reading:'にさいし',lemma:'に際して',lemmaReading:'にさいして',meaning:'在某个正式事项发生或实施之际',priority:4}
];
const technicalForms = [
  ['て形','てけい','动词的て形，用于连接动作、请求等句式'],
  ['た形','たけい','动词的た形，表示过去或用于相应接续'],
  ['ない形','ないけい','动词的ない形，即普通否定形式'],
  ['ます形','ますけい','动词的ます形，即礼貌形式'],
  ['辞書形','じしょけい','辞书形，词典收录的动词基本形式'],
  ['普通形','ふつうけい','普通形，与礼貌体相对的表达形式'],
  ['意志形','いしけい','动词意志形，表示意愿或提议'],
  ['可能形','かのうけい','动词可能形，表示能力或可能'],
  ['命令形','めいれいけい','动词命令形'],
  ['使役形','しえきけい','动词使役形，表示让或使某人行动'],
  ['受身形','うけみけい','动词被动形式'],
  ['条件形','じょうけんけい','条件形式，例如动词的ば形']
].map(([surface,reading,meaning])=>({surface,reading,meaning,priority:4}));
const snippets = new Map(), stories = {}, manifest = { snippets: {}, stories: {} };
function addSnippet(text, mode, lesson, field, sourceReadings = []) {
  if (typeof text !== 'string' || !text) return;
  let r = snippets.get(text);
  if (!r) { r = { id: 'snippet-' + hash(text).slice(0, 20), text, modes: new Set(), contexts: [], vocab: [], phrases: [], level: lesson.level }; snippets.set(text, r); }
  r.modes.add(mode); r.contexts.push({ lessonId: lesson.id, field });
  if(sourceReadings.length)r.sourceReadings=sourceReadings;
  if (LEVELS.indexOf(lesson.level) < LEVELS.indexOf(r.level)) r.level = lesson.level;
  r.vocab.push(...(lesson.textbook?.vocabulary || lesson.vocabulary || []));
  r.phrases.push(...(lesson.sections || []).flatMap(s => (s.examples || []).map(e => e.ja).filter(Boolean)),
    ...(lesson.textbook?.focus || []).map(f => f.quote).filter(Boolean));
  const target = lesson.title?.split(/[：:]/u)[0];
  if (target && HAS_KANA.test(target)) r.phrases.push(target);
}
const strings = value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : typeof value === 'string' ? [value] : [];
for (const lesson of lessons) {
  for (const field of ['title', 'subtitle']) addSnippet(lesson[field], 'mixed', lesson, field);
  strings(lesson.goals).forEach((s, i) => addSnippet(s, 'mixed', lesson, 'goals.' + i));
  for (const [si, section] of lesson.sections.entries()) {
    addSnippet(section.heading, 'mixed', lesson, 'sections.' + si + '.heading');
    strings(section.body).forEach((s, i) => addSnippet(s, 'mixed', lesson, 'sections.' + si + '.body.' + i));
    for (const [ei, example] of (section.examples || []).entries()) {
      addSnippet(example.ja, 'ja', lesson, 'sections.' + si + '.examples.' + ei + '.ja');
      addSnippet(example.note, 'mixed', lesson, 'sections.' + si + '.examples.' + ei + '.note');
    }
  }
  for (const field of ['professional', 'plain']) addSnippet(lesson.summary?.[field], 'mixed', lesson, 'summary.' + field);
  const textbookTitle = lesson.textbook?.title;
  addSnippet(textbookTitle, typeof textbookTitle==='string' && plausibleJapaneseTitle(textbookTitle,tokenize) ? 'ja' : 'mixed', lesson, 'textbook.title');
  for (const [i, focus] of (lesson.textbook?.focus || []).entries()) {
    addSnippet(focus.quote, 'ja', lesson, 'textbook.focus.' + i + '.quote');
    addSnippet(focus.explanation, 'mixed', lesson, 'textbook.focus.' + i + '.explanation');
  }
}
for (const file of (await readdir(dataDir)).filter(n=>/^stories-.*\.json$/.test(n)).sort()) {
  let value;
  try { value = await read(file); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
  inputs[file] = hash(await readFile(path.join(dataDir, file)));
  for (const series of value.series) {
    const context = { id: series.id, level: series.level, vocabulary: [] };
    addSnippet(series.title, 'ja', context, 'story.series.title');
    for (const chapter of series.chapters) {
      if (stories[chapter.id]) throw new Error('Duplicate story chapter ID: ' + chapter.id);
      const c = { ...chapter, level: chapter.level || series.level };
      addSnippet(chapter.title, 'ja', c, 'story.chapter.title',chapter.titleReadings||[]);
      stories[chapter.id] = { id: 'story-' + chapter.id, level: c.level, title: chapter.title,
        paragraphs: chapter.paragraphs, vocab: chapter.vocabulary || [] };
      manifest.stories[chapter.id] = { id: 'story-' + chapter.id, seriesId: series.id };
    }
  }
}
const occurrences = (text, surface) => {
  const a = []; let at = 0;
  while (at < text.length) { const i = text.indexOf(surface, at); if (i < 0) break; a.push(i); at = i + surface.length; }
  return a;
};
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
function annotate(text, vocab, recordId, paragraph = 0, sourceReadings = []) {
  const raw = tokenize(text), starts = new Set(raw.map(t => t.start)), ends = new Set(raw.map(t => t.end)), anchors = [];
  const candidates = [...technicalForms,...grammarBoundaries,...countCandidates(text)];
  for(const ruby of sourceReadings){
    if(!Number.isInteger(ruby.start)||!Number.isInteger(ruby.end)||ruby.start<0||ruby.end>text.length||
      text.slice(ruby.start,ruby.end)!==ruby.text||!valid(hira(ruby.reading)))
      throw new Error('Invalid original ruby: '+recordId+' / '+JSON.stringify(ruby));
    candidates.push({surface:ruby.text,reading:hira(ruby.reading),priority:5,sourceRuby:true,
      exactStart:ruby.start,exactEnd:ruby.end});
  }
  for (const [index, rule] of specialRules.entries()) {
    if (rule.recordId && rule.recordId !== recordId || rule.recordPrefix && !recordId.startsWith(rule.recordPrefix) ||
        rule.text && rule.text !== text || rule.paragraph != null && rule.paragraph !== paragraph) continue;
    candidates.push({ ...rule, priority: 3, ruleIndex: index });
  }
  for (const word of vocab) if (valid(hira(word.reading))) candidates.push({ surface: word.surface || word.word,
    reading: word.surface && word.surface !== word.word ? inflectedReading(word, word.surface) : hira(word.reading),
    lemma: word.word, lemmaReading: hira(word.reading), meaning: word.meaning, priority: 2, local: true });
  candidates.push(...safeReviewed.map(r => ({ ...r, priority: 1, reusable: true })));
  candidates.sort((a, b) => b.priority - a.priority || b.surface.length - a.surface.length);
  for (const candidate of candidates) {
    if (!candidate.surface || !valid(hira(candidate.reading))) continue;
    for (const [occurrence, start] of occurrences(text, candidate.surface).entries()) {
      const end = start + candidate.surface.length;
      if((candidate.sourceRuby||candidate.positioned) && (start!==candidate.exactStart||end!==candidate.exactEnd))continue;
      if (candidate.occurrence != null && candidate.occurrence !== occurrence) continue;
      if (candidate.before && !text.slice(0, start).endsWith(candidate.before)) continue;
      if (candidate.after && !text.slice(end).startsWith(candidate.after)) continue;
      if (candidate.priority < 3 && (!starts.has(start) || !ends.has(end))) continue;
      const anchor = { start, end };
      if (anchors.some(a => overlaps(a, anchor))) continue;
      const pair = { word: candidate.lemma || candidate.surface, reading: candidate.lemmaReading || candidate.reading };
      const entry = known.get(wordKey(pair));
      anchors.push({ ...anchor, text: candidate.surface, reading: hira(candidate.reading),
        lemma: pair.word, lemmaReading: hira(pair.reading), existingWordId: entry?.id,
        meaning: candidate.meaning, source: 'reviewed', pos: '校对词', known: true });
      if (candidate.ruleIndex != null) appliedRules.add(candidate.ruleIndex);
      if(candidate.sourceRuby)sourceRubyAudit.push({recordId,paragraph,start,end,text:candidate.surface,reading:hira(candidate.reading)});
    }
  }
  anchors.sort((a, b) => a.start - b.start);
  const pieces = [], untouched = (a, b) => raw.flatMap(t => {
    if (t.end <= a || t.start >= b) return [];
    if (t.start >= a && t.end <= b) return [t];
    const from = Math.max(a, t.start), to = Math.min(b, t.end);
    // Source ruby can cover only a kanji inside a verb/adjective. The remaining
    // kana is not an independent word (e.g. 好 + い is never 居る).
    return tokenize(text.slice(from, to)).map(x => ({ ...x, pos:'ruby-fragment',
      lemma:undefined,lemmaReading:undefined,start: from + x.start, end: from + x.end }));
  });
  let cursor = 0;
  for (const anchor of anchors) { pieces.push(...untouched(cursor, anchor.start), anchor); cursor = anchor.end; }
  pieces.push(...untouched(cursor, text.length));
  return pieces;
}
const records = {};
for (const record of snippets.values()) {
  const localWords = new Set(record.vocab.map(v => v.word));
  for (const phrase of record.phrases)
    for (const token of tokenize(phrase)) if (token.known && token.pos === '名詞') localWords.add(token.text);
  const fullJapanese = record.modes.has('ja') && !(record.modes.has('mixed') && !HAS_KANA.test(record.text));
  let ranges = fullJapanese ? [{ start: 0, end: record.text.length }] : mixedJapaneseRanges(record.text,
    { tokens: tokenize, localWords, allWords: allWordForms, phrases: [...new Set(record.phrases)] });
  if (!fullJapanese) {
    for(const form of technicalForms.filter(f=>HAS_KANA.test(f.surface)))
      for(const start of occurrences(record.text,form.surface))ranges.push({start,end:start+form.surface.length});
    // Explicit first-lesson lexical list: these are the Japanese nouns being
    // introduced, while the surrounding Chinese explanation stays protected.
    if (record.text.startsWith('先认识句子的零件：学生、会社、中国人都是名词')) {
      for (const word of ['学生','会社','中国人']) {
        const start=record.text.indexOf(word);ranges.push({start,end:start+word.length});
      }
    }
    if (record.text.startsWith('「私は学生です」由')) {
      const start=record.text.indexOf('学生＝');if(start>=0)ranges.push({start,end:start+2});
    }
    // Japanese grammar-type prefixes are symbols in the Chinese explanation,
    // not lexical い=胃 or な=菜. Remove their tiny spans before analysis.
    const excluded=[...record.text.matchAll(/[いな](?=形容词|形容詞)/gu)].map(m=>({start:m.index,end:m.index+1}));
    ranges=mergeRanges(ranges).flatMap(range=>{
      let pieces=[range];
      for(const cut of excluded)pieces=pieces.flatMap(p=>cut.end<=p.start||cut.start>=p.end?[p]:
        [{start:p.start,end:Math.min(cut.start,p.end)},{start:Math.max(cut.end,p.start),end:p.end}].filter(x=>x.end>x.start));
      return pieces;
    });
  }
  ranges=mergeRanges(ranges);
  let cursor = 0; const segments = [];
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: record.text.slice(cursor, range.start), start: cursor, end: range.start, pos: 'gap', protectedChinese: true });
    const fragment = record.text.slice(range.start, range.end);
    segments.push(...annotate(fragment, record.vocab, record.id,0,fullJapanese?(record.sourceReadings||[]):[]).map(t => ({
      ...t,...(!fullJapanese&&/^[ぁ-ゖァ-ヺ]$/u.test(t.text)?{pos:'gap',existingWordId:undefined,meaning:undefined,source:undefined}:{}),
      start: range.start + t.start, end: range.start + t.end })));
    cursor = range.end;
  }
  if (cursor < record.text.length) segments.push({ text: record.text.slice(cursor), start: cursor, end: record.text.length, pos: 'gap', protectedChinese: true });
  if (segments.map(t => t.text).join('') !== record.text) throw new Error('Mixed text reconstruction failed');
  records[record.id] = { level: record.level, title: record.contexts[0].field, paragraphs: [{ text: record.text, segments }] };
  manifest.snippets[record.id] = { text: record.text, ranges, fullJapanese, contexts: record.contexts };
  if (!fullJapanese && ranges.length) boundaryAudit.push({ id: record.id, text: record.text,
    japanese: ranges.map(r => record.text.slice(r.start, r.end)), sources: record.contexts });
}
for (const [chapterId, story] of Object.entries(stories)) {
  records[story.id] = { level: story.level, title: story.title,
    paragraphs: story.paragraphs.map((p, i) => ({ text: p.ja, segments: annotate(p.ja, story.vocab, story.id, i,p.sourceReadings||[]) })) };
}
for (let i = 0; i < specialRules.length; i++) if (!appliedRules.has(i))
  uncertain.push({ rule: specialRules[i], reason: '补充语境规则未命中，检查字段或出现次数' });
await mkdir(buildDir, { recursive: true });
const payload = { version: 1, lessons: records, words, inputs, conflicts: [], analyzer: {
  name: 'kuromoji', version: '0.1.2', license: 'Apache-2.0', url: 'https://github.com/takuyaa/kuromoji.js',
  dictionary: 'mecab-ipadic-2.7.0-20070801' }, overrideCount: appliedRules.size,
  supplement: { manifest, baseReaderSha256: hash(oldReaderRaw), baseWordCount: words.length,
    boundaryAudit, uncertain, sourceRubyAudit,lessonCount: lessons.length } };
await writeFile(path.join(buildDir, 'reader-supplement-tokens.json'), JSON.stringify(payload), 'utf8');
console.log(JSON.stringify({ lessons: lessons.length, snippets: snippets.size, stories: Object.keys(stories).length,
  mixedAnnotated: boundaryAudit.length, words: words.length, specialRules: appliedRules.size }));
