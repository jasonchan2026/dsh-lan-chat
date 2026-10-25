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
import { Store, dmConvId, groupConvId, defaultNickname } from './store.js'
import { LanNode, localSubnets, localAddresses, expandCidr, probeHost, postJson, pickAddress, API_PREFIX } from './node.js'

/** DSH 路由前缀（浏览器侧同源，无需 CORS）。 */
const ROUTE_PREFIX = '/lan-chat'
/** 默认局域网端口。 */
const DEFAULT_PORT = 45871

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

  const node = new LanNode({ store, port: store.settings.port || DEFAULT_PORT, log })

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

  /** 只接受同源请求（防 DNS rebinding / 跨站写入）。 */
  const isTrusted = (request) => {
    const origin = request.headers.origin
    if (typeof origin !== 'string' || origin === '') return true // 同源导航/非浏览器客户端
    try {
      const parsed = new URL(origin)
      const host = request.headers.host ?? ''
      return parsed.host === host
    } catch {
      return false
    }
  }

  /** 包装：要求可信来源。 */
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
      settings: { ...store.settings },
      listening: actualPort > 0,
      startError,
    })
  })

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
    Object.assign(store.settings, patch)
    await store.saveNow()
    await broadcastProfile(store, node)
    sendJson(response, 200, { ok: true, settings: { ...store.settings } })
  }))

  // --- 联系人 ---
  route('/contacts', async (request, response) => {
    if (request.method === 'GET') {
      const contacts = store.contacts().map((contact) => ({
        peerId: contact.peerId,
        nickname: contact.nickname,
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
      items.push(summarize(store, convId, 'dm', contact.nickname || contact.peerId, {
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
    const buffer = await readRaw(request, 512 * 1024 * 1024)
    if (buffer === null) {
      sendJson(response, 413, { ok: false, error: '文件过大（上限 512MB）' })
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
      const fetched = await fetchRemoteFile(store, meta)
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
      'content-type': meta.mime || 'application/octet-stream',
      'content-length': size,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      'cache-control': 'no-store',
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
    const found = await probeHost(body.address, Number(body.port) || actualPort || store.settings.port, 1500)
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
    const cleanup = () => {
      clearInterval(heartbeat)
      sseClients.delete(response)
    }
    request.on('close', cleanup)
    request.on('error', cleanup)
    response.on('close', cleanup)
  })

  // --- 诊断 ---
  route('/diag', async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(response, 200, {
      ok: true,
      dataDir: dir,
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
  })

  return {
    store,
    node,
    port: actualPort,
    dispose: async () => {
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
    const port = Number(contact?.port) || node.port
    const base = `http://${address}:${port}${API_PREFIX}`
    try {
      if (extra?.buffer !== undefined && message.kind === 'file') {
        const file = message.file
        const query = `id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.mime)}&from=${encodeURIComponent(message.from)}`
        const uploaded = await postBinary(`${base}/upload?${query}`, extra.buffer, 30000)
        if (!uploaded?.ok) continue
      }
      const result = await postJson(`${base}/send`, { message }, 8000)
      if (result?.ok) delivered += 1
    } catch {}
  }
  return delivered
}

/** POST 二进制。 */
function postBinary(url, buffer, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      resolve(null)
      return
    }
    const req = httpRequest(
      {
        host: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'content-length': buffer.length },
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
    const port = Number(contact.port) || node.port
    await postJson(`http://${address}:${port}${API_PREFIX}/profile`, {
      peerId: store.peerId,
      nickname: store.settings.nickname,
    }, 4000)
  }
}

/** 群资料同步给所有成员。 */
async function broadcastGroup(store, node, group) {  for (const member of group.members) {
    if (member === store.peerId) continue
    if (node.pushTo(member, { type: 'group', group })) continue
    const contact = store.getContact(member)
    const address = pickAddress(contact)
    if (address === null) continue
    const port = Number(contact?.port) || node.port
    await postJson(`http://${address}:${port}${API_PREFIX}/group`, { group }, 6000)
  }
}

/** 从发送方拉取文件实体并落盘。 */
async function fetchRemoteFile(store, meta) {
  const contact = store.getContact(meta.from)
  if (contact === undefined) return false
  const address = pickAddress(contact)
  if (address === null) return false
  const port = Number(contact?.port) || 45871
  const url = `http://${address}:${port}${API_PREFIX}/file/${encodeURIComponent(meta.id)}`
  const buffer = await getBinary(url, 60000)
  if (buffer === null) return false
  await store.putFileBuffer({ id: meta.id, name: meta.name, mime: meta.mime, buffer, from: meta.from, ts: meta.ts })
  return true
}

/** GET 二进制。 */
function getBinary(url, timeoutMs = 30000) {
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
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks)))
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
