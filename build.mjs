import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const result = await build({entryPoints:['src/extension.ts','src/analyzer.ts'],bundle:true,outdir:'dist',platform:'node',format:'cjs',external:['vscode'],alias:{'@vue/compiler-sfc':'@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js'},sourcemap:true,minify:true,metafile:true});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let dir = path.dirname(path.resolve(input));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir,'package.json'))) { packages.add(dir); break; }
    dir = path.dirname(dir);
  }
}
let notices = 'Third-party libraries bundled with Component Usages\n\n';
for (const dir of [...packages].sort()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  notices += `${pkg.name} ${pkg.version} — ${pkg.license ?? 'see license below'}\n`;
  const files = fs.readdirSync(dir).filter(f => /^(licen[cs]e|notice|copyright)(\.|$)/i.test(f));
  for (const file of files) if (fs.statSync(path.join(dir,file)).isFile()) notices += fs.readFileSync(path.join(dir,file),'utf8')+'\n';
  notices += '\n----------------------------------------\n\n';
}
fs.writeFileSync('THIRD-PARTY-NOTICES.txt', notices.replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trimEnd() + '\n');
