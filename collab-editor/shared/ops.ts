/**
 * Edits on a plain-text document.
 *
 * Positions and lengths are UTF-16 code units, the same units as
 * `String.prototype.length` and `String.prototype.slice`.
 */

/** Insert `text` so that it starts at `pos`. */
export interface Insert {
  type: 'insert';
  pos: number;
  text: string;
}

/** Delete `len` code units starting at `pos`. */
export interface Delete {
  type: 'delete';
  pos: number;
  len: number;
}

export type Op = Insert | Delete;

export function insert(pos: number, text: string): Insert {
  return { type: 'insert', pos, text };
}

export function del(pos: number, len: number): Delete {
  return { type: 'delete', pos, len };
}

/** Applies one op to `text`. Throws if the op does not fit the text. */
export function applyOp(text: string, op: Op): string {
  if (!Number.isInteger(op.pos) || op.pos < 0 || op.pos > text.length) {
    throw new RangeError(`${op.type} at ${op.pos} is outside a text of length ${text.length}`);
  }
  if (op.type === 'insert') {
    return text.slice(0, op.pos) + op.text + text.slice(op.pos);
  }
  if (!Number.isInteger(op.len) || op.len < 0 || op.pos + op.len > text.length) {
    throw new RangeError(`delete ${op.pos}+${op.len} is outside a text of length ${text.length}`);
  }
  return text.slice(0, op.pos) + text.slice(op.pos + op.len);
}

/** Applies ops in order. */
export function applyOps(text: string, ops: readonly Op[]): string {
  return ops.reduce(applyOp, text);
}

/** Human-readable form, for logs and failure messages. */
export function describeOp(op: Op): string {
  return op.type === 'insert'
    ? `insert(${op.pos}, ${JSON.stringify(op.text)})`
    : `delete(${op.pos}, ${op.len})`;
}
