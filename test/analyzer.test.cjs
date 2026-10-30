const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ProjectIndex, parseConfig } = require('../dist/analyzer');
const make = (files, opts={}) => new ProjectIndex(Object.entries(files).map(([file,text])=>({path:'/project/'+file,text,root:'/project'})),opts);
const card = '<template><button/></template>';
const find = (index, file='Card.vue') => index.find('/project/'+file);
test('Vue script setup: renamed import, PascalCase and kebab-case, exact offsets',()=>{
 const text = `<script setup lang="ts">import MyCard from './Card.vue'</script>\n<template><MyCard/><my-card/><div/></template>`;
 const items = find(make({'Card.vue':card,'App.vue':text}));
 assert.equal(items.length,2); for(const i of items) assert.equal(text.slice(i.start,i.start+i.length),i.tag);
});
test('same names in different directories never leak',()=>{
 const index = make({'a/Card.vue':card,'b/Card.vue':card,'App.vue':`<script setup>import Card from './a/Card.vue'</script><template><Card/></template>`});
 assert.equal(find(index,'a/Card.vue').length,1); assert.equal(find(index,'b/Card.vue').length,0);
});
test('imports alone, comments, strings and closing tags do not count',()=>{
 assert.equal(find(make({'Card.vue':card,'App.vue':`<script setup>import Card from './Card.vue'; const x='<Card/>'</script><template><!-- <Card/> --><div title="<Card/>"></div></template>`})).length,0);
});
test('Options API renamed registration',()=>{
 assert.equal(find(make({'Card.vue':card,'App.vue':`<script>import C from './Card.vue';export default { components:{'app-card':C} }</script><template><app-card/></template>`})).length,1);
});
test('barrel exports, local re-exports, export star, cycle',()=>{
 const index = make({'Card.vue':card,'barrel.ts':`export {default as Card} from './Card.vue'`,'local.ts':`import {Card as C} from './barrel'; export {C as Card}`,'index.ts':`export * from './cycle'; export * from './local'`,'cycle.ts':`export * from './index'`,'App.vue':`<script setup>import {Card as X} from './index'</script><template><X/></template>`});
 assert.equal(find(index).length,1);
});
test('namespace imports through barrels',()=>{
 assert.equal(find(make({'Card.vue':card,'index.ts':`export {default as Card} from './Card.vue'`,'App.vue':`<script setup>import * as UI from './index'</script><template><UI.Card/></template>`})).length,1);
});
test('custom aliases and query suffixes',()=>{
 assert.equal(find(make({'Card.vue':card,'App.vue':`<script setup>import C from '@/Card.vue?vue'</script><template><C/></template>`},{aliases:{'@':'.'}})).length,1);
});
test('tsconfig paths wildcard plus JSON comments',()=>{
 const config = parseConfig('/project/tsconfig.json',`{//hi\n"compilerOptions":{"baseUrl":".","paths":{"@ui/*":["components/*"]},},}`);
 const index = make({'components/Card.vue':card,'App.vue':`<script setup>import C from '@ui/Card.vue'</script><template><C/></template>`},{configs:[config]});
 assert.equal(find(index,'components/Card.vue').length,1);
});
test('extensionless directory imports and .js to .ts substitution',()=>{
 assert.equal(find(make({'Card.vue':card,'ui/index.ts':`export {default as Card} from '../Card.vue'`,'barrel.ts':`export {Card} from './ui'`,'App.vue':`<script setup>import {Card} from './barrel.js'</script><template><Card/></template>`})).length,1);
});
test('dynamic Vue :is values and async component imports',()=>{
 const text = `<script setup>import {defineAsyncComponent} from 'vue';const AsyncCard=defineAsyncComponent(()=>import('./Card.vue'))</script><template><AsyncCard/><component :is="AsyncCard"/><component :is="'async-card'"/></template>`;
 assert.equal(find(make({'Card.vue':card,'App.vue':text})).length,3);
});
test('explicit global registration and static is',()=>{
 assert.equal(find(make({'Card.vue':card,'App.vue':`<template><app-card/><component is="app-card"/></template>`},{globals:{AppCard:'Card.vue'}})).length,2);
});
test('auto import directories support nested prefixed names',()=>{
 const index = make({'components/ui/Card.vue':card,'App.vue':'<template><UiCard/><Card/></template>'},{autoDirs:['components']});
 assert.equal(find(index,'components/ui/Card.vue').length,2);
});
test('ambiguous implicit component names are ignored',()=>{
 const index = make({'components/a/Card.vue':card,'components/b/Card.vue':card,'App.vue':'<template><Card/></template>'},{autoDirs:['components']});
 assert.equal(find(index,'components/a/Card.vue').length,0);
});
test('Svelte and Astro script imports and comments',()=>{
 const index=make({'Card.svelte':'<button/>','Page.svelte':`<script lang="ts">import Card from './Card.svelte'</script><!-- <Card/> --><Card/><Card></Card>`,'Widget.astro':'<button/>','Page.astro':`---\nimport X from './Widget.astro';\n---\n<X/>`});
 assert.equal(find(index,'Card.svelte').length,2); assert.equal(find(index,'Widget.astro').length,1);
});
test('React JSX and lazy imports use syntax tree, ignore strings',()=>{
 const index=make({'Card.tsx':'export default function Card(){return <div/>}','App.tsx':`import Card from './Card';const x='<Card/>';const Lazy=React.lazy(()=>import('./Card')); export default ()=> <><Card/><Card></Card><Lazy/></>`});
 assert.equal(find(index,'Card.tsx').length,3);
});
test('type-only imports are never components',()=>{
 assert.equal(find(make({'Card.vue':card,'App.vue':`<script setup lang="ts">import type Card from './Card.vue'</script><template><Card/></template>`})).length,0);
});
test('incomplete template editing does not throw',()=>{
 assert.doesNotThrow(()=>make({'Card.vue':card,'App.vue':'<template><Card :x="'}));
});
test('multi-root projects preserve separate targets',()=>{
 const index = new ProjectIndex([{path:'/a/Card.vue',text:card,root:'/a'},{path:'/b/Card.vue',text:card,root:'/b'},{path:'/b/App.vue',text:`<script setup>import Card from './Card.vue'</script><template><Card/></template>`,root:'/b'}]);
 assert.equal(index.find('/a/Card.vue').length,0); assert.equal(index.find('/b/Card.vue').length,1);
});
test('Vue app.component registration and generated GlobalComponents types',()=>{
 const index=make({'Card.vue':card,'main.ts':`import Card from './Card.vue'; app.component('GlobalCard', Card)`,'components.d.ts':`declare module 'vue' {export interface GlobalComponents { OtherCard: typeof import('./Card.vue')['default'] }}`,'App.vue':`<template><GlobalCard/><other-card/></template>`});
 assert.equal(find(index).length,2);
});
test('config extends resolves aliases from inherited base directory',()=>{
 const {resolveConfigs}=require('../dist/analyzer');
 const configs=resolveConfigs(new Map([['/project/base/tsconfig.json',`{"compilerOptions":{"baseUrl":"..","paths":{"@/*":["src/*"]}}}`],['/project/app/tsconfig.json',`{"extends":"../base/tsconfig.json"}`]]));
 const index=make({'src/Card.vue':card,'app/App.vue':`<script setup>import Card from '@/Card.vue'</script><template><Card/></template>`},{configs});
 assert.equal(find(index,'src/Card.vue').length,1);
});
test('explicit mapping disambiguates auto-import candidates',()=>{
 const index=make({'components/a/Card.vue':card,'components/b/Card.vue':card,'App.vue':'<template><Card/></template>'},{autoDirs:['components'],globals:{Card:'components/a/Card.vue'}});
 assert.equal(find(index,'components/a/Card.vue').length,1);assert.equal(find(index,'components/b/Card.vue').length,0);
});
const autoPayPath = 'components/account/payment/installments_due/autoPayDialog.vue';
const autoPayName = 'AccountPaymentInstallmentsDueAutoPayDialog';
const nuxtTag = `<template>\n<${autoPayName}\n @refresh="getDetail"\n ref="autoPayRef"\n></${autoPayName}>\n</template>`;
test('Nuxt user regression: _GlobalComponents extends and nested autoPayDialog path',()=>{
 const declaration = `interface _GlobalComponents { '${autoPayName}': typeof import('../${autoPayPath}')['default'] }\ndeclare module 'vue' { export interface GlobalComponents extends _GlobalComponents {} }\nexport {}`;
 const index=make({[autoPayPath]:card,'.nuxt/components.d.ts':declaration,'pages/account.vue':nuxtTag});
 const usages=find(index,autoPayPath);assert.equal(usages.length,1);
 assert.equal(usages[0].tag,autoPayName);assert.equal(nuxtTag.slice(usages[0].start,usages[0].start+usages[0].length),autoPayName);
});
test('Nuxt generated const exports, lazy wrappers, kebab-case, #components rename',()=>{
 const declaration=`export const ${autoPayName}: typeof import('../${autoPayPath}')['default'];\nexport const Lazy${autoPayName}: LazyComponent<typeof import('../${autoPayPath}')['default']>`;
 const index=make({[autoPayPath]:card,'.nuxt/components.d.ts':declaration,'pages/account.vue':`<script setup>import {${autoPayName} as Dialog} from '#components'</script><template><account-payment-installments-due-auto-pay-dialog/><Lazy${autoPayName}/><Dialog/></template>`});
 assert.equal(find(index,autoPayPath).length,3);
});
test('Nuxt types/components.d.ts import().default and wrapper types',()=>{
 const index=make({[autoPayPath]:card,'.nuxt/types/components.d.ts':`interface _GlobalComponents { ${autoPayName}: import('../../${autoPayPath}').default; Lazy${autoPayName}: LazyComponent<IslandComponent<typeof import('../../${autoPayPath}')['default']>> }`,'app.vue':`<template><${autoPayName}/><Lazy${autoPayName}/></template>`});
 assert.equal(find(index,autoPayPath).length,2);
});
test('Nuxt absolute generated import paths preserve URI identity',()=>{
 const prefix='/file%3A/project';
 const index=new ProjectIndex([
  {path:prefix+'/'+autoPayPath,root:prefix,text:card},
  {path:prefix+'/.nuxt/components.d.ts',root:prefix,text:`export const ${autoPayName}: typeof import('/project/${autoPayPath}')['default']`},
  {path:prefix+'/app.vue',root:prefix,text:nuxtTag}
 ]);
 assert.equal(index.find(prefix+'/'+autoPayPath).length,1);
});
test('Nuxt declarations stay scoped to nested projects in a monorepo',()=>{
 const files={};
 for (const project of ['shop','admin']) {
  files[project+'/'+autoPayPath]=card;
  files[project+'/.nuxt/components.d.ts']=`export const ${autoPayName}: typeof import('../${autoPayPath}')['default']`;
  files[project+'/app.vue']=nuxtTag;
 }
 files['outside.vue']=nuxtTag;
 const index=make(files);
 for (const project of ['shop','admin']) { const usages=find(index,project+'/'+autoPayPath);assert.equal(usages.length,1);assert.equal(usages[0].path,'/project/'+project+'/app.vue'); }
});
test('non-Nuxt typed exported constants do not become global components',()=>{
 const index=make({[autoPayPath]:card,'not-nuxt.ts':`export const ${autoPayName}: typeof import('./${autoPayPath}')['default']`,'app.vue':nuxtTag});
 assert.equal(find(index,autoPayPath).length,0);
});
