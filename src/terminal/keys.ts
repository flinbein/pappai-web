export const escape = '\x1b';
const cursorKeys = new Map(Object.entries({
  ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F',
}));

const functionCodes = new Map(Object.entries({
  F1: 'P', F2: 'Q', F3: 'R', F4: 'S', F5: '15', F6: '17',
  F7: '18', F8: '19', F9: '20', F10: '21', F11: '23', F12: '24',
}));
export const functionKeys = [...functionCodes.keys()];

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export const noModifiers: Modifiers = {ctrl: false, alt: false, shift: false};
const tildeKeys = new Map(Object.entries({Insert:'2', Delete:'3', PageUp:'5', PageDown:'6'}));

export function isSpecialKey(key: string) {
  return cursorKeys.has(key) || functionCodes.has(key) || tildeKeys.has(key) || key === 'Escape' || key === 'Tab';
}

export function encodeKey(key: string, {ctrl, alt, shift: latchedShift}: Modifiers, applicationCursor: boolean, special: boolean, shift = false) {
  shift ||= latchedShift;
  const modifier = 1 + Number(shift) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const fn = special && functionCodes.get(key);
  if (fn) {
    if (fn.length === 1) return escape + (modifier === 1 ? 'O' : '[1;' + modifier) + fn;
    return escape + '[' + fn + (modifier === 1 ? '' : ';' + modifier) + '~';
  }
  const suffix = special && cursorKeys.get(key);
  if (suffix) {
    const prefix = modifier !== 1 ? '[1;' + modifier : applicationCursor ? 'O' : '[';
    return escape + prefix + suffix;
  }
  const tilde = special && tildeKeys.get(key);
  if (tilde) {
    return escape + '[' + tilde + (modifier === 1 ? '' : ';' + modifier) + '~';
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
