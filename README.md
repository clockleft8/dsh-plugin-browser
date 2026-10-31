# dsh-plugin-browser

DSH（DeepSeek Harness）的插件总览页：把装了的插件列成一页，分清官方和第三方，能搜索、能开关、能看详情，还带一次性自检。
纯本地代码，不含任何密钥，不联网。

## 安装

**方式 A（推荐，最省事）**：把仓库地址丢给 DSH

> 帮我把 https://github.com/你的名字/dsh-plugin-browser 装成插件

它会自己 clone、加进 profile、提示你重启。

**方式 B（手动）**

```bash
cd ~/.dsh/profiles/<你的 profile>/node_modules
git clone https://github.com/你的名字/dsh-plugin-browser.git
```

在 profile 的 `package.json` 里加 `"dsh-plugin-browser": "file:./node_modules/dsh-plugin-browser"`，
启用清单里加上 `dsh-plugin-browser`，重启 DSH。

装完顶栏多一个「插件」。想看有没有装上：插件列表里能找到它、状态是 active。

## 用法

- 顶栏「插件」进来，默认列出全部；顶部可按「官方 / 第三方」筛，右边搜索框按名字过滤。
- 每行右侧是开关，点了立即生效（写进 profile，所有会话共享）。关掉不影响本项目其它插件。
- 点一行打开详情浮窗：相位（空 / active）、启用状态、最近事件、「这次会话」事件流
  （含当前权限预设、沙箱模式、最近 25 条工具调用）。
- 「自检」按钮：一次只读体检——包在不在、入口 / 客户端 / patch 文件是否齐全、路由前缀是否冲突、
  DSH 版本是否满足要求。结果分两档：
  - 红色 = 真不能用的错误（版本不适配、入口缺失、文件完整但没跑起来）
  - 橙色 = 功能正常但清单与文件对不上（多为打包时用 `exports` 写法的差异）
- 「塞进输入框」：把当前插件状态拼成一句话，方便让我这样的助手帮你排查。

## 兼容性

在 DSH 更新前后两个版本上都验证过：插件状态 active、自检 265 项零错误零警告。
它依赖的是 DSH 的插件 API（客户端 slot 的 inject/register、宿主 `webServer.register`、`pluginManager`）。
接口大改的版本可能不适用，届时自检会报「文件完整但没跑起来」，那就是版本不适配。

## 卸载

插件列表里关掉它，然后从 profile 的 `package.json` 去掉那一行、删掉 `node_modules` 下的目录，重启。

## 许可

MIT