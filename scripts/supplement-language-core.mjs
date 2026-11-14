// Conservative boundaries for Japanese examples inside Chinese explanations.
// A range means "eligible for Japanese analysis", never "the entire field".
export const HAS_KANA = /[ぁ-ゖァ-ヺ]/u;
export const HAS_HAN = /[\u3400-\u4dbf\u4e00-\u9fff々]/u;
const HAN_ONLY = /^[\u3400-\u4dbf\u4e00-\u9fff々]+$/u;
const CHINESE = /[这说给让该从仅译应为进联变单选传语词现间类问处动实习书关业认确讲时终觉读远结]/u;
const META = /(?:名词|动词|形容词|词干|前项|后项|辞书形|普通形|表示|说明|中文|汉语|语法|读音|不要|不能|必须|可以|例如|不是|而是|名词身份|关于我|是什么|所有|都不|等于|就是|只要|一个|两个)/u;
const CHINESE_PREFIX = new Set(['用','把','说','写','指','是','的','和','与','将','让','等','而','如','在','给','或','从','比','向','就','为','才','能','会','也','都','并','不','再','只','先','后','表示','说明','理解','形式','普通形','前','后','接','变成','对应','选择','结尾','所有']);
const FOLLOW = /^(?:は|が|を|に|で|と|も|から|まで|なら|です|でした|だ|だった|する|した|しない|して|し|な|の|ほど|より|だけ|さえ|こそ|しか|へ)/u;
// A title such as "いただく与くださる" is not a single Japanese phrase.
// Test analyzer tokens, not a blanket /与/ ban: 与える, 与党, 関与 and a
// fully Japanese field must keep their genuine Japanese readings.
const CHINESE_JOINERS = new Set(['与','以及','或者']);
const hasChineseJoiner = (text,tokens) => tokens(text).some(t=>CHINESE_JOINERS.has(t.text));

export function mergeRanges(ranges) {
  const sorted = ranges.filter(r => r.end > r.start).sort((a, b) => a.start - b.start || b.end - a.end);
  const result = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else result.push({ start: range.start, end: range.end });
  }
  return result;
}

export function plausibleJapaneseTitle(text, tokens) {
  if (!HAS_KANA.test(text) || CHINESE.test(text) || META.test(text) || /[：:＝=]/u.test(text) || hasChineseJoiner(text,tokens)) return false;
  const parts = tokens(text);
  return parts.every(t => !HAS_HAN.test(t.text) || t.known && !!t.reading);
}

export function mixedJapaneseRanges(text, { tokens, localWords, allWords, phrases = [] }) {
  const ranges = [];
  const add = (start, end) => { if (end > start) ranges.push({ start, end }); };
  // Phrases have direct Japanese-field or grammar-target evidence.
  for (const phrase of phrases) {
    if (!phrase || !HAS_KANA.test(phrase) || CHINESE.test(phrase) || META.test(phrase) || hasChineseJoiner(phrase,tokens)) continue;
    let from = 0;
    while (from < text.length) {
      const i = text.indexOf(phrase, from); if (i < 0) break;
      add(i, i + phrase.length); from = i + phrase.length;
    }
  }
  // Quotes may contain a Japanese=Chinese decomposition. Only inspect its
  // Japanese left side, never read the Chinese gloss after the equals sign.
  const quotes = /「([^「」]*)」|『([^『』]*)』|“([^“”]*)”|‘([^‘’]*)’/gu;
  for (const match of text.matchAll(quotes)) {
    let inner = match[1] ?? match[2] ?? match[3] ?? match[4];
    inner = inner.split(/[＝=]/u, 1)[0];
    const offset = match.index + 1;
    const left = inner.length - inner.trimStart().length;
    const candidate = inner.trim();
    if (!candidate || CHINESE.test(candidate) || META.test(candidate) || hasChineseJoiner(candidate,tokens)) continue;
    if (HAS_KANA.test(candidate) || HAN_ONLY.test(candidate) && localWords.has(candidate))
      add(offset + left, offset + left + candidate.length);
  }
  // Bare kana is Japanese evidence. Extend a mixed kanji+kana analyzer token
  // only if IPADIC knows the complete word; never extend across Chinese text.
  const chunks = /[\u3400-\u4dbf\u4e00-\u9fff々ぁ-ゖァ-ヺー]+/gu;
  for (const chunk of text.matchAll(chunks)) {
    if (!HAS_KANA.test(chunk[0])) continue;
    const parts = tokens(chunk[0]);
    for (let i = 0; i < parts.length; i++) {
      const token = parts[i];
      if (!HAS_KANA.test(token.text)) continue;
      const start = chunk.index + token.start;
      if (!CHINESE.test(token.text) && !META.test(token.text) && (token.known || !HAS_HAN.test(token.text)))
        add(start, start + token.text.length);
      else for (const kana of token.text.matchAll(/[ぁ-ゖァ-ヺー]+/gu))
        add(start + kana.index, start + kana.index + kana[0].length);
      const previous = parts[i - 1];
      if (previous && previous.end === token.start && FOLLOW.test(token.text) &&
          HAN_ONLY.test(previous.text) && !CHINESE.test(previous.text) &&
          !CHINESE_PREFIX.has(previous.text) && (localWords.has(previous.text) || allWords.has(previous.text)))
        add(chunk.index + previous.start, chunk.index + previous.end);
    }
  }
  return mergeRanges(ranges);
}
