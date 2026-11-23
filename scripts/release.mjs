import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function parts(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Expected a stable package version');
  return version.split('.').map(Number);
}

export function releaseVersion(base, run) {
  const [major, minor, patch] = parts(base);
  if (!/^[1-9]\d*$/.test(run) || !Number.isSafeInteger(Number(run) + patch)) throw Error('Invalid run number');
  return [major, minor, patch + Number(run) - 1].join('.');
}

export function publicationTag(version, latest) {
  if (!latest) return 'latest';
  const a = parts(version), b = parts(latest);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 'latest' : 'backfill';
  }
  return 'latest';
}

export function alreadyPublished(existing, integrity) {
  if (!existing) return false;
  if (existing.dist?.integrity !== integrity) throw Error('Published version belongs to a different archive');
  return true;
}

function prepare() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const version = releaseVersion(pkg.version, process.env.GITHUB_RUN_NUMBER);
  if (version !== pkg.version) execFileSync('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts']);
}

async function publish() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const version = releaseVersion(pkg.version, process.env.GITHUB_RUN_NUMBER);
  const file = './artifact/package.tgz';
  const integrity = 'sha512-' + createHash('sha512').update(readFileSync(file)).digest('base64');
  const response = await fetch('https://registry.npmjs.org/' + encodeURIComponent(pkg.name));
  if (!response.ok && response.status !== 404) throw Error('Registry metadata request failed: ' + response.status);
  const published = response.ok ? await response.json() : {};
  if (alreadyPublished(published.versions?.[version], integrity)) {
    console.log('Identical package already published at ' + version);
    return;
  }
  const tag = publicationTag(version, published['dist-tags']?.latest);
  execFileSync('npm', ['publish', file, '--ignore-scripts', '--access', 'public', '--provenance', '--tag', tag], {stdio:'inherit'});
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === 'prepare') prepare();
  else if (process.argv[2] === 'publish') await publish();
  else throw Error('Expected prepare or publish');
}
