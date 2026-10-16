import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '') || version.split('.').some(part => Number(part) > 65535)) {
    throw new Error('Use a version such as 0.2.0, with each number between 0 and 65535.');
  }
}

export function nextReleaseVersion(base, tags) {
  validateVersion(base);
  let highest = base.split('.').map(Number);
  for (const tag of tags) {
    const version = tag.replace(/^v/, '');
    try { validateVersion(version); } catch { continue; }
    const parts = version.split('.').map(Number);
    const different = parts.findIndex((part, i) => part !== highest[i]);
    if (different !== -1 && parts[different] > highest[different]) highest = parts;
  }
  highest[2]++;
  const version = highest.join('.');
  validateVersion(version);
  return version;
}

export function setReleaseVersion(root, version) {
  validateVersion(version);
  const files = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
  const contents = files.map(file => {
    const source = readFileSync(resolve(root, file), 'utf8');
    if (file.endsWith('.json')) {
      const value = JSON.parse(source);
      value.version = version;
      return JSON.stringify(value, null, 2) + '\n';
    }
    const pattern = file.endsWith('.lock')
      ? /(\[\[package\]\]\r?\nname = "gitgoblin"\r?\nversion = ")[^"]+/
      : /(\[package\][\s\S]*?\r?\nversion = ")[^"]+/;
    if (!pattern.test(source)) throw new Error(`Cannot find the app version in ${file}`);
    return source.replace(pattern, (_, prefix) => `${prefix}${version}`);
  });
  files.forEach((file, index) => writeFileSync(resolve(root, file), contents[index], 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error('GITHUB_REPOSITORY is required to check existing versions.');
  const tags = [ ['tags', '.[].name'], ['releases', '.[].tag_name'] ].flatMap(([endpoint, query]) =>
    execFileSync('gh', ['api', `repos/${repository}/${endpoint}`, '--paginate', '--jq', query], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean));
  const base = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const version = process.env.RELEASE_VERSION || nextReleaseVersion(base, tags);
  validateVersion(version);
  if (tags.some(tag => tag.replace(/^v/, '') === version)) throw new Error(`Version ${version} already exists as a tag or release. Choose a new version.`);
  setReleaseVersion(process.cwd(), version);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Release version: ${version}`);
}
