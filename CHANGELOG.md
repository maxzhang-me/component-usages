# Changelog

## 0.1.3

- 配置推送版本标签后自动检查、测试、打包并提交 Marketplace 发布。
- 使用 GitHub Trusted Publishing 与 OIDC 认证，无需保存发布令牌。
- 更新发布工具至 @vscode/vsce 4.1.0，并完善维护与发布说明。

## 0.1.2

- 调整用法弹框列表布局：第一行显示用法代码，第二行显示对应文件路径和行列号；继续支持按代码或路径搜索。

## 0.1.1

- 修复 Nuxt 默认自动导入组件查不到用法：定向读取被排除的 `.nuxt/components.d.ts` 与 `.nuxt/types/components.d.ts`。
- 支持 `_GlobalComponents`、组件导出类型、Lazy/Island 类型包装以及 `#components` 具名导入。
- 按声明中的实际组件名匹配目录前缀、PascalCase/kebab-case，并解析相对及绝对源文件路径。
- 支持声明文件更新与删除后的索引刷新，隔离工作区中不同 Nuxt 子项目的声明。

## 0.1.0

- 首次发布：Vue 优先的顶部组件用法提示、单处跳转、多处筛选列表与内嵌预览。
- 支持组件导入路径解析、全局注册、路径别名及配置式自动导入目录。
- 包含解析测试和 VS Code 扩展宿主集成测试。
