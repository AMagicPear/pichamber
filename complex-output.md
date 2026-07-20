# 复杂输出演示

## 数学公式

行内公式如 $E = mc^2$ 或 $e^{i\pi} + 1 = 0$，以及复杂公式：

$$
\frac{d}{dx} \left( \int_{a}^{x} f(t)\,dt \right) = f(x)
$$

**傅里叶变换**：

$$
\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) \, e^{-2\pi i x \xi} \, dx
$$

**泰勒级数**：

$$
f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!}(x - a)^n
$$

**贝叶斯定理**：

$$
P(A \mid B) = \frac{P(B \mid A) \, P(A)}{P(B)}
$$

**拉普拉斯方程**：

$$
\nabla^2 \varphi = \frac{\partial^2 \varphi}{\partial x^2} + \frac{\partial^2 \varphi}{\partial y^2} + \frac{\partial^2 \varphi}{\partial z^2} = 0
$$

**矩阵乘法**：

$$
\begin{pmatrix}
a_{11} & a_{12} \\
a_{21} & a_{22}
\end{pmatrix}
\begin{pmatrix}
b_{11} & b_{12} \\
b_{21} & b_{22}
\end{pmatrix}
=
\begin{pmatrix}
a_{11}b_{11} + a_{12}b_{21} & a_{11}b_{12} + a_{12}b_{22} \\
a_{21}b_{11} + a_{22}b_{21} & a_{21}b_{12} + a_{22}b_{22}
\end{pmatrix}
$$

**分段函数**：

$$
f(x) =
\begin{cases}
x^2, & \text{if } x \ge 0 \\
-x,  & \text{if } x < 0
\end{cases}
$$

---

## 表格

### 排序算法对比

| 算法        | 最好          | 平均          | 最坏          | 空间      | 稳定 |
|------------|--------------|--------------|--------------|----------|:----:|
| 冒泡排序    | $O(n)$       | $O(n^2)$     | $O(n^2)$     | $O(1)$   | 是   |
| 快速排序    | $O(n\log n)$ | $O(n\log n)$ | $O(n^2)$     | $O(\log n)$ | 否 |
| 归并排序    | $O(n\log n)$ | $O(n\log n)$ | $O(n\log n)$ | $O(n)$   | 是   |
| 堆排序      | $O(n\log n)$ | $O(n\log n)$ | $O(n\log n)$ | $O(1)$   | 否   |
| 插入排序    | $O(n)$       | $O(n^2)$     | $O(n^2)$     | $O(1)$   | 是   |
| 基数排序    | $O(nk)$      | $O(nk)$      | $O(nk)$      | $O(n+k)$ | 是   |

### 框架技术选型

| 特性                | React 19        | Vue 3.5         | Svelte 5        | Solid 1.9      |
|--------------------|-----------------|-----------------|-----------------|----------------|
| 虚拟 DOM           | 是              | 是              | 否（编译时）    | 否（细粒度）   |
| TypeScript 支持   | 一等公民        | 一等公民        | 内置            | 内置           |
| 运行时体积         | ~42 KB          | ~33 KB          | ~2 KB           | ~7 KB          |
| 服务器组件         | 是              | 否              | 是              | 否             |
| 信号/原子更新      | 外部库          | `ref()`/`reactive()` | `$state`   | 核心原语       |
| 生态成熟度         | ★★★★★          | ★★★★☆          | ★★★☆☆          | ★★☆☆☆         |

---

## 代码引用

在 `src/components/` 中，核心的 `Editor` 组件使用了 **debounce** 模式（见 `src/hooks/useDebounce.ts`）：

```typescript
// src/hooks/useDebounce.ts
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])

  return debounced
}
```

与 `src/stores/editorStore.ts` 配合使用：

```typescript
// src/stores/editorStore.ts
import { useDebounce } from '../hooks/useDebounce'

export const useEditorStore = create<EditorState>((set) => ({
  content: '',
  // 自动保存时防抖 500ms
  debouncedContent: (value: string) => useDebounce(value, 500),
  setContent: (content: string) => set({ content }),
}))
```

而服务器端的 WebSocket handler 位于 `src-server/sessions.ts`：

```typescript
// src-server/sessions.ts
export class SessionManager {
  private sessions = new Map<string, Session>()

  create(userId: string): Session {
    const session = new Session(userId)
    this.sessions.set(session.id, session)
    return session
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }
}
```

---

## 复杂 Markdown 结构

### 嵌套列表

1. **数据层**
   - 本地存储：SQLite + IndexedDB
   - 远程同步：WebSocket + CRDT
     - Y.js 作为 CRDT 库
     - 自动合并冲突
   - 缓存策略：LRU + TTL
     - 内存缓存（200ms）
     - 持久化缓存（5min）
2. **渲染层**
   - Markdown 解析：Shiki + KaTeX
   - 代码高亮：支持 37 种语言
   - 数学公式：行内 `$` 与块级 `$$`
3. **交互层**
   - 快捷键系统：`Cmd+K`（命令面板）
   - 拖拽排序：`dnd-kit`
   - 实时协作：Y.js 同步

> **注意**：实时协作功能在 v0.2 中为实验性特性，需在配置中显式启用。

### 包含代码块的引用块

> `src-server/server.ts` 中启动 HTTP + WebSocket 服务：
>
> ```typescript
> const app = express()
> const httpServer = createServer(app)
>
> const io = new Server(httpServer, {
>   cors: { origin: 'http://localhost:1420' }
> })
>
> httpServer.listen(1420, () => {
>   console.log('Pichamber server running on http://localhost:1420')
> })
> ```
>
> 参见：[Node.js HTTP 文档](https://nodejs.org/api/http.html)

---

## JSON 与表格混合

```json
{
  "pipeline": {
    "input": "user message",
    "steps": ["parse", "execute", "render"],
    "parallel": true,
    "timeout_ms": 30000
  }
}
```

转为表格：

| 字段          | 值                                        |
|--------------|--------------------------------------------|
| `input`      | `"user message"`                           |
| `steps`      | `["parse", "execute", "render"]`           |
| `parallel`   | `true`                                     |
| `timeout_ms` | `30000`                                    |

---

## 带批注的代码行引用

在 `vite.config.ts` 第 **12-18** 行：

```typescript
// line 12 - 18
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,            // Pichamber 默认端口
    strictPort: true,      // 端口被占用时直接报错而非退让
  },
})
```
