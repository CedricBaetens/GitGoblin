import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setReleaseVersion } from '../scripts/release-version.mjs';

it('stamps all app versions without changing dependency versions or accepting invalid releases', () => {
  const root = mkdtempSync(join(tmpdir(), 'gitgoblin-version-'));
  try {
    mkdirSync(join(root, 'src-tauri'));
    for (const path of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
      writeFileSync(join(root, path), readFileSync(path));
    }
    const lock = readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8');
    for (const version of ['', 'v1.2.3', '1.2', '1.2.3-beta', '01.2.3', '65536.0.0', '1.2.3\n', '1.2.3; echo unsafe']) {
      expect(() => setReleaseVersion(root, version)).toThrow('Use a version');
    }
    expect(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8')).toBe(lock);
    setReleaseVersion(root, '0.2.3');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.2.3');
    const npmLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    expect(npmLock.version).toBe('0.2.3');
    expect(npmLock.packages[''].version).toBe('0.2.3');
    expect(npmLock.packages['node_modules/vue']).toEqual(JSON.parse(readFileSync('package-lock.json', 'utf8')).packages['node_modules/vue']);
    expect(JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version).toBe('0.2.3');
    expect(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8')).toContain('version = "0.2.3"');
    expect(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8')).toBe(lock.replace(/(name = "gitgoblin"\r?\nversion = ")[^"]+/, '$10.2.3'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
