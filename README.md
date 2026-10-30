# Component Usages — Code Vision

在 VS Code 组件文件顶部显示 **显示组件用法**，复刻 WebStorm Component usages 的核心操作路径。优先支持 Vue 2/3，同时支持常规 Svelte、Astro、React JSX/TSX 导入与标签用法。

## 安装与使用

1. 在 VS Code 扩展面板右上角 `…` 选择 **Install from VSIX… / 从 VSIX 安装…**，选择从 GitHub Releases 或 `npm run package` 获取的 `.vsix` 文件。
2. 打开项目文件夹，再打开一个 `.vue` 组件。确保设置 `editor.codeLens` 为 `true`（默认开启）。
3. 点击文件第一行上方的 **显示组件用法**。只有一处用法时直接跳转并选中标签；多处用法时打开可搜索列表，每项分两行显示：第一行是用法代码，第二行是文件路径和行列号，按 Enter 跳转，Esc 关闭。
4. 列表右上角的引用按钮可切换到内嵌预览；也可以使用编辑器右键菜单的 **预览组件用法**。

```sh
code --install-extension artifacts/component-usages-code-vision-0.1.2.vsix
```

扩展使用 VS Code 原生 CodeLens、Quick Pick 和 Peek UI，跟随颜色主题、字体和键盘操作。VS Code 稳定 API 不提供 JetBrains 编辑器浮动窗口，因此弹窗像素、右键提示菜单和位置不能与 WebStorm 完全一致。

## Vue 支持范围

- `<script setup>` 和普通 `<script>` 中的静态导入。
- PascalCase、kebab-case；Options API `components: { 'app-card': ImportedCard }` 注册别名。
- `app.component('AppCard', ImportedCard)` 静态全局注册；生成的 `GlobalComponents` 接口中 `typeof import('…')['default']` 声明（如 unplugin-vue-components）。
- 同名组件按模块路径区分；默认导入、具名导入、命名空间标签、再导出及 `export *`。
- 相对路径、无后缀路径、目录 index、常见 `.js` → `.ts` 源码解析、导入 query 后缀。
- `tsconfig*.json` / `jsconfig*.json` 的 `baseUrl`、`paths`、相对路径 `extends`；支持 JSON 注释。最近目录的配置优先，同目录优先使用含 paths 的配置。
- `defineAsyncComponent(() => import('./Card.vue'))` 的标签引用。
- `<component :is="ImportedCard"/>`、静态字符串 `is` / `:is`。
- 文件新增、删除、改名、内容修改及未保存的编辑会使索引失效；下次查找读取最新内容。
- 多根工作区按 URI 分离，使用 workspace.fs 读取，支持远程文件系统；已在本地 macOS VS Code 验证，Remote/Windows 尚未实机验证。

默认提示与 WebStorm 相同，显示操作入口。想显示数量可设置 `componentUsages.label: "count"`。

## 常见项目配置

Vite 中配置在 `vite.config.ts`、未写入 tsconfig 的别名，可以补充到 `.vscode/settings.json`：

```json
{
  "editor.codeLens": true,
  "componentUsages.aliases": { "@": "./src", "~": "." },
  "componentUsages.language": "zh-cn",
  "componentUsages.label": "action"
}
```

Nuxt 默认自动导入无需配置：扩展会定向读取 `.nuxt/components.d.ts` 和 `.nuxt/types/components.d.ts`，即使 `.nuxt` 在排除目录中。按生成的 `_GlobalComponents` / `GlobalComponents` 属性及组件导出声明建立名称映射，支持目录前缀、Lazy 名称、相对路径和绝对路径；声明文件更新后自动刷新。

例如声明中 `AccountPaymentInstallmentsDueAutoPayDialog` 指向 `components/account/payment/installments_due/autoPayDialog.vue`，模板直接使用这个名称即可查到用法。`#components` 中的具名导入及别名也支持。单根工作区下的多个 Nuxt 子项目会各自限定声明的作用范围。

首次生成声明前，请先运行你项目的 Nuxt 开发或 prepare 命令。声明不存在、使用自定义构建目录或其他自动导入机制时，可补充配置：

```json
{
  "componentUsages.autoImportDirectories": ["components", "src/components"],
  "componentUsages.globalComponents": {
    "AppButton": "src/components/Button.vue"
  }
}
```

自动导入目录支持文件名及目录前缀，例如 `components/ui/Card.vue` 可匹配 `UiCard` / `ui-card`。只有候选文件唯一时才匹配；同名歧义需要显式导入或配置全局映射。目录扫描约定与 Nuxt 的全部配置选项并不等同。

其他设置：

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| `componentUsages.enabled` | `true` | 显示顶部提示 |
| `componentUsages.openMode` | `popup` | `popup` 列表或 `peek` 内嵌预览 |
| `componentUsages.singleUsageJump` | `true` | 单处直接跳转 |
| `componentUsages.language` | `auto` | 跟随编辑器语言，或 `zh-cn` / `en` |
| `componentUsages.include` | JS/TS 和组件文件 | 索引范围 |
| `componentUsages.exclude` | 依赖、构建目录等 | 排除范围 |
| `componentUsages.maxFiles` | `15000` | 文件上限，超出会提示不完整 |

命令面板中搜索 `Component Usages`，可查找、预览、刷新索引、隐藏或显示提示。诊断信息见输出面板 `Component Usages`。

## 准确性边界

本扩展是本地静态组件渲染索引，并未复制 WebStorm 的专有语言服务。结果只统计组件渲染位置，不把 import 行、类型引用、注释和结束标签重复计数。未找到结果不等同于组件可以安全删除。

以下情况暂未完整支持：运行时拼接的动态组件名、路由配置里的组件引用、render/h 函数、任意高阶组件工厂、模板 Pug、复杂作用域遮蔽、第三方包 exports 映射、包形式的 tsconfig extends、构建工具中的任意代码别名规则。全局注册按工作区根目录生效，单根多应用的注册作用域可能需要显式配置。Svelte/Astro 使用轻量标签扫描，复杂表达式中的标签状字符串可能误报；Vue 使用官方 SFC 与模板解析器，React 使用 TypeScript JSX 语法树。React 用法按文件归集，同文件导出的多个组件不分别显示 CodeLens。

索引在扩展宿主本地运行，不执行项目代码、不上传源码、不调用 AI 服务。首次查找需读取符合 glob 的项目文件；后续缓存至文件或配置变化。达到上限或遇到读取失败会警告；数量模式用 `+` 标记不完整计数。

## 维护与发布

构建、测试和贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，GitHub Release 与 Marketplace 发布步骤见 [PUBLISHING.md](PUBLISHING.md)。每次推送或 PR 会触发 CI；完成一次 Marketplace Trusted Publishing 配置后，推送 `v版本号` 标签会自动测试、打包并上架，同时生成附带 VSIX 的 GitHub 草稿 Release。

## 开发与验证

需要 Node.js 22 或以上：

```sh
npm ci
npm run check
npm test
npm run test:host
npm run package
```

`npm test` 覆盖 Vue 导入/注册、别名、再导出循环、全局声明、动态组件、同名隔离、多根工作区、其他框架等。`test:host` 在独立 VS Code 测试数据目录中验证扩展激活、顶部 CodeLens、命令跳转、选区以及未保存编辑的索引刷新。测试脚本优先使用 `VSCODE_EXECUTABLE_PATH`，macOS 回落到 `/Applications/Visual Studio Code.app/Contents/MacOS/Code`，其他系统可由 test-electron 下载 VS Code。F5 可启动开发窗口。

打包后的 VSIX 已包含运行时依赖，使用时无需安装 Node.js、npm 或其他框架扩展。

## 参考与许可

行为参考 [WebStorm Vue Component usages](https://www.jetbrains.com/help/webstorm/vue-js.html)；实现使用 [VS Code 扩展 API](https://code.visualstudio.com/api/references/vscode-api)。独立实现，与 JetBrains 无关联。项目采用 MIT License，第三方许可见 `THIRD-PARTY-NOTICES.txt`。
