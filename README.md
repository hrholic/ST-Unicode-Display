# SillyTavern Unicode 转义显示还原

把聊天正文里按字面显示的 `\u4F60\u597D`、`\uD83D\uDE00` 和 `\u{1F600}` 还原为可读文字。扩展只修改浏览器中的正文文本节点，不改聊天记录，也不会把解码结果当作 HTML 插入。

## 功能与边界

- 默认开启，仅处理 AI 回复；可在入口弹窗中改为“全部聊天消息”或关闭。
- 设置入口位于聊天输入框左侧的魔杖“扩展”菜单，点击后在原生弹窗中调整开关和适用范围。
- 支持 `\uXXXX`、UTF-16 代理对 emoji，以及 `\u{1F600}` 形式。
- 非法转义和孤立代理保持原样。
- 跳过 `pre`、`code`、`kbd`、`samp`、编辑框及可编辑区域。
- 偶数个连续反斜杠视为展示语法，因此 `\\u4F60` 不会被还原。
- 监听正文局部 DOM 变化以覆盖流式生成；在加载历史、生成完成、切换聊天、编辑及滑动消息时补充扫描当前聊天正文。
- 覆盖正则渲染器后续生成的动态面板；对浏览器允许访问的同源 iframe，会在初始/延迟加载及后续交互更新时同步处理。跨域或隔离的 iframe 会保持原样。
- 每个文本节点只解码一层，防止重复事件把 `\u005Cu4F60` 继续级联解码。

## 安装

推荐在 SillyTavern 的扩展管理器中选择“安装扩展”，输入：

```text
https://github.com/hrholic/ST-Unicode-Display
```

也可以任选一种方式手动复制整个目录：

1. 当前用户：复制到 `SillyTavern/data/<用户句柄>/extensions/unicode-display-decoder/`。
2. 所有用户：复制到 `SillyTavern/public/scripts/extensions/third-party/unicode-display-decoder/`。

然后重启或重新加载 SillyTavern，在聊天输入框左侧点击魔杖“扩展”按钮，选择“Unicode 转义显示还原”。

## 更新

从 1.1.2 起允许 SillyTavern 自动检查扩展更新。已经安装 1.1.1 或更早版本的用户，本地清单仍为 `auto_update: false`，因此需要先在扩展管理器中手动检查并更新一次，然后重新加载页面；之后才会使用新清单参与自动检查。

## 测试

需要 Node.js 20 或更新版本，无需安装依赖：

```powershell
cd ST-Unicode-Display
npm test
```

测试覆盖普通中文、有效 Unicode、emoji、非法/孤立代理、HTML 注入文本、多重反斜杠、代码区域、重复处理、同文档及同源 iframe 动态更新、设置范围、observer 清理及恢复原文。
