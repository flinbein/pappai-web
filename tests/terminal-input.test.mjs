import assert from 'node:assert/strict';
import {test} from 'node:test';
import {forbidsField, inputValidator, joinWords, splitWords} from '../src/terminal/launch-input.ts';

test('terminal compact input round-trips exact arguments and reports incomplete quoting', () => {
  const values = ['', 'a b', 'a"b', "a'b", '\\', 'tabs\t', 'multi\nline', '--option=$HOME', '日本'];
  assert.deepEqual(splitWords(joinWords(values)), values);
  assert.deepEqual(splitWords(String.raw`a\ b 'a'"b" "one\two" ""`), ['a b','ab','one\\two','']);
  for (const input of ["'incomplete", '"incomplete', 'incomplete\\']) assert.throws(() => splitWords(input));
});

test('field visibility only uses unconditional exclusions', () => {
  assert.equal(forbidsField({properties:{args:false}},'args'), true);
  assert.equal(forbidsField({allOf:[{additionalProperties:false, properties:{env:{}}}]},'args'), true);
  assert.equal(forbidsField({additionalProperties:false, patternProperties:{'^a':{}}},'args'), false);
  assert.equal(forbidsField({oneOf:[{properties:{args:false}}, {required:['args']}]},'args'), false);
  assert.equal(forbidsField({if:{required:['env']},then:{properties:{args:false}}},'args'), false);
});

test('launch schema checks local references, formats and specific argument and environment paths', () => {
  const validate = inputValidator({type:'object',required:['args'],additionalProperties:false,
    properties:{args:{type:'array',items:{$ref:'#/$defs/arg'}},env:{type:'object',additionalProperties:{type:'string',format:'email'}}},
    $defs:{arg:{type:'string',enum:['one','two']}}});
  assert.deepEqual(validate({args:['one','two'],env:{USER:'ok@example.com'}}), []);
  assert.deepEqual(validate({}).map(e => e.path), ['#/args']);
  assert.deepEqual(validate({args:['three'],env:{USER:'name'}}).map(e => e.path).sort(), ['#/args/0','#/env/USER']);
  assert.ok(inputValidator(false)({}).length);
});
