import { describe, expect, it } from 'vitest';
import { diffText } from '../../web/textDiff';

describe('diffText (web textarea → ops)', () => {
  it('finds typing, deleting and replacing', () => {
    expect(diffText('hello', 'hello')).toBeNull();
    expect(diffText('helo', 'hello')).toEqual({ pos: 3, deleteLen: 0, insertText: 'l' });
    expect(diffText('hello', 'heo')).toEqual({ pos: 2, deleteLen: 2, insertText: '' });
    expect(diffText('one daily', 'one a day')).toEqual({ pos: 4, deleteLen: 4, insertText: 'a da' });
  });

  it('never cuts a surrogate pair', () => {
    // 💊 and 📅 share their first UTF-16 unit.
    const change = diffText('a💊b', 'a📅b')!;
    expect(change).toEqual({ pos: 1, deleteLen: 2, insertText: '📅' });
  });
});
