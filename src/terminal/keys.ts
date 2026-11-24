export const escape = '\x1b';
const cursorKeys = new Map(Object.entries({
  ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F',
}));

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export const noModifiers: Modifiers = {ctrl: false, alt: false, shift: false};

export function isSpecialKey(key: string) {
  return cursorKeys.has(key) || ['Escape', 'Tab', 'PageUp', 'PageDown'].includes(key);
}

export function encodeKey(key: string, {ctrl, alt, shift: latchedShift}: Modifiers, applicationCursor: boolean, special: boolean, shift = false) {
  shift ||= latchedShift;
  const modifier = 1 + Number(shift) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const suffix = special && cursorKeys.get(key);
  if (suffix) {
    const prefix = modifier !== 1 ? '[1;' + modifier : applicationCursor ? 'O' : '[';
    return escape + prefix + suffix;
  }
  if (special && (key === 'PageUp' || key === 'PageDown')) {
    return escape + '[' + (key === 'PageUp' ? '5' : '6') + (modifier === 1 ? '' : ';' + modifier) + '~';
  }
  let text = key;
  if (shift && !special && key) {
    const first = String.fromCodePoint(key.codePointAt(0)!);
    text = (shiftedSymbols[first] ?? first.toUpperCase()) + key.slice(first.length);
  }
  if (special && key === 'Escape') text = escape;
  if (special && key === 'Tab') text = shift ? escape + '[Z' : '\t';
  const first = text.charAt(0);
  const code = first.toUpperCase().charCodeAt(0);
  if (ctrl && ((code >= 64 && code <= 95) || first === ' ' || first === '?')) {
    text = String.fromCharCode(first === '?' ? 127 : code & 31) + text.slice(1);
  }
  return (alt ? escape : '') + text;
}

const shiftedSymbols: Record<string, string> = {
  '1':'!', '2':'@', '3':'#', '4':'$', '5':'%', '6':'^', '7':'&', '8':'*', '9':'(', '0':')',
  '-':'_', '=':'+', '[':'{', ']':'}', '\\':'|', ';':':', "'":'"', ',':'<', '.':'>', '/':'?', '`':'~',
};
