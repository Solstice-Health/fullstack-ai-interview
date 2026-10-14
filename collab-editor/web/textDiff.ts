import { snapToCodePoint } from '../sim/fuzz';

/**
 * Turns a textarea change into at most one delete followed by at most one insert,
 * by trimming the common prefix and suffix. Never cuts a surrogate pair.
 */
export function diffText(before: string, after: string): { pos: number; deleteLen: number; insertText: string } | null {
  if (before === after) return null;
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  prefix = Math.min(snapToCodePoint(before, prefix), snapToCodePoint(after, prefix));
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++;
  }
  // Don't let the suffix start in the middle of a surrogate pair.
  while (suffix > 0 && snapToCodePoint(before, before.length - suffix) !== before.length - suffix) suffix--;
  return {
    pos: prefix,
    deleteLen: before.length - prefix - suffix,
    insertText: after.slice(prefix, after.length - suffix),
  };
}
