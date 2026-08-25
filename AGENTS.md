# AGENTS.md — pichamber

## 准则

### 最大化SDK复用

当需要和Pi交互时，只要Pi的官方包（包括@earendil-works/pi-agent-core、@earendil-works/pi-ai、@earendil-works/pi-coding-agent）中有提供的相关类型、接口和功能函数等，均应该直接导入复用，切勿自行实现。

在传输和解析时，优先直接使用原样使用官方的数据结构，仅在最终前端页面展示时解析格式，减少中间层包装和新类型的发明。

### 第三方包文档先行

当你正在使用某一个第三方库时，请优先查阅其官方文档以了解正确的使用方式以及最佳实践，而非直接查看其源码来推断使用方法。文档位置可能在源码所在的包内，也可能需要在线搜索。Pi的官方文档位于其官方仓库[pi](https://github.com/earendil-works/pi.git)的`packages/coding-agent/docs/`目录下，使用SDK时可查阅`packages/coding-agent/docs/sdk.md`。

### 代码风格和审美

对于相同的功能实现，代码量越少越好。功能实现要保证“低耦合、高内聚”的原则。代码并非能跑就好，而是要写得优雅，保证可读性和可持续维护。

当我们要做一个新功能时，不要盲目开始新增代码，而是应当先从逻辑上搜寻当前项目内已有的组件或功能是否可以和新功能相似或同属于一个类别。如果发现我们的已有代码和新需要实现的功能在外观或者逻辑上有重叠，请优先重构已有代码，使其成为两处共用的组件，然后再分化出我们要的功能，而不是另行实现一个单独给这个功能的组件。

当我们的新需求需要引入全新的概念、或者打破项目内已有的模式时，请权衡新模式和旧模式对于项目整体的优劣，而不是仅单点考虑新需求。我们应当积极调整项目架构和代码设计。当新的实现引入的概念、技巧或设计风格可在原有的组件上运用时，你需要在新功能实现完成以后，继续重构旧代码，使得项目整体进化。

当代码语义产生变动时，请完全不要担心打破旧代码的兼容性，不要过度设计和防御性编程，积极大胆地删除代码。

TypeSript中的函数定义优先使用 `const foo = (...) => {}`；`void` / `Promise<void>` 的语法，不要使用`function`。返回类型通常交给 TypeScript 推断，不要标注 `void` 返回类型。

## 项目背景

项目配置了`vite-svg-loader` 可把 SVG 当 Vue 组件导入。当前项目内图标分为以下几种：

- `packages/web/src/assets/provider-logos`，其解析逻辑位于`packages/web/src/components/ui/ProviderLogo.tsx`。

- `lucide-static`包，是项目UI的优先图标来源。

- `packages/web/src/assets/icons`，补充lucide中缺少的图标。

morphicons是一个能够让不同的SVG stroke无缝切换的库，本项目中主要将其与来自lucide的图标配合使用，其解析逻辑位于`packages/web/src/components/ui/morphIcons.ts`。

当需要新增UI图标时，优先从`lucide-static`中获取。如果该图标是相同位置需要切换不同图标的，就使用在`morphIcons.ts`中注册，然后在其他组件中通过`<MorphIcon :icon="lucideIcon(pushIcon)" spring="snappy" />`来使用，一个最典型的应用在`packages/web/src/components/conversation/messages/ConversationDetail.vue:111`。

## 开发和调试

通常情况下，用户可能已经占用了 5173 端口和 3000 端口，启动了一个热更新的开发服务器。这种情况下，你无需继续运行`bun dev`。一般情况下，你完成一项功能之后，可以请求用户手动打开查看测试效果。但是，如果由于开发需要，你需要自行使用浏览器调试时，可以使用 Kimi WebBridge Skill `http://127.0.0.1:10086`。
