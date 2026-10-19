# React 作品编译工具

此工具复用 demo 的三个源模块，执行 Babel AST 检查与 esbuild 编译。它不运行候选代码，不监听 HTTP，也不读写故事或数据库。运行时脚本只在浏览器原版 opaque iframe 沙箱中执行。

```sh
npm ci
npm test
node worker.mjs < request.json
```

stdin 是单个 `{ "node": <原 type=react 定义> }`，stdout 成功返回 `{ "bundle": <type=interactive, renderer=react-bundle> }`。失败退出码65，stderr只含错误类别与候选行列。输入最多256KiB，输出最多2MiB，单次编译30秒。

依赖版本沿用 demo 并由 package-lock.json 固定。node_modules 属于本机依赖缓存，不作为融合源码提交。原编译器、React定义验证器和沙箱状态验证器位于 src/，保留原始源码；Go宿主负责超时、公开资料归属、版本与持久化。
