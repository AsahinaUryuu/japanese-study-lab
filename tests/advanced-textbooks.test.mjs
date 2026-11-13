import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const courses = await Promise.all(['n2', 'n1'].map(async level => ({
  level,
  lessons: JSON.parse(await readFile(new URL('../public/data/grammar-' + level + '.json', import.meta.url), 'utf8'))
})));
const lessons = courses.flatMap(course => course.lessons);
const passage = lesson => lesson.textbook.paragraphs.map(p => p.ja).join('\n');
const nonempty = (value, label, min = 1) =>
  assert.ok(typeof value === 'string' && value.trim().length >= min, label);

// Accept real tense/politeness inflections while requiring the exact target construction.
const targets = {
  n2: [
    /わけだ/, /わけにはいかない/, /ざるを得な/, /ないことはない/, /にすぎない/,
    /にほかならない/, /ものだ/, /ものではない/, /ものだから/, /ものの/,
    /とはいえ/, /ながらも/, /にもかかわらず/, /どころか/, /ばかりか/,
    /ばかりに/, /だけに/, /だけあって/, /からこそ/, /ことから/,
    /以上は/, /上は/, /限り/, /に限り/, /に限らず/, /を問わず/, /にかかわらず/,
    /に応じて/, /に伴って/, /にしたがって/, /に沿って/, /に基づいて/, /をもとに/,
    /を通して/, /にわたって/, /をめぐって/, /にあたって/, /に際して/, /に先立って/,
    /かねない/, /かねます/, /得る|得ない/, /っこない/, /つつある/, /次第/
  ],
  n1: [
    /や否や/, /が早いか/, /見るなり/, /そばから/, /てからというもの/, /にあって/,
    /を皮切りに/, /を限りに/, /に至るまで/, /に至って/, /に至っては/, /をもって/,
    /をもってしても/, /を余儀なくされ/, /を禁じ得な/, /に堪えない/, /に堪える/,
    /に足る/, /に値する/, /とあって/, /とあれば/, /ともなると/, /ともあろうものが/,
    /べく/, /べからず/, /まじき/, /ずにはおかない/, /ずにはすまない/,
    /ないものでも(?:ない|ありません)/, /ずとも/, /といえども/, /ならでは/,
    /をおいて/, /ないまでも/, /までもな/, /ともなく/, /ずくめ/, /まみれ/,
    /きらいがある/, /きっての/, /極まる|極まりない/, /かたがた/, /かたわら/,
    /ごとく|ごとき/, /と相まって/
  ]
};

test('all 90 advanced lessons have unique original passages and stable lesson IDs', () => {
  for (const { level, lessons: course } of courses) {
    assert.equal(course.length, 45);
    assert.deepEqual(course.map(x => x.id).sort(),
      Array.from({ length: 45 }, (_, i) => 'g-' + level + '-' + String(i + 1).padStart(3, '0')));
  }
  assert.equal(new Set(lessons.map(passage)).size, 90, 'passages must not be reused across grammar points');
  assert.equal(new Set(lessons.map(x => x.textbook.title)).size, 90);
});

test('textbooks have paragraph-length Japanese with Chinese translation and a concrete scene', () => {
  for (const lesson of lessons) {
    const book = lesson.textbook;
    nonempty(book.title, lesson.id + ' title', 4);
    nonempty(book.scene, lesson.id + ' scene', 10);
    assert.ok(book.paragraphs.length >= 1 && book.paragraphs.length <= 3, lesson.id);
    const ja = passage(lesson);
    assert.ok(ja.length >= 150 && ja.length <= 260, lesson.id + ': ' + ja.length + ' chars');
    const sentences = (ja.match(/。/g) || []).length;
    assert.ok(sentences >= 3 && sentences <= 6, lesson.id + ': ' + sentences + ' sentences');
    assert.ok(!/例文[一二三四五1-5]|TODO|TBD|待补|待補|占位/.test(ja), lesson.id + ' placeholder');
    for (const paragraph of book.paragraphs) {
      nonempty(paragraph.zh, lesson.id + ' Chinese translation', 55);
      assert.ok(/[\u4e00-\u9fff]/u.test(paragraph.zh), lesson.id);
      assert.ok(!/[\uac00-\ud7af\ufffd]/u.test(JSON.stringify(paragraph)), lesson.id + ' encoding/language contamination');
    }
  }
});

test('each lesson teaches 5–8 attested passage words with kana readings and Chinese meanings', () => {
  for (const lesson of lessons) {
    const words = lesson.textbook.vocabulary;
    assert.ok(words.length >= 5 && words.length <= 8, lesson.id);
    assert.equal(new Set(words.map(v => v.word)).size, words.length, lesson.id + ' duplicate vocabulary');
    for (const word of words) {
      nonempty(word.word, lesson.id + ' headword');
      nonempty(word.meaning, lesson.id + ' Chinese meaning');
      assert.ok(/^[ぁ-ゖァ-ヺー・]+$/u.test(word.reading), lesson.id + ' invalid kana: ' + word.reading);
      assert.ok(/[\u4e00-\u9fff]/u.test(word.meaning), lesson.id + ' missing Chinese meaning');
      const surface = word.surface || word.word;
      assert.ok(passage(lesson).includes(surface), lesson.id + ' unattested word: ' + surface);
      if (word.surface) assert.equal(word.surface.slice(0, 2), word.word.slice(0, 2), lesson.id + ' dubious surface');
    }
  }
});

test('focus quotes are verbatim excerpts containing this lesson’s exact grammar target', () => {
  for (const { level, lessons: course } of courses) {
    assert.equal(targets[level].length, 45);
    for (const lesson of course) {
      const index = Number(lesson.id.slice(-3)) - 1;
      const focus = lesson.textbook.focus;
      assert.ok(focus.length >= 1 && focus.length <= 3, lesson.id);
      assert.ok(focus.some(f => targets[level][index].test(f.quote)), lesson.id + ' wrong grammar focus');
      for (const point of focus) {
        nonempty(point.quote, lesson.id + ' quotation', 4);
        nonempty(point.explanation, lesson.id + ' explanation', 30);
        assert.ok(passage(lesson).includes(point.quote), lesson.id + ' quotation not in passage');
      }
    }
  }
});

test('every textbook has a distinct answered comprehension selfcheck', () => {
  const seen = new Set();
  for (const lesson of lessons) {
    const questions = lesson.textbook.readingQuestions;
    assert.ok(questions.length >= 1 && questions.length <= 2, lesson.id);
    for (const question of questions) {
      nonempty(question.question, lesson.id + ' selfcheck', 12);
      nonempty(question.answer, lesson.id + ' selfcheck answer', 18);
      assert.ok(!seen.has(question.question), lesson.id + ' repeated generic question');
      seen.add(question.question);
      assert.notEqual(question.question, question.answer);
    }
  }
});

test('curricula form 5–10 complete thematic modules with a contiguous teaching order', () => {
  for (const { level, lessons: course } of courses) {
    const modules = new Map();
    for (const lesson of course) {
      const c = lesson.curriculum;
      assert.equal(c.program, 'jlpt');
      assert.equal(c.chapterId, level);
      assert.equal(c.chapterTitle, level === 'n2' ? 'N2 · 综合运用' : 'N1 · 深入理解');
      assert.ok(c.moduleId.startsWith(level + '-'));
      nonempty(c.moduleTitle, lesson.id, 4);
      if (modules.has(c.moduleId)) assert.equal(modules.get(c.moduleId).title, c.moduleTitle);
      else modules.set(c.moduleId, { title: c.moduleTitle, order: [] });
      modules.get(c.moduleId).order.push(c.order);
    }
    assert.ok(modules.size >= 5 && modules.size <= 10);
    assert.deepEqual(course.map(x => x.curriculum.order).sort((a, b) => a - b),
      Array.from({ length: 45 }, (_, i) => i + 1));
    for (const { order } of modules.values()) {
      order.sort((a, b) => a - b);
      assert.ok(order.length >= 4, 'avoid one-lesson pseudo-modules');
      assert.equal(order.at(-1) - order[0] + 1, order.length, 'module lessons should be contiguous');
    }
  }
});

test('enrichment retains existing teaching and assessment layers', () => {
  for (const lesson of lessons) {
    assert.ok(lesson.sections.length >= 4, lesson.id + ' original teaching sections');
    assert.ok(lesson.quiz.length >= 3, lesson.id + ' original objective assessment');
    assert.ok(lesson.translation.length >= 1, lesson.id + ' original translation');
    assert.ok(lesson.speaking.length >= 1, lesson.id + ' original speaking');
    assert.ok(lesson.summary, lesson.id + ' original summary');
  }
});

test('reviewed grammar distinctions and conjugations cannot regress', () => {
  const byId = new Map(lessons.map(x => [x.id, x]));
  const text = id => passage(byId.get(id));
  assert.ok(text('g-n2-043').includes('終わりっこない'));
  assert.ok(!text('g-n2-043').includes('終わるっこない'), 'っこない takes the masu stem');
  assert.ok(text('g-n2-003').includes('変更せざるを得なかった'), 'する has irregular せざる');
  assert.ok(text('g-n1-024').includes('短縮すべく'), 'する commonly becomes すべく');
  assert.ok(byId.get('g-n1-016').textbook.focus[0].explanation.includes('見るに堪えない'),
    'distinguish gratitude from unbearable viewing');
  assert.ok(byId.get('g-n1-028').textbook.focus[0].explanation.includes('责任'),
    'ずにはすまない must teach obligation rather than spontaneous emotion');
  assert.ok(byId.get('g-n1-043').textbook.focus[0].explanation.includes('较长时期'),
    'かたわら must not be mistaken for instantaneous simultaneous actions');
});
