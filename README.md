# 局域网聊天助手（dsh-lan-chat）

完全离线的内网即时通讯插件。给 DeepSeek Harness 左侧新增一个 **「局域网聊天助手」** 入口，
支持 **单聊**、**群聊**、**文件传输**，以及 **按网段扫描发现同事**。

不连任何外部服务：没有云端账号、没有中转服务器、没有 CDN 依赖。所有流量只在你自己的局域网里。

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 单聊 | 与任意一位同事一对一聊天，支持未读数、已读位置、在线状态 |
| 群聊 | 自建群、拉人入群、改名、退群、删除；群资料自动同步给成员 |
| 文件传输 | 拖拽或点选发送，单文件上限可配（默认 512MB）；接收方按需下载（不占用对方磁盘两次） |
| 网段扫描 | 填 `192.168.1.0/24` 即可并发探测，进度实时显示 |
| 自动发现 | 每 30 秒 UDP 广播一次，同网段的人无需手动添加就能互相看到 |
| 手动探测 | 知道对方 IP 时直接探测单个地址 |
| 访问码 | 可选。设置后只有知道访问码的人能与你通信 |
| 联系人备注 | 给同事起本地备注名（如「隔壁老王」），只改自己这边的显示，不通知对方 |
| 删除消息 | 单条删除或整个会话清空；只删本机记录，对方那份不受影响 |
| 删除群聊 | 群主删=解散（通知全员一起删），成员删=只删本机这份；都会清掉该群本地消息 |
| 文件上限 | 设置里可改单文件上限（64MB ~ 64GB），发送框提示实时跟随 |
| 离线可用 | 对端不在线时消息照常记录在本地，联网后手动重发即可 |

## 界面

左侧会话列表 + 右侧聊天区，三个页签：

- **会话** — 所有单聊和群聊，带最后一条预览、时间、未读红点
- **联系人** — 已添加的同事，显示在线状态与 IP
- **发现** — 扫描网段 / 手动探测 / 一键添加

---

## 安装

> **从 1.x 升级到 2.x 请看 [CHANGELOG](CHANGELOG.md)。** 2.0.0 是破坏性安全版本，
> 协议不兼容，局域网内**所有机器必须一起升级**，否则互相连不上。

### 方式一：从 GitHub 装（推荐）

在 DSH Desktop 的插件市场里搜索 `dsh-lan-chat`，或者直接用命令：

```bash
dsh plugin --profile desktop add github:jasonchan2026/dsh-lan-chat
```

装完重启 DSH Desktop，左侧就会出现「局域网聊天助手」。

### 方式二：从本地目录装

已经 clone 到本地的话：

```bash
dsh plugin --profile desktop add link:$PWD
```

`dsh plugin add` 会自动做两件事：把包写进 profile 的 `dependencies`，
并把包名追加进 `dsh.profile.bundles`（因为本包声明了 `dsh.bundle`）。

### 手动接线（了解原理用）

如果不用 `dsh plugin add`，手工接也只要改 profile 的 `package.json` 两处：

```jsonc
{
  "dependencies": {
    "dsh-lan-chat": "link:/path/to/dsh-lan-chat"   // 或 github:<用户名>/dsh-lan-chat
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-lan-chat"                              // ← 追加这一项
      ]
    }
  }
}
```

插件的 Loader 条目由包内自带的 `cordis.patch.yml` 提供，**由 bundle 机制自动叠加**：

```yaml
- insert:
    - id: lan-chat
      name: dsh-lan-chat
```

> ⚠️ 不要再往 profile 自己的 `cordis.patch.yml` 里写同样一条 —— DSH 会先叠所有
> bundle 的 patch，最后才叠 profile 的 patch，重复写会注册两次同一个条目。

### 安装要求

- DSH Desktop `0.2.1-rc.3` 或更高
- Node.js 22+（DSH 自带，通常不用管）
- **零运行时依赖** —— 全部用 Node 内置模块实现，包括手写的 WebSocket，
  所以在完全离线的机器上也能装（只要能把包拷过去）

## 配置

插件在 `cordis.patch.yml` 里支持三个可选参数：

```yaml
- insert:
    - id: lan-chat
      name: dsh-lan-chat
      config:
        port: 45871                                   # 局域网监听端口
        nickname: 我的电脑                             # 初始昵称
        dataDir: /path/to/data                        # 数据目录
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `port` | `45871` | 局域网 TCP 端口。发现用的 UDP 端口是 `port + 1` |
| `nickname` | 主机名 | 首次启动写入，之后以界面设置为准 |
| `dataDir` | `$DSH_HOME/plugin-data/dsh-lan-chat` | 消息、文件、身份、设置的存放位置 |

大部分设置直接在界面的「设置」里改，不需要编辑配置文件，包括：

| 界面设置项 | 说明 |
| --- | --- |
| 昵称 | 自己对外显示的名字，改完会自动推给在线联系人 |
| 访问码 | 留空表示不设；已设置时会显示「已设置」并提供「清除」勾选框 |
| 单文件上限 | 64MB ~ 64GB，默认 512MB；发送框右下角提示会跟着变 |
| 联系人备注 | 在「联系人」里点标签图标设置，只影响本机显示 |

文件总量配额（默认 2 GiB）通过 `/lan-chat/settings` 的 `maxTotalBytes` 调整，暂未做进界面。

---

## 工作原理

### 一台机器 = 一个节点

插件在宿主进程里起一个**独立的** HTTP + WebSocket 服务，监听 `0.0.0.0:<port>`。
之所以不复用 DSH 自己的 web server，是因为它只监听回环地址，局域网里的其他机器根本连不上。

```
浏览器界面 ──同源 HTTP──> DSH web server ──> 插件宿主半侧 ──LAN──> 其他机器
                                                  │
                                            SSE 实时推送
```

- **浏览器 ↔ 宿主**：走 DSH 自带的 web server（同源，无需 CORS，复用 DSH 的登录态）
- **宿主 ↔ 宿主**：走插件自己的监听端口，机器之间直连

### 协议

HTTP 接口（`/lan-chat/v1/...`）：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/info` | 读取节点身份（扫描用，不鉴权） |
| POST | `/hello` | 握手，校验访问码 |
| POST | `/send` | 投递一条消息 |
| POST | `/sync` | 拉取增量消息 |
| POST | `/group` | 同步群资料 |
| POST | `/group-removed` | 群主解散群时通知成员（2.2.0 新增） |
| POST | `/profile` | 同步昵称 |
| POST | `/upload` | 上传文件实体 |
| GET | `/file/:id` | 下载文件实体 |
| GET | `/ws` | WebSocket 实时通道 |

### 发现

两条腿：

1. **被动广播** — 每 30 秒往 `255.255.255.255` 和各网段广播地址发一个 UDP 包（端口 `port+1`），
   收到的人回一条带自己身份的应答。
2. **主动扫描** — 把 CIDR 展开成地址列表，48 并发地做 TCP 连接 + `GET /info`，700ms 超时。

扫描上限 1024 个地址（`/22` 及更宽），避免误填 `/8` 把界面拖死。

### 消息流

发一条消息时：

1. 先落到本地 `messages/<conv>.jsonl`（**先写本地**，保证不丢）
2. 通过已有的 WebSocket 推给对端
3. WebSocket 没连上就退回 HTTP `POST /send`
4. 无论成功失败，本地记录都在

收一条消息时：`normalizeMessage` 校验 → 幂等检查（同 id 跳过）→ 落盘 → 广播给界面和所有已连的 peer。

### 存储

```
$DSH_HOME/plugin-data/dsh-lan-chat/
├── identity.json          本机身份（peerId + secret，首次启动生成）
├── state.json             设置、联系人、群、已读位置、文件索引
├── messages/
│   ├── dm%3AlcA%7ClcB.jsonl     单聊（每个会话一个追加日志）
│   └── grp%3Ag1.jsonl           群聊
└── files/
    └── f<id>              文件实体
```

消息用 JSONL 追加写，不重写整个文件；读取时只回看尾部 8MB，避免长年累积后打开变慢。

---

## 常见问题

**对方看不到我 / 我扫不到对方**

1. 确认双方都启用了插件，且界面上「在线 · 端口 xxxxx」不是「未监听」
2. 确认在**同一网段**（`192.168.1.x` 和 `192.168.2.x` 通常不通）
3. 检查系统防火墙是否放行了该端口（macOS：系统设置 → 网络 → 防火墙）
4. 公司网络如果开了「AP 隔离 / 客户端隔离」，同一 WiFi 下的设备互相不可见 —— 这是交换机/AP 的限制，插件绕不过去

**端口被占用**

改 `cordis.patch.yml` 里的 `port`，或者关掉占用该端口的程序。
插件启动失败时界面顶部会显示红色提示，不影响其他功能。

**消息发不出去**

看会话标题下面显示的是「在线」还是「离线」。离线时消息仍会记录在本地，等对方上线后可以重发。
文件也一样：接收方点下载时如果本地没有实体，会回源到发送方拉取。

**能不能跨网段 / 跨 VLAN**

不能自动发现，但如果路由可达，可以在「发现」页手动填对方 IP 探测，然后添加。

---

## 自测

五套离线测试，不需要网络，也不需要 DSH 在跑：

```bash
node scripts/selftest.mjs    # 协议层：WS 帧、文件、群、扫描、鉴权、昵称同步、持久化（34 项）
node scripts/hosttest.mjs    # 宿主路由：全部 /lan-chat/* 接口 + 桌面端来源校验 + 端口重试 + 删群（97 项）
node scripts/clienttest.mjs  # 界面：真 React + jsdom 挂载并驱动交互（67 项）
node scripts/e2etest.mjs     # 两台机器互联：发现→添加→单聊→群聊→文件→解散群（40 项）
node scripts/sectest.mjs     # 安全回归：22 个渗透测试发现逐条验证 + 解散群越权（52 项）
```

合计 **223 项**（不含需要额外开发依赖的 `clienttest.mjs`）。

`clienttest.mjs` 需要开发依赖 react / react-dom / jsdom（不进插件包）：

```bash
pnpm add -D react react-dom jsdom
```

也可以用 `REACT_ROOT=/path/to/node_modules` 指向已经装好它们的目录。

## 安全说明

> 2026-10-25 做过一次完整渗透测试，以下描述是**修复后**的实际行为（报告见 `docs/`，不入库）。

**网络层（局域网端口，默认 45871）**

- 只有 `/lan-chat/v1/info` 和 `/hello` 匿名可读，其余 8 个接口（`/send` `/sync` `/group`
  `/group-removed` `/profile` `/upload` `/file` `/ws`）**全部要求 token**，否则 401
- token 由 `/hello` 签发：`<随机串>.<HMAC-SHA256>`，有效期 24 小时，最多同时保留 512 个
- 每个节点在 `identity.json` 里有一份 `secret` 作为身份密钥。首次握手时对端会记住它（TOFU），
  之后同一个 peerId 必须拿同一把密钥，否则 403 —— 防止别人顶替已知节点
- `/send` 会用 token 持有者的 peerId **覆盖** `from` 字段，不能伪造发送者
- 消息**不再广播**给所有连接，只投递给会话参与者
- 只向 RFC1918 私网地址发起连接；公网、`127.0.0.0/8`、`169.254.0.0/16`（云元数据服务）
  一律拒绝，避免被当作 SSRF 跳板
- 入站同理：来自公网或链路本地地址的请求直接 403，不进入任何处理逻辑
- `/info` 不再返回主机名；`/diag` 只返回目录名，不回绝对路径

**浏览器层（`/lan-chat/*`，走 DSH web）**

- 全部 21 条路由都过同源检查：Host 必须是回环地址，`Sec-Fetch-Site` 必须是
  `same-origin`/`none`/空，带 Origin 时必须与 Host 一致
- 写操作（POST/PUT/DELETE）**必须带 Origin**，堵掉无 Origin 的表单型 CSRF
- `/state` 和 `/settings` 不再回显明文访问码，只给 `hasAccessCode: true/false`

**访问码**

- 可选。设置后，对方必须在 `/hello` 里带上相同的码才能拿到 token
- 访问码只是「入场券」，真正防越权的是 token；访问码本身不会被下发到前端

**其它**

- 不加密传输：局域网内可被同网段的人抓包。**不要用它传敏感凭据**
- 默认监听 `0.0.0.0`（局域网内可用），但**入站会按来源地址过滤**：只有内网来源能访问。
  若本机有公网地址，启动时会打 warn 日志；只想本机用可以设 `bind: 'local'`，只绑 `127.0.0.1`
- 文件上传有总量配额（默认 2 GiB，可在设置里改）与 7 天回收，WebSocket 有单帧 8 MiB / 单连接 256 条 / 60 帧每秒上限

## 目录结构

```
dsh-lan-chat/
├── package.json
├── cordis.patch.yml
├── LICENSE
├── lib/
│   ├── index.js      宿主半侧：DSH 路由 + 生命周期
│   ├── node.js       网络层：HTTP API + UDP 发现 + 扫描
│   ├── ws.js         手写 RFC6455 WebSocket（不依赖第三方包）
│   ├── store.js      持久化：身份、消息日志、文件、群
│   └── client.js     界面半侧：侧边栏入口 + 聊天面板
└── scripts/
    ├── selftest.mjs
    ├── hosttest.mjs
    ├── clienttest.mjs
    ├── e2etest.mjs
    ├── sectest.mjs      安全回归（渗透测试用例转成的可提交测试）
    └── wire-profile.mjs
```

## 许可

[MIT](LICENSE)
