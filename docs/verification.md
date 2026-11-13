# Green Loop 验证记录

## 单元、引擎、清单测试

```sh
cd dsh-green-loop
node --test test/*.test.js
```

结果：**42 passed / 0 failed**。

覆盖：

- 检查命令检测：pnpm/npm/yarn/bun、pytest/uv/poetry、Go、Rust、Make、损坏的 package.json、非目录。
- 纯循环决策：通过、首次失败 steer、相同输出 stalled、不同输出继续、次数上限 red、abort、shell 错误。
- 引擎：arm、turn-stopping、runNow、probe、相对 cwd、detect 回退、disarm 中止。
- 失败消息、tail、ANSI 归一化、状态/结果格式化。
- 浏览器 factory：包名、inject、双语字典、dock 注册、session inject、样式。
- 发布清单：bundle/client/engines、patch 行、locale detail、图标、运行时文件存在。

## 工作区集成

```sh
cd /Users/rodin/Workspace/dsh-plugin
make test
```

结果：**61 passed / 0 failed**（Green Loop 42 + 之前的 Snippet Vault 19）。
Green Loop 的自动检测把根目录 `Makefile` 的 `test:` 目标解析为 `make test`。

## 真实 DSH 工具调用

在 Desktop profile 安装后调用 `green_check`：

```text
Green Loop check: PASS (exit 0 · 160ms)
Command: make test
...
ℹ tests 61
ℹ pass 61
ℹ fail 0
```

这验证了 Host 插件加载、`ctx.shell` 执行、workdir、超时参数、真实会话 cwd 上的自动检测，以及
canonical JSON 工具输出。

`green_status` 初始返回：

```text
Green Loop: off · no check resolved yet
```

## 真实 turn-stopping 闭环（用户已在 Dock 点击 Arm）

用户提供的 Dock 截图（`docs/dock.webp`）显示：

```text
Green Loop  ● Armed  make test        Disarm  Run now  Details
```

随后 `green_status` 返回：

```text
Green Loop: green · attempt 1/3 · check: make test
```

这验证了完整绿色路径：

1. Dock 加载并显示；
2. Arm 成功，自动检测出 `make test`；
3. 回合结束时 `agent/turn-stopping` 触发；
4. `ctx.shell` 实际运行 `make test`；
5. 退出码 0 → `attempt 1/3`、`status green`、自动 disarm。

## 浏览器 Dock 交互

用 React 18 + jsdom 在临时目录加载 `client.js`，挂载 `GreenLoopDock` 并执行：

1. 初始渲染（off）；
2. 点击 Arm → POST `/arm`，显示 `armed` 和 `make test`；
3. 打开 Details → 显示 `Makefile:test`；
4. 点击 Run now → POST `/run`，显示 `running`；
5. 点击 Stop → POST `/disarm`；
6. 卸载。

结果：全部通过。测试脚本位于临时目录，不随包发布。

## HTTP 准入

未认证请求：

```sh
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:59567/green-loop/api/state?sessionId=x"
```

结果：`401`，说明路由已注册且 `connection.requestRejection` 生效。

## 安装状态

`plugin_manager install_bundle` 返回 `application: applied`；Loader 行 `include:green-loop` 为 active。

## 发布 tarball 的新 profile 验证

```sh
DSH_HOME=/tmp/gl-test dsh plugin --profile gltest add ./dsh-green-loop-0.1.0.tgz
DSH_HOME=/tmp/gl-test dsh --profile gltest --dump-config-schema
```

结果：安装成功，schema dump 退出码 0，输出包含 `id: green-loop` / `name: dsh-green-loop`。
这证明 tarball 内含的运行时文件与 peer 解析在干净 profile 中可用。

注意：在同一个运行中的 Host 里把 link 安装替换为 tarball，可能命中旧的模块解析缓存
（从源码路径导入 `@deepseek-ai/cordis` 失败）。这是 DSH 安装通道切换的缓存行为；
换新 profile 或重启 Host 即可。桌面 profile 已恢复为 link 开发状态。

## 演示 GIF

`docs/demo.gif`（960×540，24 s，300 帧，12.5 fps）由 `docs/demo.html` 的确定性时间轴逐帧截取后合成。
它是 UI 流程的**模拟演示**，不是屏幕录制；GIF 内标注 DEMO / SIMULATED DEMO。真实插件已安装并验证。

## 尚未做的验证

- **失败 → steer → 修复**：绿色路径已真实跑通；失败 steer 由引擎单测（fake agent 捕获 `steer`）
  和 DSH `agent.steer` 契约覆盖，尚未在真实失败项目上完整走一遍。
- **Dock 深色/浅色视觉**：用户截图覆盖深色；浅色未截图。
