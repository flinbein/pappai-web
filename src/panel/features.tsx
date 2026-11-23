import { useState } from 'react';
import { call, formatJSON, parseJSON } from './api';
import type { Catalog, Feature } from './api';
import { field, Form, Submit, useMounted } from './controls';
import type { Refresh } from './workspace';

const headings = ['Прикладные методы', 'Системные методы', 'События', 'Статьи'];
function featureGroup(name: string, feature: Feature) {
  if (feature.type === 'method') return name.startsWith('$.') ? 1 : 0;
  return feature.type === 'event' ? 2 : 3;
}

interface MethodProps {
  id: string;
  name: string;
  feature?: Feature;
  refresh: Refresh;
}
function Method({ id, name, feature, refresh }: MethodProps) {
  const [result, setResult] = useState('');
  const mounted = useMounted();
  return <>
    <p id="feature-description">{feature ? 'v' + feature.version + ' · ' + feature.description : 'Нет доступной справки.'}</p>
    <pre id="feature-doc">{feature?.doc}</pre>
    <details id="schema-block" hidden={feature?.schema === undefined}>
      <summary>Схема JSON</summary><pre id="feature-schema">{formatJSON(feature?.schema)}</pre>
    </details>
    <Form id="method-call" hidden={feature?.type !== 'method'} feedback={setResult} submit={async form => {
      const data = parseJSON(field(form, 'arguments'));
      setResult('Выполняется…');
      const value = await call(id, name, data, feature?.version);
      setResult(formatJSON(value));
      if (mounted.current && name.startsWith('$.')) await refresh();
    }}>
      <label>Аргументы метода (JSON)<textarea id="arguments" name="arguments" rows={5} spellCheck={false} required
        defaultValue={name === 'agent.execute' ? '{ "input": "" }' : '{}'} /></label>
      <Submit>Вызвать метод</Submit>
    </Form>
    <pre id="method-result" role="status">{result}</pre>
  </>;
}

export function Features({ id, catalog, refresh }: { id: string; catalog: Catalog; refresh: Refresh }) {
  const groups = headings.map(() => [] as string[]);
  for (const [name, feature] of Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b))) {
    groups[featureGroup(name, feature)]!.push(name);
  }
  const [chosen, setChosen] = useState('');
  const name = chosen || groups.find(group => group.length)?.[0] || '';
  return <>
    <h2>Справка ноды</h2>
    <label>Методы, события и статьи<select id="feature" value={name} onChange={event => setChosen(event.target.value)}>
      {groups.map((group, index) => group.length ? <optgroup key={index} label={headings[index]}>
        {group.map(value => <option key={value}>{value}</option>)}
      </optgroup> : null)}
    </select></label>
    <Method key={name} id={id} name={name} feature={catalog[name]} refresh={refresh} />
  </>;
}
