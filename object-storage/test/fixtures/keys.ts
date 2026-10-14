/** Keys that real clients send. All are valid and all are distinct objects. */
export const AWKWARD_KEYS: readonly string[] = [
  '../escape.txt',
  '../../etc/passwd',
  'a/../b.txt',
  'a/b.txt',
  './dot.txt',
  'dot.txt',
  'folder/',
  'folder',
  'folder//double-slash',
  'folder/sub/',
  ' leading space',
  'trailing space ',
  'r\u00e9sum\u00e9.pdf', // é as one code point (NFC)
  're\u0301sume\u0301.pdf', // e + combining accent (NFD)
  '日本語/ファイル.txt',
  'emoji/😀.png',
  'percent%20encoded',
  '100%/a',
  'under_score',
  'back\\slash',
  'q?x=1&y=2',
  '#hash',
  'UPPER/lower',
  'upper/lower',
];

/** Keys where some are prefixes of others. */
export const PREFIX_KEYS: readonly string[] = [
  'repo',
  'report',
  'report-2',
  'report/a',
  'report/b/c',
  'report_2',
  'reports',
  'reportx',
];
