import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { call, formatJSON, parseJSON } from './api';
import type { Catalog, Feature } from './api';
import { field, Form, Submit, useMounted } from './controls';
import { NodeActionLink } from './node-action-link';
import type { NodeNavigation } from './node-action-link';
import type { Refresh } from './workspace';

function ancestorNames(name: string) {
  const parents: string[] = [];
  while (name.includes('.')) {
    name = name.slice(0, name.lastIndexOf('.'));
    parents.push(name);
  }
  return parents;
}

const typeIcons: Record<Feature['type'], string> = { document: '▤', method: 'ƒ', event: '↯', cli: '>_' };

export function FeatureLinks({ catalog, ...navigation }: NodeNavigation & { catalog: Catalog }) {
  const branches = useMemo(() => {
    const tree = new Map<string, string[]>();
    for (const name of Object.keys(catalog).sort()) {
      const parent = ancestorNames(name).find(prefix => Object.hasOwn(catalog, prefix)) ?? '';
      if (!tree.has(parent)) tree.set(parent, []);
      tree.get(parent)!.push(name);
    }
    return tree;
  }, [catalog]);
  const [expanded, setExpanded] = useState(new Set<string>());
  useEffect(() => {
    const name = Object.keys(catalog).find(key => navigation.action === 'methods/' + encodeURIComponent(key));
    if (name) setExpanded(previous => new Set([...previous, ...ancestorNames(name)]));
  }, [navigation.action, catalog]);

  function rows(parent: string): ReactNode {
    return <ul>{branches.get(parent)?.map(name => {
      const feature = catalog[name];
      const open = expanded.has(name);
      return <li key={name}>
        <div className="feature-row">
          {branches.has(name) && <button type="button" className="disclosure" aria-expanded={open}
            aria-label={(open ? 'Collapse ' : 'Expand ') + name} onClick={() => setExpanded(previous => {
              const next = new Set(previous);
              if (!next.delete(name)) next.add(name);
              return next;
            })}>{open ? '▾' : '▸'}</button>}
          <NodeActionLink {...navigation} path={'methods/' + encodeURIComponent(name)}>
            <span className="feature-type" role="img" aria-label={feature.type} title={feature.type}>{typeIcons[feature.type]}</span>
            <code title={name}>{parent ? name.slice(parent.length + 1) : name}</code>
            <span className="feature-summary">{feature.description}</span>
          </NodeActionLink>
        </div>
        {open && branches.has(name) && rows(name)}
      </li>;
    })}</ul>;
  }
  return <nav id="feature-panel" aria-labelledby="feature-title"><h2 id="feature-title">Documentation</h2>
    {branches.size ? rows('') : <p>No features available.</p>}
  </nav>;
}

interface MethodProps {
  id: string;
  name: string;
  feature: Feature;
  refresh: Refresh;
}

function FeatureSchema({ feature }: { feature: Feature }) {
  return feature.schema !== undefined && <details id="schema-block">
    <summary>JSON schema</summary><pre id="feature-schema">{formatJSON(feature.schema)}</pre>
  </details>;
}

export function FeatureReference({ feature }: { feature: Feature }) {
  return <>
    <p id="feature-description">{feature.type} · v{feature.version} · {feature.description}</p>
    {feature.doc && <pre id="feature-doc">{feature.doc}</pre>}
    <FeatureSchema feature={feature} />
  </>;
}

export function Method({ id, name, feature, refresh }: MethodProps) {
  const [result, setResult] = useState('');
  const [draft, setDraft] = useState(name === 'agent.execute' ? '{ "input": "" }' : '{}');
  const mounted = useMounted();
  if (feature.type !== 'method') return <><h2>{name}</h2><FeatureReference feature={feature} /></>;
  return <>
    <h2>{name}</h2>
    <FeatureSchema feature={feature} />
    <Form id="method-call" feedback={setResult} submit={async form => {
      const data = parseJSON(field(form, 'arguments'));
      setResult('Running…');
      const value = await call(id, name, data, feature.version);
      setResult(formatJSON(value));
      if (mounted.current && name.startsWith('$.')) await refresh();
    }}>
      <label>Method arguments (JSON)<textarea id="arguments" name="arguments" rows={5} spellCheck={false} required
        value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <Submit>Call method</Submit>
    </Form>
    <pre id="method-result" role="status">{result}</pre>
  </>;
}
