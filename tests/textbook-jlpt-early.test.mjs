import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const expected = { n5: 45, n4: 50, n3: 45 };
const courses = await Promise.all(Object.entries(expected).map(async ([level, count]) => ({
  level, count,
  lessons: JSON.parse(await readFile(new URL(`public/data/grammar-${level}.json`, root), 'utf8')),
  source: (await readFile(new URL(`scripts/build-textbook-${level}.tsv`, root), 'utf8')).trim().split(/\r?\n/).map(line => line.split('¦'))
})));
const all = courses.flatMap(course => course.lessons);
const indexed = new Map(all.map(lesson => [lesson.id, lesson]));
const book = id => indexed.get(id).textbook;
const japanese = id => book(id).paragraphs.map(p => p.ja).join('\n');
const focus = id => book(id).focus.map(f => f.quote).join('\n');
const text = (value, min, label) => assert.ok(typeof value === 'string' && value.trim().length >= min, label);

test('all 140 existing early-level lesson IDs have independent textbook passages', () => {
  assert.equal(all.length, 140);
  assert.equal(indexed.size, 140);
  assert.equal(new Set(all.map(l => japanese(l.id))).size, 140, 'no reused paragraphs under different lesson IDs');
  for (const { level, count, lessons } of courses) {
    assert.equal(lessons.length, count);
    for (let number = 1; number <= count; number++) assert.ok(indexed.has(`g-${level}-${String(number).padStart(3,'0')}`));
    for (const lesson of lessons) {
      assert.equal(lesson.level, level.toUpperCase());
      assert.equal(lesson.track, 'grammar');
      assert.ok(lesson.sections.length >= 4 && lesson.quiz.length >= 4 && lesson.translation.length >= 2 && lesson.speaking.length >= 1, `${lesson.id} original teaching/tasks must remain`);
    }
  }
});

test('ordered thematic modules have stable chapter IDs and non-colliding lesson positions', () => {
  const moduleCounts = { n5: 8, n4: 8, n3: 7 };
  for (const { level, lessons } of courses) {
    const modules = new Map();
    const positions = new Set();
    for (const lesson of lessons) {
      const c = lesson.curriculum;
      assert.equal(c.program, 'jlpt');
      assert.equal(c.chapterId, level);
      assert.ok(c.chapterTitle.startsWith(level.toUpperCase() + ' · '));
      assert.ok(c.moduleId.startsWith(level + '-'));
      text(c.moduleTitle, 4, lesson.id);
      assert.ok(Number.isInteger(c.order) && c.order > 0 && !positions.has(c.order), lesson.id);
      positions.add(c.order);
      if (modules.has(c.moduleId)) assert.equal(modules.get(c.moduleId), c.moduleTitle);
      modules.set(c.moduleId, c.moduleTitle);
    }
    assert.equal(modules.size, moduleCounts[level]);
  }
  const order = id => indexed.get(id).curriculum.order;
  assert.ok(order('g-n5-036') < order('g-n5-038') && order('g-n5-038') < order('g-n5-025'), 'verb classes and te-form precede request construction');
  assert.ok(order('g-n4-035') < order('g-n4-036'), 'appearance and reported information remain distinct ordered lessons');
});

test('connected short readings, translations and selfchecks are complete at every level', () => {
  const limits = { N5: [60,140], N4: [95,180], N3: [120,240] };
  for (const lesson of all) {
    const t = lesson.textbook;
    text(t.title, 3, lesson.id);
    text(t.scene, 10, lesson.id);
    assert.ok(t.paragraphs.length >= 1 && t.paragraphs.length <= 3, lesson.id);
    const ja = japanese(lesson.id);
    const [min, max] = limits[lesson.level];
    assert.ok(ja.length >= min && ja.length <= max, `${lesson.id} length=${ja.length}`);
    const sentenceCount = (ja.match(/[。？]/gu) || []).length;
    assert.ok(sentenceCount >= 3 && sentenceCount <= 6, `${lesson.id} sentences=${sentenceCount}`);
    for (const p of t.paragraphs) { text(p.ja, 30, lesson.id); text(p.zh, 30, lesson.id); }
    assert.ok(t.readingQuestions.length >= 1 && t.readingQuestions.length <= 2);
    for (const q of t.readingQuestions) { text(q.question, 5, lesson.id); text(q.answer, 4, lesson.id); }
    assert.ok(!/[\uAC00-\uD7AF\uFFFD]/u.test(JSON.stringify(t)), `${lesson.id} stray language/encoding`);
    assert.ok(!/TODO|TBD|待补充|示例占位|同上/.test(JSON.stringify(t)), lesson.id);
  }
});

test('every vocabulary entry and grammar quotation is grounded in its own passage', () => {
  for (const lesson of all) {
    const t = lesson.textbook, ja = japanese(lesson.id);
    assert.ok(t.vocabulary.length >= 4 && t.vocabulary.length <= 8, lesson.id);
    assert.equal(new Set(t.vocabulary.map(v => v.word)).size, t.vocabulary.length, lesson.id);
    for (const v of t.vocabulary) {
      text(v.word, 1, lesson.id); text(v.meaning, 1, lesson.id);
      assert.ok(/^[ぁ-ゖァ-ヺー・]+$/u.test(v.reading), `${lesson.id} ${v.word} reading`);
      assert.ok(ja.includes(v.surface || v.word), `${lesson.id}: ${v.word} absent from reading`);
      if (v.surface) {
        assert.equal(lesson.id, 'g-n5-021');
        assert.equal(v.word, '遠い');
        assert.equal(v.surface, '遠くない', 'surface must be a real inflection, not an unrelated token');
      }
    }
    assert.ok(t.focus.length >= 1 && t.focus.length <= 3);
    for (const f of t.focus) { assert.ok(ja.includes(f.quote), `${lesson.id} non-verbatim quotation`); text(f.explanation, 25, lesson.id); }
  }
});

test('authored source and published textbook fields agree, making regeneration safe', () => {
  for (const { level, lessons, source } of courses) {
    assert.equal(source.length, lessons.length, level);
    assert.equal(new Set(source.map(row => row[0])).size, lessons.length);
    for (const fields of source) {
      assert.equal(fields.length, 11);
      const [id, module, title, scene, ja, zh, terms, quote, explanation, question, answer] = fields;
      const t = book(id);
      assert.deepEqual(t.paragraphs, [{ ja, zh }], id);
      assert.deepEqual(t.focus, [{ quote, explanation }], id);
      assert.deepEqual(t.readingQuestions, [{ question, answer }], id);
      assert.equal(t.title, title); assert.equal(t.scene, scene);
      assert.equal(indexed.get(id).curriculum.moduleId, `${level}-${module}`);
      assert.deepEqual(t.vocabulary, terms.split(';').map(term => Object.fromEntries(term.split('~').map((value, i) => [['word','reading','meaning','surface'][i], value]))));
    }
  }
});

test('all 140 passages actually demonstrate their assigned grammar focus', () => {
  const targets = {
    n5: [
      /留学生です/, /パンは.*卵は/, /ですか/, /さんの名前/, /も音楽/, /その青い/, /そこ/,
      /猫がいます/, /中にあります/, /を切り/, /図書館で/, /十時に/, /京都へ/, /友達と/,
      /から.*まで/, /明日.*読みます/s, /飲みません/, /買いませんでした/, /大きい窓/,
      /静かな/, /高くない/, /行きたい/, /休みましょう/, /行きませんか/, /書いてください/,
      /撮ってもいい/, /泳いではいけ/, /読んでいます/, /洗って.*行きます/, /ですから/,
      /歩くより速い/, /いちばん/, /あまり見ません/, /三枚/, /料理が上手/, /食べる/,
      /歩きます/, /読んで/, /泳いだ/, /買わない/, /曜日でした/, /静かでした/, /パンや果物/,
      /迎えに行き/, /私が/
    ],
    n4: [
      /暇だ/, /先生が紹介した本/, /予約することができ/, /走れます/, /登ったことがあり/,
      /読んだり.*聞いたり/, /聞きながら/, /出る前に/, /終わった後で/, /閉めてから/,
      /行くとき/, /曜日までに/, /見学する予定/, /受けるつもり/, /降りることにし/,
      /使うことになり/, /働こうと思って/, /履いたほうがいい/, /行かなければ/,
      /参加しなくてもいい/, /触らないでください/, /確認しないで.*送り/,
      /消してしまい/, /掃除しておき/, /作ってみる/, /並べてあり/, /開いていました/,
      /続けていき/, /妹にあげ/, /傘をくれ/, /先輩から.*もらい/, /教えてあげ/,
      /来てくれ/, /先生に.*読んでもらい/, /降りそう/, /できたそう/, /留守のよう/,
      /カフェみたい/, /春らしい/, /かもしれ/, /選ぶと.*表示/, /小さければ/,
      /着いたら/, /行くなら/, /遅れているので/, /話せたのに/, /降っても/, /近いし/,
      /売ろうか/, /晴れるでしょう/
    ],
    n3: [
    /先生に.*褒められ/, /人に.*話され/, /子どもたちに.*洗わせ/, /残業させられ/,
    /お読みになって/, /お持ちします/, /にございます/, /と思います/, /という交流/,
    /かどうか/, /どこに.*か/, /たんです/, /書くことを/, /持つのが見え/,
    /できるように/, /開くために/, /強風のため/, /れるようになり/, /離すようにして/,
    /使うことがあります/, /料理ばかり/, /入ったばかり/, /作るところ/, /届くはず/,
    /わけではありません/, /確認するべき/, /帰るしか/, /確認することにして/,
    /戻すことになって/, /作ったに違い/, /できるわけがありません/, /読まずに/,
    /持ったまま/, /つけっぱなし/, /温かいうちに/, /留守の間/, /帰るたびに/,
    /している最中に/, /ところに/, /とおりに/, /人によって/, /について/,
    /のに対して/, /通訳として/, /長くなるにつれて/
    ]
  };
  for (const [level, patterns] of Object.entries(targets)) {
    assert.equal(patterns.length, expected[level]);
    patterns.forEach((pattern, i) => assert.match(focus(`g-${level}-${String(i+1).padStart(3,'0')}`), pattern));
  }
});

test('reviewed contrasts preserve viewpoint, certainty, temporal order and comparison direction', () => {
  assert.match(book('g-n5-031').focus[0].explanation, /より前面.*比较基准/);
  assert.match(japanese('g-n5-022'), /友達は「.*したいです」と言います/);
  assert.match(focus('g-n4-035'), /降りそう/);
  assert.match(focus('g-n4-036'), /できたそう/);
  assert.match(book('g-n4-035').readingQuestions[0].answer, /天空.*风/);
  assert.match(book('g-n4-036').readingQuestions[0].answer, /没有.*听朋友/);
  assert.match(book('g-n4-012').readingQuestions[0].answer, /可以.*提前提交/);
  assert.match(japanese('g-n3-003'), /子どもたちに野菜を洗わせ/);
  assert.match(book('g-n3-022').readingQuestions[0].answer, /一个月/);
  assert.match(book('g-n3-030').readingQuestions[0].answer, /还没有/);
  assert.match(japanese('g-n3-036'), /留守の間、猫.*過ごします/);
  assert.match(japanese('g-n3-036'), /出張している間に一度/);
  assert.match(book('g-n3-039').readingQuestions[0].answer, /准备出门.*没有时间开箱/);
});
