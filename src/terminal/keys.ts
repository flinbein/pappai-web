export const escape = '\x1b';
const cursorKeys = new Map(Object.entries({
  ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F',
}));

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
}

export const noModifiers: Modifiers = {ctrl: false, alt: false};

export function isSpecialKey(key: string) {
  return cursorKeys.has(key) || ['Escape', 'Tab', 'PageUp', 'PageDown'].includes(key);
}

export function encodeKey(key: string, {ctrl, alt}: Modifiers, applicationCursor: boolean, special: boolean) {
  const modifier = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const suffix = special && cursorKeys.get(key);
  if (suffix) {
    const prefix = modifier !== 1 ? '[1;' + modifier : applicationCursor ? 'O' : '[';
    return escape + prefix + suffix;
  }
  if (special && (key === 'PageUp' || key === 'PageDown')) {
    return escape + '[' + (key === 'PageUp' ? '5' : '6') + (modifier === 1 ? '' : ';' + modifier) + '~';
  }
  let text = key;
  if (special && key === 'Escape') text = escape;
  if (special && key === 'Tab') text = '\t';
  const first = text.charAt(0);
  const code = first.toUpperCase().charCodeAt(0);
  if (ctrl && ((code >= 64 && code <= 95) || first === ' ' || first === '?')) {
    text = String.fromCharCode(first === '?' ? 127 : code & 31) + text.slice(1);
  }
  return (alt ? escape : '') + text;
}
