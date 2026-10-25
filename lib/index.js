/**
 * dsh-lan-chat · DSH 宿主半侧
 *
 * 职责：
 *   1. 在 $DSH_HOME/plugin-data/dsh-lan-chat 下建库、起局域网节点（独立端口）；
 *   2. 在 DSH web server 上注册 /lan-chat/... 路由，供本机浏览器界面调用；
 *   3. 把局域网收到的消息通过 SSE 推给浏览器（无需轮询）。
 *
 * 界面半侧见 lib/client.js。
 *
 * @module dsh-lan-chat
 */
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { Store, dmConvId, groupConvId, defaultNickname, QUOTA_MIN_BYTES, QUOTA_MAX_BYTES } from './store.js'
import { LanNode, localSubnets, localAddresses, expandCidr, probeHost, postJson, pickAddress, API_PREFIX, isPrivateAddress, safeMime } from './node.js'

/** DSH 路由前缀（浏览器侧同源，无需 CORS）。 */
const ROUTE_PREFIX = '/lan-chat'
/** 默认局域网端口。 */
const DEFAULT_PORT = 45871
/** 同时最多保留多少条 SSE 连接。 */
const MAX_SSE_CLIENTS = 32
/** SSE 连接最长存活时间（浏览器会自动重连）。 */
const SSE_IDLE_MS = 30 * 60 * 1000
/** getBinary 最多下载多少字节的兜底值（实际取设置里的单文件上限）。 */
const MAX_DOWNLOAD = 512 * 1024 * 1024

/** 把字节数变成人看得懂的大小（用于提示文案）。 */
function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 ** 3) return `${Math.round((n / 1024 ** 3) * 10) / 10}GB`
  if (n >= 1024 ** 2) return `${Math.round((n / 1024 ** 2) * 10) / 10}MB`
  if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10}KB`
  return `${n}B`
}

/** 读 DSH 数据根。 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  return join(homedir(), '.dsh')
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function readJson(request, limit = 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    let overflow = false
    request.on('data', (chunk) => {
      if (overflow) return
      bytes += chunk.length
      if (bytes > limit) {
        overflow = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (overflow) {
        resolve(null)
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null)
      } catch {
        resolve(null)
      }
    })
    request.on('error', () => resolve(null))
  })
}

function readRaw(request, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > limit) {
        chunks.length = 0
        resolve(null)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', () => resolve(null))
  })
}

/** 会话摘要：最后一条消息 + 未读数。 */
function summarize(store, convId, kind, title, extra) {
  return { convId, kind, title, ...extra }
}

/**
 * 插件主体。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{port?: number, nickname?: string, dataDir?: string}} config
 */
async function startHost(ctx, config) {
  const dir = config.dataDir ?? join(dshHome(), 'plugin-data', 'dsh-lan-chat')
  await mkdir(dir, { recursive: true })
  const store = new Store({ dir })
  await store.init()
  if (typeof config.nickname === 'string' && config.nickname !== '') store.settings.nickname = config.nickname
  if (Number.isFinite(config.port) && Number(config.port) > 0) store.settings.port = Number(config.port)
  await store.saveNow()

  const log = (level, message) => {
    try {
      if (level === 'warn') ctx.logger?.warn?.(message)
      else ctx.logger?.info?.(message)
    } catch {}
  }

  // bind 只允许 'lan'（默认，绑 0.0.0.0）或 'local'（只绑 127.0.0.1）。
  const bind = config.bind === 'local' ? 'local' : 'lan'
  const node = new LanNode({ store, port: store.settings.port || DEFAULT_PORT, log, bind, allowLoopback: config.allowLoopback === true })

  /** 浏览器侧的 SSE 订阅者。 */
  const sseClients = new Set()

  const pushEvent = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const response of sseClients) {
      try {
        response.write(payload)
      } catch {
        sseClients.delete(response)
      }
    }
  }

  node.on('message', (message) => {
    pushEvent('message', message)
  })
  node.on('presence', (presence) => {
    pushEvent('presence', presence)
  })
  node.on('discovered', (peer) => {
    pushEvent('discovered', peer)
  })

  let actualPort = 0
  let startError = null
  try {
    actualPort = await node.start()
  } catch (error) {
    startError = error instanceof Error ? error.message : String(error)
    log('warn', `lan-chat: 局域网监听失败（${startError}）；界面仍可使用，但无法与外部通信`)
  }

  /**
   * 重新尝试监听局域网端口。
   *
   * 为什么需要它：端口被占用经常只是**暂时的**——上一次 DSH 退出时监听 socket
   * 还没释放（旧宿主进程残留、TIME_WAIT、或用户手动重启过快），这时固定报
   * 「listen EADDRINUSE」会让本插件在本次运行里永久处于「只能看本机数据」的
   * 状态，只能靠重启 DSH 才好。所以绑定失败后自动退避重试，并允许界面手动触发。
   * @returns {Promise<{ok: boolean, port?: number, error?: string}>}
   */
  let retryTimer = null
  let retryDelay = 2000
  const MAX_RETRY_DELAY = 60 * 1000

  const tryListen = async () => {
    if (actualPort > 0) return { ok: true, port: actualPort }
    try {
      actualPort = await node.start()
      startError = null
      retryDelay = 2000
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      pushEvent('listening', { listening: true, port: actualPort })
      return { ok: true, port: actualPort }
    } catch (error) {
      startError = error instanceof Error ? error.message : String(error)
      pushEvent('listening', { listening: false, error: startError })
      return { ok: false, error: startError }
    }
  }

  const scheduleRetry = () => {
    if (actualPort > 0 || retryTimer !== null) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      tryListen().then((result) => {
        if (!result.ok) {
          retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY)
          scheduleRetry()
        }
      }).catch(() => {})
    }, retryDelay)
    retryTimer.unref?.()
  }
  if (actualPort === 0) scheduleRetry()

  // 上传文件回收：以前 removeFile 从来没被调用过，files/ 会无限增长。
  // 启动后先扫一次，之后每小时一次。
  const gcTimer = setInterval(() => {
    store.collectFiles().catch(() => {})
  }, 60 * 60 * 1000)
  gcTimer.unref?.()
  store.collectFiles().catch(() => {})

  if (node.bindAddress === '0.0.0.0') {
    const publics = localAddresses().filter((address) => !isPrivateAddress(address))
    if (publics.length > 0) {
      log('warn', `lan-chat: 正在 0.0.0.0 上监听，且本机存在公网地址（${publics.join('、')}）；`
        + '这些地址上的任何人都能连进来。建议只在内网使用，或把配置里的 bind 设为 local。')
    }
  }

  // ------------------------------------------------------------ 路由

  const disposers = []

  /** 注册一个 JSON 路由。handler 返回 {status, body} 或直接写响应。 */
  const route = (path, handler) => {
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}${path}`,
        handler: async (request, response) => {
          try {
            // 所有浏览器侧路由统一过一遍来源校验：读接口同样能泄露聊天内容，
            // 不能只保护写接口。
            if (!isTrusted(request)) {
              sendJson(response, 403, { ok: false, error: '已拒绝非同源请求' })
              return
            }
            await handler(request, response)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            log('warn', `lan-chat route ${path}: ${message}`)
            if (!response.headersSent) sendJson(response, 500, { ok: false, error: message })
            else response.destroy()
          }
        },
      }),
    )
  }

  /**
   * 浏览器侧请求的信任校验（替代原来只看 Origin 的弱校验）。
   *
   * 三层：
   *   1. Host 必须是本机回环名/地址 —— 挡 DNS rebinding（攻击者域名解析到
   *      127.0.0.1 时，浏览器发的 Host 仍是攻击者域名）。
   *   2. Sec-Fetch-Site 若存在，必须是 same-origin / none —— 挡跨站发起。
   *   3. Origin 若存在，必须与 Host 同源；**写操作不允许缺 Origin** ——
   *      浏览器对 POST 一定会带 Origin，缺了就说明不是同源页面发起的。
   */
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

  /** 取出 Host 里的主机名（去掉端口与 IPv6 方括号）。 */
  const hostName = (request) => {
    const raw = String(request.headers.host ?? '').trim().toLowerCase()
    if (raw === '') return ''
    if (raw.startsWith('[')) {
      const end = raw.indexOf(']')
      return end === -1 ? raw : raw.slice(0, end + 1)
    }
    const colon = raw.lastIndexOf(':')
    return colon === -1 ? raw : raw.slice(0, colon)
  }

  const isWriteMethod = (method) => method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'

  /**
   * DSH Desktop 渲染进程的来源标识。
   *
   * 桌面端不是从 http://127.0.0.1:<port> 加载页面的，而是走自定义协议
   * dsh-app://app，所有请求都由 Electron 主进程的 forwardWebRequest() 转发：
   * 它会把 host / origin / cookie / sec-fetch-site 四个头**主动删掉**，
   * 再用 Node 的 fetch 重发。而 Node fetch 不会补 Origin（实测确认），
   * 于是这些写请求到达这里时「没有 Origin」，撞上 F-09「写操作必须有 Origin」
   * 的规则，全部 403 —— 这就是桌面端「已拒绝非同源请求」的根因。
   */
  const DESKTOP_ORIGIN = 'dsh-app://app'

  /**
   * 桌面端请求标识头（见上面 DESKTOP_ORIGIN 的说明）。
   *
   * 不能简单地把「没有 Origin 的写操作」放行 —— 那正是 F-09 要挡的 CSRF 形态。
   * 所以改成额外要求一个自定义头：跨站页面要带这个头必须先过 CORS 预检，
   * 而本插件从不回 CORS 响应头、预检本身也会被 isTrusted 拒掉，浏览器因此
   * 根本发不出去；跨站表单则无法自定义请求头。桌面端之所以能带，是因为
   * 主进程转发的是同源页面自己发出的请求。
   */
  const CLIENT_HEADER = 'x-lan-chat-client'
  /** 认得的桌面端取值。 */
  const CLIENT_DESKTOP = 'desktop'

  const isTrusted = (request) => {
    const host = hostName(request)
    // Host 白名单：只接受本机回环名。DSH web 本身也只监听 127.0.0.1。
    // 这一层同时挡住 DNS rebinding（攻击者域名解析到 127.0.0.1 时 Host 仍是攻击者域名）。
    if (host === '' || !LOOPBACK_HOSTS.has(host)) return false

    const site = String(request.headers['sec-fetch-site'] ?? '').toLowerCase()
    if (site !== '' && site !== 'same-origin' && site !== 'none') return false

    const origin = request.headers.origin
    if (typeof origin === 'string' && origin !== '') {
      // 桌面端外壳直接发起的请求（正常情况下上面那层转发会把它剥掉，这里兜底）。
      if (origin === DESKTOP_ORIGIN) return true
      try {
        const parsed = new URL(origin)
        if (parsed.host !== String(request.headers.host ?? '')) return false
        return true
      } catch {
        return false
      }
    }
    // 没有 Origin：读操作放行（同源导航、EventSource、静态取图都不带 Origin）。
    // 写操作只认带了桌面端标识头的请求，其余一律拒绝。
    if (!isWriteMethod(request.method)) return true
    return String(request.headers[CLIENT_HEADER] ?? '') === CLIENT_DESKTOP
  }

  /**
   * 包装：要求可信来源。
   * 注：route() 已经统一做过一次校验，这里是给写操作额外标注的纵深防御。
   */
  const guarded = (handler) => async (request, response) => {
    if (!isTrusted(request)) {
      sendJson(response, 403, { ok: false, error: '已拒绝非同源请求' })
      return
    }
    await handler(request, response)
  }

  // --- 状态 / 设置 ---
  route('/state', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(response, 200, {
      ok: true,
      self: {
        peerId: store.peerId,
        nickname: store.settings.nickname,
        host: hostname(),
        port: actualPort || store.settings.port,
        addresses: localAddresses(),
        subnets: localSubnets(),
      },
      // 访问码本身绝不外发（以前这里把明文 accessCode 直接给了前端）。
      // 前端只需要知道「有没有设」，判断要不要显示已配置状态。
      settings: {
        nickname: store.settings.nickname,
        autoAccept: store.settings.autoAccept,
        autoDiscover: store.settings.autoDiscover,
        notifyDesktop: store.settings.notifyDesktop,
        port: store.settings.port,
        hasAccessCode: String(store.settings.accessCode ?? '') !== '',
        // 文件上限：生效值 + 可填范围，界面据此渲染输入框与提示。
        maxFileBytes: store.maxFileBytes,
        maxTotalBytes: store.maxTotalBytes,
        quotaMinBytes: QUOTA_MIN_BYTES,
        quotaMaxBytes: QUOTA_MAX_BYTES,
        fileUsage: store.fileUsage(),
      },
      listening: actualPort > 0,
      startError,
      // 自动重试状态：界面据此显示「正在自动重试」而不是干等到用户重启。
      retry: actualPort > 0 ? null : { pending: retryTimer !== null, delayMs: retryDelay },
    })
  })

  /**
   * 手动重新尝试监听（界面上的「重试」按钮）。
   * 自动重试存在指数退避，用户刚关掉占端口的程序时不想等下一次退避，可以点这个。
   */
  route('/listen/retry', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (actualPort > 0) {
      sendJson(response, 200, { ok: true, port: actualPort, alreadyListening: true })
      return
    }
    const result = await tryListen()
    if (!result.ok) {
      scheduleRetry()
      sendJson(response, 200, { ok: true, listening: false, port: 0, startError: result.error })
      return
    }
    sendJson(response, 200, { ok: true, listening: true, port: result.port })
  }))

  route('/settings', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null) {
      sendJson(response, 400, { ok: false, error: 'bad body' })
      return
    }
    const patch = {}
    if (typeof body.nickname === 'string') patch.nickname = body.nickname.trim().slice(0, 64) || defaultNickname()
    if (typeof body.accessCode === 'string') patch.accessCode = body.accessCode.slice(0, 128)
    if (typeof body.autoAccept === 'boolean') patch.autoAccept = body.autoAccept
    if (typeof body.autoDiscover === 'boolean') patch.autoDiscover = body.autoDiscover
    // 文件上限：接受字节数，但夹在允许范围内，避免填 0 或离谱数字。
    for (const key of ['maxFileBytes', 'maxTotalBytes']) {
      if (body[key] === undefined) continue
      const value = Number(body[key])
      if (!Number.isFinite(value) || value <= 0) {
        sendJson(response, 400, { ok: false, error: '文件上限必须是正整数（字节）' })
        return
      }
      patch[key] = Math.min(Math.max(Math.round(value), QUOTA_MIN_BYTES), QUOTA_MAX_BYTES)
    }
    Object.assign(store.settings, patch)
    await store.saveNow()
    if (patch.nickname !== undefined) await broadcastProfile(store, node)
    // 响应里同样不回显访问码，只回「有没有设」。
    sendJson(response, 200, {
      ok: true,
      settings: {
        nickname: store.settings.nickname,
        autoAccept: store.settings.autoAccept,
        autoDiscover: store.settings.autoDiscover,
        notifyDesktop: store.settings.notifyDesktop,
        port: store.settings.port,
        hasAccessCode: String(store.settings.accessCode ?? '') !== '',
        maxFileBytes: store.maxFileBytes,
        maxTotalBytes: store.maxTotalBytes,
        quotaMinBytes: QUOTA_MIN_BYTES,
        quotaMaxBytes: QUOTA_MAX_BYTES,
        fileUsage: store.fileUsage(),
      },
    })
  }))

  // --- 联系人 ---
  route('/contacts', async (request, response) => {
    if (request.method === 'GET') {
      const contacts = store.contacts().map((contact) => ({
        peerId: contact.peerId,
        nickname: contact.nickname,
        // alias 是本机给对方起的外号，只影响本地显示。
        alias: contact.alias ?? '',
        host: contact.host,
        addrs: contact.addrs ?? [],
        port: contact.port ?? 0,
        online: node.sockets.has(contact.peerId),
        added: contact.added === true,
        addedAt: contact.addedAt ?? 0,
        lastSeen: contact.lastSeen ?? 0,
      }))
      contacts.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1
        return (b.lastSeen ?? 0) - (a.lastSeen ?? 0)
      })
      sendJson(response, 200, { ok: true, contacts })
      return
    }
    sendJson(response, 405, { ok: false, error: 'method not allowed' })
  })

  route('/contacts/add', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.peerId !== 'string') {
      sendJson(response, 400, { ok: false, error: 'peerId required' })
      return
    }
    const peerId = body.peerId
    if (peerId === store.peerId) {
      sendJson(response, 400, { ok: false, error: '不能添加自己' })
      return
    }
    const known = store.getContact(peerId)
    let nickname = String(body.nickname ?? known?.nickname ?? peerId)
    let port = Number(body.port) || known?.port || 0
    let addrs = Array.isArray(body.addrs) ? body.addrs.map(String) : [...(known?.addrs ?? [])]
    // 没给地址时，从发现缓存/现网探测补一个
    if (addrs.length === 0) {
      const discovered = node.discovered.get(peerId)
      if (discovered !== undefined) {
        addrs = [discovered.address]
        port = port || discovered.port
        nickname = discovered.nickname || nickname
      }
    }
    const contact = store.upsertContact({
      peerId,
      nickname,
      host: String(body.host ?? known?.host ?? ''),
      addrs,
      port,
      added: true,
      addedAt: known?.addedAt || Date.now(),
      lastSeen: Date.now(),
    })
    await store.saveNow()
    sendJson(response, 200, { ok: true, contact })
  }))

  route('/contacts/remove', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.peerId !== 'string') {
      sendJson(response, 400, { ok: false, error: 'peerId required' })
      return
    }
    const removed = store.removeContact(body.peerId)
    await store.saveNow()
    sendJson(response, 200, { ok: true, removed })
  }))

  // 给联系人设置本地备注名（只改本机显示，不会推给对方）。
  route('/contacts/alias', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.peerId !== 'string') {
      sendJson(response, 400, { ok: false, error: 'peerId required' })
      return
    }
    const contact = store.setAlias(body.peerId, body.alias)
    if (contact === null) {
      sendJson(response, 404, { ok: false, error: '联系人不存在' })
      return
    }
    await store.saveNow()
    sendJson(response, 200, {
      ok: true,
      contact: { peerId: contact.peerId, nickname: contact.nickname, alias: contact.alias ?? '' },
    })
  }))

  // --- 会话列表 ---
  route('/conversations', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const items = []
    // 单聊：只显示“已添加”的联系人，避免扫描时列表炸掉
    for (const contact of store.contacts()) {
      if (contact.added !== true) continue
      const convId = dmConvId(store.peerId, contact.peerId)
      const messages = await store.listMessages(convId, { limit: 1 })
      const last = messages[messages.length - 1]
      items.push(summarize(store, convId, 'dm', contact.alias || contact.nickname || contact.peerId, {
        peerId: contact.peerId,
        online: node.sockets.has(contact.peerId),
        lastText: previewText(last),
        lastTs: last?.ts ?? 0,
        unread: await countUnread(store, convId),
      }))
    }
    for (const group of store.myGroups()) {
      const convId = groupConvId(group.id)
      const messages = await store.listMessages(convId, { limit: 1 })
      const last = messages[messages.length - 1]
      items.push(summarize(store, convId, 'group', group.name, {
        groupId: group.id,
        members: group.members,
        lastText: previewText(last),
        lastTs: last?.ts ?? 0,
        unread: await countUnread(store, convId),
      }))
    }
    items.sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0))
    sendJson(response, 200, { ok: true, conversations: items })
  })

  // --- 消息 ---
  route('/messages', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const convId = String(url.searchParams.get('convId') ?? '')
    if (convId === '') {
      sendJson(response, 400, { ok: false, error: 'convId required' })
      return
    }
    const sinceRaw = url.searchParams.get('since')
    const beforeRaw = url.searchParams.get('before')
    const limitRaw = url.searchParams.get('limit')
    const messages = await store.listMessages(convId, {
      since: sinceRaw === null ? undefined : Number(sinceRaw),
      before: beforeRaw === null ? undefined : Number(beforeRaw),
      limit: limitRaw === null ? 200 : Number(limitRaw),
    })
    sendJson(response, 200, { ok: true, messages })
  })

  route('/read', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.convId !== 'string') {
      sendJson(response, 400, { ok: false, error: 'convId required' })
      return
    }
    store.markRead(body.convId, Number(body.ts) || Date.now())
    sendJson(response, 200, { ok: true })
  }))

  // 删除单条消息 / 清空会话。只删本机日志，对端不受影响。
  route('/messages/delete', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.convId !== 'string' || body.convId === '') {
      sendJson(response, 400, { ok: false, error: 'convId required' })
      return
    }
    if (body.all === true) {
      const removed = await store.clearConversation(body.convId)
      await store.saveNow()
      sendJson(response, 200, { ok: true, removed })
      return
    }
    if (typeof body.messageId !== 'string' || body.messageId === '') {
      sendJson(response, 400, { ok: false, error: 'messageId required' })
      return
    }
    // 只有会话里的消息才能删，避免用任意 id 去碰别的会话。
    const rows = await store.listMessages(body.convId, { limit: 1000 })
    if (!rows.some((row) => row.id === body.messageId)) {
      sendJson(response, 404, { ok: false, error: '消息不存在' })
      return
    }
    const removed = await store.deleteMessage(body.convId, body.messageId)
    await store.saveNow()
    sendJson(response, 200, { ok: true, removed })
  }))

  route('/send', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.convId !== 'string' || typeof body.text !== 'string') {
      sendJson(response, 400, { ok: false, error: 'convId 与 text 必填' })
      return
    }
    const text = body.text.trim()
    if (text === '') {
      sendJson(response, 400, { ok: false, error: '消息不能为空' })
      return
    }
    const result = await sendTextMessage({ store, node, convId: body.convId, text })
    if (!result.ok) {
      sendJson(response, result.status ?? 400, { ok: false, error: result.error })
      return
    }
    sendJson(response, 200, { ok: true, message: result.message, delivered: result.delivered })
  }))

  // --- 文件 ---
  route('/upload', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const convId = String(url.searchParams.get('convId') ?? '')
    const name = String(url.searchParams.get('name') ?? 'file')
    const mime = String(url.searchParams.get('mime') ?? 'application/octet-stream')
    if (convId === '') {
      sendJson(response, 400, { ok: false, error: 'convId required' })
      return
    }
    const limit = store.maxFileBytes
    const buffer = await readRaw(request, limit)
    if (buffer === null) {
      sendJson(response, 413, { ok: false, error: `文件过大（上限 ${formatBytes(limit)}）` })
      return
    }
    const result = await sendFileMessage({ store, node, convId, name, mime, buffer })
    if (!result.ok) {
      sendJson(response, result.status ?? 400, { ok: false, error: result.error })
      return
    }
    sendJson(response, 200, { ok: true, message: result.message, delivered: result.delivered })
  }))

  route('/file', async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const id = String(url.searchParams.get('id') ?? '')
    const meta = store.fileMeta(id)
    if (meta === undefined) {
      sendJson(response, 404, { ok: false, error: '文件不存在' })
      return
    }
    // 本地没有实体时，去发送方那台机器取（流式转发）
    if (meta.stored !== true) {
      const fetched = await fetchRemoteFile(store, node, meta)
      if (!fetched) {
        sendJson(response, 404, { ok: false, error: '本地无该文件，且无法从对端获取' })
        return
      }
    }
    const { createReadStream, statSync } = await import('node:fs')
    const path = store.filePath(id)
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      sendJson(response, 404, { ok: false, error: '文件已丢失' })
      return
    }
    response.writeHead(200, {
      'content-type': safeMime(meta.mime),
      'content-length': size,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(path).pipe(response)
  })

  // --- 群 ---
  route('/groups', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const groups = store.myGroups().map((group) => ({
      ...group,
      online: group.members.filter((member) => node.sockets.has(member)).length,
    }))
    sendJson(response, 200, { ok: true, groups })
  })

  route('/groups/create', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.name !== 'string') {
      sendJson(response, 400, { ok: false, error: '群名称必填' })
      return
    }
    const members = Array.isArray(body.members) ? body.members.map(String) : []
    const group = store.createGroup({
      name: body.name.trim().slice(0, 64) || '未命名群聊',
      members: [...new Set([store.peerId, ...members])],
      createdBy: store.peerId,
    })
    const convId = groupConvId(group.id)
    await store.appendMessage({
      id: `m${randomBytes(8).toString('hex')}`,
      convId,
      from: store.peerId,
      fromName: store.settings.nickname,
      kind: 'system',
      text: `${store.settings.nickname} 创建了群聊「${group.name}」`,
      ts: Date.now(),
      self: true,
    })
    await store.saveNow()
    // 通知其他成员
    await broadcastGroup(store, node, group)
    sendJson(response, 200, { ok: true, group, convId })
  }))

  route('/groups/update', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.groupId !== 'string') {
      sendJson(response, 400, { ok: false, error: 'groupId required' })
      return
    }
    const patch = {}
    if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 64) || '未命名群聊'
    if (Array.isArray(body.members)) patch.members = [...new Set([store.peerId, ...body.members.map(String)])]
    const group = store.updateGroup(body.groupId, patch)
    if (group === null) {
      sendJson(response, 404, { ok: false, error: '群不存在' })
      return
    }
    await store.saveNow()
    await broadcastGroup(store, node, group)
    sendJson(response, 200, { ok: true, group })
  }))

  route('/groups/leave', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.groupId !== 'string') {
      sendJson(response, 400, { ok: false, error: 'groupId required' })
      return
    }
    const group = store.state.groups[body.groupId]
    if (group === undefined) {
      sendJson(response, 404, { ok: false, error: '群不存在' })
      return
    }
    const members = group.members.filter((member) => member !== store.peerId)
    if (members.length === 0) store.removeGroup(body.groupId)
    else store.updateGroup(body.groupId, { members })
    await store.saveNow()
    sendJson(response, 200, { ok: true })
  }))

  // --- 发现 / 扫描 ---
  route('/discover', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const peers = [...node.discovered.values()].map((peer) => ({
      ...peer,
      added: store.getContact(peer.peerId)?.added === true,
    }))
    sendJson(response, 200, { ok: true, peers, subnets: localSubnets(), addresses: localAddresses() })
  })

  route('/scan', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null) {
      sendJson(response, 400, { ok: false, error: 'bad body' })
      return
    }
    let addresses = []
    if (Array.isArray(body.addresses) && body.addresses.length > 0) addresses = body.addresses.map(String)
    else if (typeof body.cidr === 'string' && body.cidr.trim() !== '') addresses = expandCidr(body.cidr.trim())
    else addresses = localSubnets().flatMap((cidr) => expandCidr(cidr))
    if (addresses.length === 0) {
      sendJson(response, 400, { ok: false, error: '没有可扫描的地址：请填写形如 192.168.1.0/24 的网段' })
      return
    }
    const scan = node.scan({ addresses, port: Number(body.port) || actualPort || store.settings.port })
    sendJson(response, 200, { ok: true, ...scan })
  }))

  route('/scan/status', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const scanId = String(url.searchParams.get('scanId') ?? '')
    const status = node.scanStatus(scanId)
    if (status === null) {
      sendJson(response, 404, { ok: false, error: '扫描已结束' })
      return
    }
    sendJson(response, 200, {
      ok: true,
      ...status,
      peers: status.peers.map((peer) => ({ ...peer, added: store.getContact(peer.peerId)?.added === true })),
    })
  })

  route('/probe', guarded(async (request, response) => {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJson(request)
    if (body === null || typeof body.address !== 'string') {
      sendJson(response, 400, { ok: false, error: 'address required' })
      return
    }
    // 只允许探测私网地址：以前这里能拿来做任意地址/端口的 SSRF 探测。
    if (!isPrivateAddress(body.address)) {
      sendJson(response, 403, { ok: false, error: '只允许探测局域网地址' })
      return
    }
    const port = Number(body.port) || actualPort || store.settings.port
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      sendJson(response, 400, { ok: false, error: 'bad port' })
      return
    }
    const found = await probeHost(body.address, port, 1500)
    if (found === null) {
      sendJson(response, 404, { ok: false, error: `${body.address} 上没有发现局域网聊天助手` })
      return
    }
    node._noteDiscovered(found)
    sendJson(response, 200, { ok: true, peer: found })
  }))

  // --- 实时推送（SSE） ---
  route('/events', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    // 容量上限：以前可以无限开 SSE 连接，把进程的文件描述符和内存吃光。
    if (sseClients.size >= MAX_SSE_CLIENTS) {
      sendJson(response, 503, { ok: false, error: 'too many event streams' })
      return
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.write(`retry: 2000\n\n`)
    response.write(`event: hello\ndata: ${JSON.stringify({ peerId: store.peerId, nickname: store.settings.nickname })}\n\n`)
    sseClients.add(response)
    const heartbeat = setInterval(() => {
      try {
        response.write(': ping\n\n')
      } catch {
        clearInterval(heartbeat)
        sseClients.delete(response)
      }
    }, 20000)
    heartbeat.unref?.()
    // 空闲超时：连上却不读的连接不会永远占着位置。
    const idleTimer = setTimeout(() => {
      try {
        response.end()
      } catch {}
      cleanup()
    }, SSE_IDLE_MS)
    idleTimer.unref?.()
    const cleanup = () => {
      clearInterval(heartbeat)
      clearTimeout(idleTimer)
      sseClients.delete(response)
    }
    request.on('close', cleanup)
    request.on('error', cleanup)
    response.on('close', cleanup)
  })

  // --- 诊断 ---
  route('/diag', guarded(async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(response, 200, {
      ok: true,
      // 不再回 dataDir（绝对路径属于内部信息），只回目录名。
      dataDirName: String(dir).split(/[\\/]/u).pop() ?? '',
      peerId: store.peerId,
      listening: actualPort > 0,
      port: actualPort,
      startError,
      addresses: localAddresses(),
      subnets: localSubnets(),
      contacts: store.contacts().length,
      groups: store.myGroups().length,
      sockets: [...node.sockets.keys()],
      discovered: [...node.discovered.values()],
    })
  }))

  return {
    store,
    node,
    // 用 getter：自动重试成功后端口会变，直接给值会一直停在 0。
    get port() {
      return actualPort
    },
    get startError() {
      return startError
    },
    /** 手动重试监听，测试与界面共用。 */
    retryListen: tryListen,
    dispose: async () => {
      clearInterval(gcTimer)
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {}
      }
      for (const response of sseClients) {
        try {
          response.end()
        } catch {}
      }
      sseClients.clear()
      await node.close()
      await store.close()
    },
  }
}

/** 最后一条消息在列表里的预览文本。 */
function previewText(message) {
  if (message === undefined) return ''
  if (message.kind === 'file') return `[文件] ${message.file?.name ?? ''}`
  return String(message.text ?? '').slice(0, 120)
}

/** 未读数 = 别人发的、ts 大于已读位置的消息数。 */
async function countUnread(store, convId) {
  const marker = store.readMarker(convId)
  const messages = await store.listMessages(convId, { since: marker, limit: 1000 })
  return messages.filter((message) => message.from !== store.peerId).length
}

/**
 * 发文本消息到会话：先落本地，再推给对端。
 * @returns {{ok: boolean, message?: object, delivered?: number, error?: string, status?: number}}
 */
async function sendTextMessage({ store, node, convId, text }) {
  const targets = resolveTargets(store, convId)
  if (targets === null) return { ok: false, status: 400, error: '会话不存在' }
  const message = {
    id: `m${randomBytes(8).toString('hex')}`,
    convId,
    from: store.peerId,
    fromName: store.settings.nickname,
    kind: 'text',
    text,
    ts: Date.now(),
    self: true,
  }
  await node.ingest(message)
  const delivered = await fanout(store, node, targets, message)
  return { ok: true, message, delivered }
}

/** 发文件消息。 */
async function sendFileMessage({ store, node, convId, name, mime, buffer }) {
  const targets = resolveTargets(store, convId)
  if (targets === null) return { ok: false, status: 400, error: '会话不存在' }
  const fileId = `f${randomBytes(10).toString('hex')}`
  const meta = await store.putFileBuffer({
    id: fileId,
    name,
    mime,
    buffer,
    from: store.peerId,
    ts: Date.now(),
  })
  const message = {
    id: `m${randomBytes(8).toString('hex')}`,
    convId,
    from: store.peerId,
    fromName: store.settings.nickname,
    kind: 'file',
    text: name,
    ts: Date.now(),
    self: true,
    file: { id: fileId, name, size: meta.size, mime, sha256: meta.sha256, stored: true },
  }
  await node.ingest(message)
  const delivered = await fanout(store, node, targets, message, { buffer })
  return { ok: true, message, delivered }
}

/**
 * 会话 → 收件人 peerId 列表。
 * @returns {string[] | null} null 表示会话不存在
 */
function resolveTargets(store, convId) {
  if (convId.startsWith('dm:')) {
    const [a, b] = convId.slice(3).split('|')
    if (a === undefined || b === undefined) return null
    const other = a === store.peerId ? b : a
    return store.getContact(other) === undefined ? null : [other]
  }
  if (convId.startsWith('grp:')) {
    const groupId = convId.slice(4)
    const group = store.state.groups[groupId]
    if (group === undefined) return null
    return group.members.filter((member) => member !== store.peerId)
  }
  return null
}

/** 把一条消息投给所有目标，返回成功数。 */
async function fanout(store, node, targets, message, extra) {
  let delivered = 0
  for (const peerId of targets) {
    const pushed = node.pushTo(peerId, { type: 'message', message })
    if (pushed) {
      delivered += 1
      continue
    }
    const contact = store.getContact(peerId)
    const address = pickAddress(contact)
    if (address === null) continue
    // 只往「可投递」地址发：排除公网、回环、链路本地（云元数据）。
    if (!node.dialable(address)) continue
    const port = Number(contact?.port) || node.port
    const base = `http://${address}:${port}${API_PREFIX}`
    try {
      const token = await node._tokenFor(contact)
      if (token === null) continue
      if (extra?.buffer !== undefined && message.kind === 'file') {
        const file = message.file
        const query = `id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.mime)}&from=${encodeURIComponent(message.from)}`
        const uploaded = await postBinary(`${base}/upload?${query}`, extra.buffer, 30000, token)
        if (!uploaded?.ok) continue
      }
      const result = await postJson(`${base}/send`, { message }, 8000, token)
      if (result?.ok) delivered += 1
    } catch {}
  }
  return delivered
}

/** POST 二进制。 */
function postBinary(url, buffer, timeoutMs = 30000, token = '') {
  return new Promise((resolve) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      resolve(null)
      return
    }
    const headers = { 'content-type': 'application/octet-stream', 'content-length': buffer.length }
    if (typeof token === 'string' && token !== '') headers.authorization = `Bearer ${token}`
    const req = httpRequest(
      {
        host: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end(buffer)
  })
}

/** 把最新昵称推给所有联系人（WS 优先，HTTP 兜底）。 */
async function broadcastProfile(store, node) {
  const payload = { type: 'profile', peerId: store.peerId, nickname: store.settings.nickname }
  for (const contact of store.contacts()) {
    if (contact.peerId === store.peerId) continue
    if (node.pushTo(contact.peerId, payload)) continue
    const address = pickAddress(contact)
    if (address === null) continue
    if (!node.dialable(address)) continue
    const port = Number(contact.port) || node.port
    try {
      const token = await node._tokenFor(contact)
      if (token === null) continue
      await postJson(`http://${address}:${port}${API_PREFIX}/profile`, {
        peerId: store.peerId,
        nickname: store.settings.nickname,
      }, 4000, token)
    } catch {}
  }
}

/** 群资料同步给所有成员。 */
async function broadcastGroup(store, node, group) {
  for (const member of group.members) {
    if (member === store.peerId) continue
    if (node.pushTo(member, { type: 'group', group })) continue
    const contact = store.getContact(member)
    const address = pickAddress(contact)
    if (address === null) continue
    if (!node.dialable(address)) continue
    const port = Number(contact?.port) || node.port
    try {
      const token = await node._tokenFor(contact)
      if (token === null) continue
      await postJson(`http://${address}:${port}${API_PREFIX}/group`, { group }, 6000, token)
    } catch {}
  }
}

/** 从发送方拉取文件实体并落盘。 */
async function fetchRemoteFile(store, node, meta) {
  const contact = store.getContact(meta.from)
  if (contact === undefined) return false
  const address = pickAddress(contact)
  if (address === null) return false
  if (!node.dialable(address)) return false
  const port = Number(contact?.port) || 45871
  const token = await node._tokenFor(contact)
  if (token === null) return false
  const url = `http://${address}:${port}${API_PREFIX}/file/${encodeURIComponent(meta.id)}?token=${encodeURIComponent(token)}`
  const buffer = await getBinary(url, 60000, store.maxFileBytes)
  if (buffer === null) return false
  await store.putFileBuffer({ id: meta.id, name: meta.name, mime: meta.mime, buffer, from: meta.from, ts: meta.ts })
  return true
}

/** GET 二进制。 */
function getBinary(url, timeoutMs = 30000, maxBytes = MAX_DOWNLOAD) {
  return new Promise((resolve) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      resolve(null)
      return
    }
    const req = httpRequest(
      { host: parsed.hostname, port: parsed.port, path: `${parsed.pathname}${parsed.search}`, method: 'GET', timeout: timeoutMs },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          resolve(null)
          return
        }
        const chunks = []
        let total = 0
        let done = false
        response.on('data', (chunk) => {
          if (done) return
          total += chunk.length
          // 没有上限时对端可以一直喂数据，直接把进程内存吃满。
          if (total > maxBytes) {
            done = true
            chunks.length = 0
            response.destroy()
            resolve(null)
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (!done) resolve(Buffer.concat(chunks))
        })
        response.on('error', () => resolve(null))
      },
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

/** Cordis 插件入口。 */
export const inject = ['webServer']

export function apply(ctx, config) {
  const resolved = config ?? {}
  let handle = null
  let starting = null

  const boot = () => {
    if (starting !== null) return starting
    starting = startHost(ctx, resolved)
      .then((value) => {
        handle = value
        return value
      })
      .catch((error) => {
        try {
          ctx.logger?.warn?.(`lan-chat: 启动失败 ${error instanceof Error ? error.message : String(error)}`)
        } catch {}
        return null
      })
    return starting
  }

  // 启动时机：webServer 就绪后立刻起，不等第一次请求
  boot()

  ctx.on('dispose', () => {
    const current = handle
    handle = null
    if (current !== null) current.dispose().catch(() => {})
  })
}

export { startHost }
