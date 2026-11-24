import { useState } from 'react';
import { call, formatJSON, parseJSON } from './api';
import type { Catalog, Feature } from './api';
import { field, Form, Submit, useMounted } from './controls';
import { NodeActionLink } from './node-action-link';
import type { NodeNavigation } from './node-action-link';
import type { Refresh } from './workspace';

const headings = ['Прикладные методы', 'Системные методы', 'События', 'Статьи'];

function featureGroup(name: string, feature: Feature) {
  if (feature.type === 'method') return name.startsWith('$.') ? 1 : 0;
  return feature.type === 'event' ? 2 : 3;
}

function featureGroups(catalog: Catalog) {
  const groups = headings.map(() => [] as string[]);
  for (const [name, feature] of Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b))) {
    groups[featureGroup(name, feature)]!.push(name);
  }
  return groups;
}

export function FeatureLinks({ catalog, ...navigation }: NodeNavigation & { catalog: Catalog }) {
  return <section id="feature-panel"><h2>Методы и справка</h2>
    {Object.keys(catalog).length === 0 && <p>Нет доступных методов, событий или статей.</p>}
    {featureGroups(catalog).map((group, index) => group.length > 0 &&
      <details key={index} open={index === 0 || group.some(name => navigation.action === 'methods/' + encodeURIComponent(name))}>
        <summary>{headings[index]} ({group.length})</summary>
        <ul className="action-list">{group.map(name =>
          <li key={name}><NodeActionLink {...navigation} path={'methods/' + encodeURIComponent(name)}>
            <code>{name}</code>
          </NodeActionLink></li>)}</ul>
      </details>)}
  </section>;
}

interface MethodProps {
  id: string;
  name: string;
  catalog: Catalog;
  feature: Feature;
  chooseFeature: (name: string) => void;
  refresh: Refresh;
}

export function Method({ id, name, catalog, feature, chooseFeature, refresh }: MethodProps) {
  const [result, setResult] = useState('');
  const mounted = useMounted();
  return <>
    <h2>{feature.type === 'method' ? 'Вызов метода' : 'Справка'}</h2>
    <label>Методы, события и статьи<select id="feature" value={name} onChange={event => chooseFeature(event.target.value)}>
      {featureGroups(catalog).map((group, index) => group.length > 0 && <optgroup key={index} label={headings[index]}>
        {group.map(value => <option key={value}>{value}</option>)}
      </optgroup>)}
    </select></label>
    <p id="feature-description">v{feature.version} · {feature.description}</p>
    <pre id="feature-doc">{feature.doc}</pre>
    <details id="schema-block" hidden={feature.schema === undefined}>
      <summary>Схема JSON</summary><pre id="feature-schema">{formatJSON(feature.schema)}</pre>
    </details>
    {feature.type === 'method' && <Form id="method-call" feedback={setResult} submit={async form => {
      const data = parseJSON(field(form, 'arguments'));
      setResult('Выполняется…');
      const value = await call(id, name, data, feature.version);
      setResult(formatJSON(value));
      if (mounted.current && name.startsWith('$.')) await refresh();
    }}>
      <label>Аргументы метода (JSON)<textarea id="arguments" name="arguments" rows={5} spellCheck={false} required
        defaultValue={name === 'agent.execute' ? '{ "input": "" }' : '{}'} /></label>
      <Submit>Вызвать метод</Submit>
    </Form>}
    <pre id="method-result" role="status">{result}</pre>
  </>;
}
