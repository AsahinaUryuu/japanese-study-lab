// Pure helpers: no dictionary loading or filesystem side effects.
export const toHiragana = text => String(text || '').normalize('NFKC')
  .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function inflectedReading(word, surface) {
  const reading = toHiragana(word.reading);
  // 来る changes its kanji reading: くる → きた/きます/こない.
  // A kana-tail replacement cannot model that change. Use the analyzer's
  // actual surface reading or an explicit reviewed override instead.
  if (word.word.endsWith('来る') && reading.endsWith('くる')) return null;
  if (word.word === '良い' && reading === 'いい') return null;
  let i = 0;
  while (i < word.word.length && i < surface.length && word.word[i] === surface[i]) i++;
  const oldTail = word.word.slice(i), newTail = surface.slice(i);
  if (/^[ぁ-ゖ]*$/.test(oldTail) && /^[ぁ-ゖ]*$/.test(newTail) && reading.endsWith(oldTail))
    return reading.slice(0, reading.length - oldTail.length) + newTail;
  return null;
}
