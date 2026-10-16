import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function setReleaseVersion(root, version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '') || version.split('.').some(part => Number(part) > 65535)) {
    throw new Error('Use a version such as 0.2.0, with each number between 0 and 65535.');
  }
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
  setReleaseVersion(process.cwd(), process.env.RELEASE_VERSION);
  console.log(`Release version: ${process.env.RELEASE_VERSION}`);
}
