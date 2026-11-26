import {compileSchema, draft2020, type JsonSchema} from 'json-schema-library';
import {addFormats} from 'json-schema-library/formats';
import type {Feature} from '../panel/api';

addFormats([draft2020]);

export interface CliInput {
  args?: string[];
  env?: Record<string, string>;
}
export interface CliAction {
  node: string;
  method: string;
  feature?: Feature;
}
export type TerminalStart = {argv: string[]; env: Record<string, string>} | {cli: {node: string; method: string; input: CliInput}};

// Words use POSIX-style quoting. Input is never passed to a shell for expansion.
export function splitWords(text: string) {
  const words: string[] = [];
  let word = '', quote = '', started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!quote && /\s/u.test(ch)) {
      if (started) words.push(word);
      word = ''; started = false;
      continue;
    }
    started = true;
    if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
      quote = quote ? '' : ch;
    } else if (ch === '\\' && quote !== "'") {
      const next = text[i + 1];
      if (next === undefined) throw Error('Finish the escape or quote a literal backslash.');
      if (quote === '"' && next !== '"' && next !== '\\') word += ch;
      else { word += next; i++; }
    } else word += ch;
  }
  if (quote) throw Error('Close the ' + (quote === "'" ? 'single' : 'double') + ' quote.');
  if (started) words.push(word);
  return words;
}

export function joinWords(words: string[]) {
  return words.map(word => /^[\w./:@%+=,-]+$/u.test(word) ? word : "'" + word.replaceAll("'", "'\\''") + "'").join(' ');
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Hide a field only when the unconditional object schema rules exclude it.
export function forbidsField(schema: unknown, key: string): boolean {
  if (!record(schema)) return schema === false;
  if (Array.isArray(schema.allOf) && schema.allOf.some(part => forbidsField(part, key))) return true;
  if (record(schema.properties) && Object.hasOwn(schema.properties, key)) return schema.properties[key] === false;
  if (schema.additionalProperties !== false) return false;
  return !record(schema.patternProperties) ||
    !Object.keys(schema.patternProperties).some(pattern => new RegExp(pattern, 'u').test(key));
}

export interface Issue {path: string; message: string}
export function inputValidator(schema: unknown): (data: CliInput) => Issue[] {
  if (schema === undefined) return () => [];
  try {
    const compiled = compileSchema(schema as JsonSchema, {drafts:[draft2020], formatAssertion:true, throwOnInvalidSchema:true});
    return data => compiled.validate(data).errors.map(error => {
      const {pointer, key, property} = error.data;
      let path = String(pointer ?? '#');
      const field = error.code === 'required-property-error' ? key : error.code === 'invalid-property-name-error' ? property : undefined;
      if (typeof field === 'string') path += '/' + pointerKey(field);
      return {path, message:error.message};
    });
  } catch (error) {
    return () => [{path:'#', message:'Invalid launch schema: ' + String(error)}];
  }
}

export function pointerKey(key: string) {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}
