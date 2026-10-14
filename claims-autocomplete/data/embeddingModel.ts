// The deterministic "model" behind FakeEmbedder (also used by the data generator).
import { allConcepts, STOPWORDS } from './concepts';
import { createRng, hashString } from '../shared/random';

export const EMBEDDING_DIMS = 128;

const UNKNOWN_WORD_WEIGHT = 0.25;
const MAX_PHRASE_WORDS = 10;

interface PhraseEntry {
  group: string;
  weight: number;
}

let phraseTable: Map<string, PhraseEntry> | null = null;
const directionCache = new Map<string, Float32Array>();
const vectorCache = new Map<string, Float32Array>();

/** Lowercases and splits text into words of letters and digits. */
export function embedderWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function phrases(): Map<string, PhraseEntry> {
  if (phraseTable) return phraseTable;
  phraseTable = new Map();
  for (const concept of allConcepts()) {
    for (const form of [...concept.clinical, ...concept.lay]) {
      const key = embedderWords(form).join(' ');
      if (key && !phraseTable.has(key)) phraseTable.set(key, { group: concept.group, weight: concept.weight });
    }
  }
  return phraseTable;
}

function direction(key: string): Float32Array {
  let v = directionCache.get(key);
  if (v) return v;
  const rng = createRng(hashString(key));
  v = new Float32Array(EMBEDDING_DIMS);
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    const x = rng() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < EMBEDDING_DIMS; i++) v[i]! /= norm;
  directionCache.set(key, v);
  return v;
}

/** The vector the fake model returns for `text` (synchronous, no latency). */
export function vectorFor(text: string): Float32Array {
  const cached = vectorCache.get(text);
  if (cached) return new Float32Array(cached);

  const table = phrases();
  const words = embedderWords(text);
  const out = new Float32Array(EMBEDDING_DIMS);
  let i = 0;
  while (i < words.length) {
    let matched = 0;
    for (let n = Math.min(MAX_PHRASE_WORDS, words.length - i); n >= 1; n--) {
      const entry = table.get(words.slice(i, i + n).join(' '));
      if (entry) {
        addScaled(out, direction(`concept:${entry.group}`), entry.weight);
        matched = n;
        break;
      }
    }
    if (matched === 0) {
      const w = words[i]!;
      if (!STOPWORDS.has(w)) addScaled(out, direction(`word:${w}`), UNKNOWN_WORD_WEIGHT);
      matched = 1;
    }
    i += matched;
  }
  let norm = 0;
  for (let d = 0; d < EMBEDDING_DIMS; d++) norm += out[d]! * out[d]!;
  if (norm > 0) {
    norm = Math.sqrt(norm);
    for (let d = 0; d < EMBEDDING_DIMS; d++) out[d]! /= norm;
  }
  vectorCache.set(text, out);
  return new Float32Array(out);
}

function addScaled(target: Float32Array, v: Float32Array, scale: number): void {
  for (let d = 0; d < target.length; d++) target[d]! += v[d]! * scale;
}
