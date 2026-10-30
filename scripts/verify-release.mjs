import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = process.env.RELEASE_TAG;
assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/, 'Use a stable release tag such as v0.1.3');
assert.equal(tag, `v${pkg.version}`, 'Release tag must match package.json version');
if (process.argv.includes('--marketplace')) {
  assert.notEqual(pkg.publisher, 'local-tools', 'Replace local-tools with your registered Marketplace publisher ID before publishing');
  assert.ok(pkg.repository?.url, 'Configure the actual GitHub repository in package.json before publishing');
}
console.log(`Validated ${tag} (${pkg.publisher}.${pkg.name})`);
