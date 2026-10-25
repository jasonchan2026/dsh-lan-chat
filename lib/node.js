/**
 * dsh-lan-chat · 节点网络层
 *
 * 一台机器 = 一个节点。节点在 LAN 端口（默认 45871）上同时提供：
 *   GET  /lan-chat/v1/info        本机身份（探测/扫描用，无需鉴权）
 *   POST /lan-chat/v1/hello       握手换 token（accessCode 保护时必需）
 *   POST /lan-chat/v1/sync        拉取增量消息
 *   POST /lan-chat/v1/send        投递消息
 *   POST /lan-chat/v1/group       群成员/群资料同步
 *   POST /lan-chat/v1/upload      文件上传（octet-stream）
 *   GET  /lan-chat/v1/file/:id    文件下载
 *   GET  /lan-chat/v1/ws          WebSocket（实时推送）
 * 以及 UDP 广播发现（端口 + 1）：
 *   LAN_CHAT_DISCOVER → 应答 LAN_CHAT_HERE
 *
 * 鉴权模型：第一次连接时用 accessCode（若设置了）换一个 token；token 存
 * 在对方 store 里。局域网内默认可信，因此 accessCode 为空时直接放行。
 *
 * @module dsh-lan-chat/node
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { connect } from 'node:net'
import { createReadStream, statSync } from 'node:fs'
import { acceptUpgradeFromHttp } from './ws.js'

const API_PREFIX = '/lan-chat/v1'
const DISCOVER_TAG = 'DSH_LAN_CHAT_DISCOVER_V1'
const DISCOVER_REPLY = 'DSH_LAN_CHAT_HERE_V1'
const MAX_BODY = 2 * 1024 * 1024
const MAX_UPLOAD = 512 * 1024 * 1024
const PROBE_TIMEOUT = 700

/** 把 CIDR 或 IP 展开成待探测地址列表。 */
export function expandCidr(cidr) {
  const text = String(cidr ?? '').trim()
  if (text === '') return []
  const slash = text.indexOf('/')
  const base = slash === -1 ? text : text.slice(0, slash)
  const bits = slash === -1 ? 32 : Number(text.slice(slash + 1))
  if (!Number.isInteger(bits) || bits < 8 || bits > 32) return []
  const octets = base.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return []
  const baseInt = ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  const network = (baseInt & mask) >>> 0
  const size = 2 ** (32 - bits)
  // 上限 1024 个地址，避免 /8 之类的输入把界面拖死
  const total = Math.min(size, 1024)
  const out = []
  for (let index = 1; index < total - 1; index += 1) {
    const value = (network + index) >>> 0
    out.push(`${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`)
  }
  return out
}

/** 列出本机所有 IPv4 的 /24 网段（去重），扫描页默认值。 */
export function localSubnets() {
  const out = new Set()
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      const parts = info.address.split('.')
      if (parts.length !== 4) continue
      out.add(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`)
    }
  }
  return [...out]
}

/** 本机所有非回环 IPv4。 */
export function localAddresses() {
  const out = []
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      out.push(info.address)
    }
  }
  return out
}

/** 常量时间比较两个字符串。 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** 读 JSON body。 */
function readJson(request, limit = MAX_BODY) {
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    let aborted = false
    request.on('data', (chunk) => {
      if (aborted) return
      bytes += chunk.length
      if (bytes > limit) {
        aborted = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (aborted) {
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

/** 读原始 body 到文件。 */
function readRaw(request, limit = MAX_UPLOAD) {
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
    request.on('end', () => resolve(bytes > limit ? null : Buffer.concat(chunks)))
    request.on('error', () => resolve(null))
  })
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

/** 事件总线上的事件名。 */
export const NODE_EVENTS = {
  MESSAGE: 'message',
  PRESENCE: 'presence',
  DISCOVERED: 'discovered',
}

/**
 * 局域网节点。
 *
 * 事件：
 *   'message'  (message)        收到或发出了一条消息
 *   'presence' ({peerId, online, nickname})
 *   'discovered' (peer)         扫描/广播发现了一个节点
 */
export class LanNode extends EventEmitter {
  /**
   * @param {{store: import('./store.js').Store, port?: number, log?: (level: string, message: string) => void}} options
   */
  constructor(options) {
    super()
    this.store = options.store
    this.port = Number(options.port) || 45871
    this.log = options.log ?? (() => {})
    this.server = null
    this.udp = null
    this.actualPort = 0
    /** @type {Map<string, WebSocketConnection>} */
    this.sockets = new Map()
    /** @type {Map<string, {peerId: string, nickname: string, host: string, address: string, port: number, lastSeen: number}>} */
    this.discovered = new Map()
    /** @type {Map<string, {timer: NodeJS.Timeout, peers: Map<string, object>}>} */
    this.scans = new Map()
    this._beaconTimer = null
    this._closed = false
    this._syncTimer = null
  }

  /** 启动 HTTP + WebSocket + UDP 发现。 */
  async start() {
    const server = createServer((request, response) => {
      this._handleHttp(request, response).catch((error) => {
        this.log('warn', `lan-chat http: ${error instanceof Error ? error.message : String(error)}`)
        if (!response.headersSent) sendJson(response, 500, { ok: false, error: 'internal' })
        else response.destroy()
      })
    })
    server.on('upgrade', (request, socket, head) => {
      this._handleUpgrade(request, socket, head)
    })
    server.on('clientError', (error, socket) => {
      try {
        socket.destroy()
      } catch {}
    })

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.port, '0.0.0.0')
    })
    this.server = server
    this.actualPort = server.address()?.port ?? this.port
    this.log('info', `lan-chat listening on 0.0.0.0:${this.actualPort}`)

    this._startUdp()
    this._startBeacon()
    return this.actualPort
  }

  // -------------------------------------------------------------- UDP

  _startUdp() {
    try {
      const socket = createSocket({ type: 'udp4', reuseAddr: true })
      socket.on('error', (error) => {
        this.log('warn', `lan-chat udp: ${error.message}`)
      })
      socket.on('message', (buffer, rinfo) => {
        let text
        try {
          text = buffer.toString('utf8')
        } catch {
          return
        }
        if (text.startsWith(DISCOVER_TAG)) {
          // 别人在找节点：回一条带自己身份的应答
          const payload = JSON.stringify({
            tag: DISCOVER_REPLY,
            peerId: this.store.peerId,
            nickname: this.store.settings.nickname,
            port: this.actualPort,
          })
          socket.send(Buffer.from(payload, 'utf8'), rinfo.port, rinfo.address, () => {})
          return
        }
        if (!text.startsWith(DISCOVER_REPLY)) return
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          return
        }
        if (parsed === null || typeof parsed !== 'object') return
        if (parsed.peerId === this.store.peerId) return
        this._noteDiscovered({
          peerId: String(parsed.peerId),
          nickname: String(parsed.nickname ?? ''),
          host: '',
          address: rinfo.address,
          port: Number(parsed.port) || this.actualPort,
        })
      })
      socket.bind(this.actualPort + 1, () => {
        try {
          socket.setBroadcast(true)
        } catch {}
      })
      this.udp = socket
    } catch (error) {
      this.log('warn', `lan-chat udp unavailable: ${error instanceof Error ? error.message : String(error)}`)
      this.udp = null
    }
  }

  /** 周期性广播，让同一网段的人自动看到彼此。 */
  _startBeacon() {
    if (this._beaconTimer !== null) return
    const tick = () => {
      if (this._closed || this.udp === null) return
      const payload = Buffer.from(`${DISCOVER_TAG}:${this.store.peerId}`, 'utf8')
      const targets = ['255.255.255.255', ...localAddresses().map((address) => {
        const parts = address.split('.')
        parts[3] = '255'
        return parts.join('.')
      })]
      for (const target of new Set(targets)) {
        this.udp.send(payload, this.actualPort + 1, target, () => {})
      }
    }
    tick()
    this._beaconTimer = setInterval(tick, 30000)
    this._beaconTimer.unref?.()
  }

  _noteDiscovered(peer) {
    if (peer.peerId === this.store.peerId) return
    const prev = this.discovered.get(peer.peerId)
    const next = { ...prev, ...peer, lastSeen: Date.now() }
    this.discovered.set(peer.peerId, next)
    this.store.upsertContact({
      peerId: peer.peerId,
      nickname: peer.nickname || prev?.nickname || peer.peerId,
      host: peer.host || prev?.host || '',
      addrs: [peer.address],
      port: peer.port,
      lastSeen: Date.now(),
    })
    this.emit(NODE_EVENTS.DISCOVERED, next)
    this.emit(NODE_EVENTS.PRESENCE, { peerId: peer.peerId, online: true, nickname: next.nickname })
  }

  // ------------------------------------------------------------- HTTP

  async _handleHttp(request, response) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    if (!path.startsWith(API_PREFIX)) {
      sendJson(response, 404, { ok: false, error: 'not found' })
      return
    }
    const route = path.slice(API_PREFIX.length)

    // 身份探测：任何人不带凭证都能读，用于扫描。
    if (route === '/info' && (request.method === 'GET' || request.method === 'HEAD')) {
      sendJson(response, 200, {
        ok: true,
        service: 'dsh-lan-chat',
        version: 1,
        peerId: this.store.peerId,
        nickname: this.store.settings.nickname,
        host: this.store.self().host,
        port: this.actualPort,
        requiresCode: String(this.store.settings.accessCode ?? '') !== '',
      })
      return
    }

    if (route === '/hello' && request.method === 'POST') {
      const body = await readJson(request)
      if (body === null || typeof body.peerId !== 'string') {
        sendJson(response, 400, { ok: false, error: 'peerId required' })
        return
      }
      const code = String(this.store.settings.accessCode ?? '')
      if (code !== '') {
        if (!safeEqual(body.accessCode ?? '', code)) {
          sendJson(response, 403, { ok: false, error: 'access code rejected' })
          return
        }
      }
      const contact = this.store.upsertContact({
        peerId: body.peerId,
        nickname: String(body.nickname || body.peerId),
        host: String(body.host ?? ''),
        addrs: [clientAddress(request)],
        port: Number(body.port) || 0,
        lastSeen: Date.now(),
        online: true,
      })
      this.emit(NODE_EVENTS.PRESENCE, { peerId: contact.peerId, online: true, nickname: contact.nickname })
      sendJson(response, 200, {
        ok: true,
        peerId: this.store.peerId,
        nickname: this.store.settings.nickname,
        host: this.store.self().host,
        port: this.actualPort,
      })
      return
    }

    if (route === '/file' || route.startsWith('/file/')) {
      const id = route.slice('/file/'.length)
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const meta = this.store.fileMeta(id)
      if (meta === undefined) {
        sendJson(response, 404, { ok: false, error: 'file not found' })
        return
      }
      const path2 = this.store.filePath(id)
      let size = 0
      try {
        size = statSync(path2).size
      } catch {
        sendJson(response, 404, { ok: false, error: 'file missing on disk' })
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
      createReadStream(path2).pipe(response)
      return
    }

    if (route === '/upload' && request.method === 'POST') {
      const buffer = await readRaw(request)
      if (buffer === null) {
        sendJson(response, 413, { ok: false, error: 'file too large' })
        return
      }
      const id = String(url.searchParams.get('id') ?? '')
      const name = String(url.searchParams.get('name') ?? 'file')
      const mime = String(url.searchParams.get('mime') ?? 'application/octet-stream')
      const from = String(url.searchParams.get('from') ?? '')
      if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id)) {
        sendJson(response, 400, { ok: false, error: 'bad file id' })
        return
      }
      const meta = await this.store.putFileBuffer({ id, name, mime, buffer, from, ts: Date.now() })
      sendJson(response, 200, { ok: true, file: publicFile(meta) })
      return
    }

    if (route === '/sync' && request.method === 'POST') {
      const body = await readJson(request)
      if (body === null) {
        sendJson(response, 400, { ok: false, error: 'bad body' })
        return
      }
      const convId = String(body.convId ?? '')
      if (convId === '') {
        sendJson(response, 400, { ok: false, error: 'convId required' })
        return
      }
      const messages = await this.store.listMessages(convId, {
        since: Number.isFinite(body.since) ? Number(body.since) : undefined,
        limit: 500,
      })
      sendJson(response, 200, { ok: true, messages })
      return
    }

    if (route === '/send' && request.method === 'POST') {
      const body = await readJson(request)
      const message = body?.message
      if (message === null || typeof message !== 'object' || typeof message.id !== 'string' || typeof message.convId !== 'string') {
        sendJson(response, 400, { ok: false, error: 'bad message' })
        return
      }
      await this.ingest(message, { fromNetwork: true })
      sendJson(response, 200, { ok: true })
      return
    }

    if (route === '/group' && request.method === 'POST') {
      const body = await readJson(request)
      if (body === null || typeof body.group !== 'object') {
        sendJson(response, 400, { ok: false, error: 'bad group' })
        return
      }
      const group = this.store.mergeGroup(body.group)
      sendJson(response, 200, { ok: true, group })
      return
    }

    if (route === '/profile' && request.method === 'POST') {
      const body = await readJson(request)
      if (body === null || typeof body.peerId !== 'string') {
        sendJson(response, 400, { ok: false, error: 'peerId required' })
        return
      }
      const contact = this.store.upsertContact({
        peerId: body.peerId,
        nickname: String(body.nickname || body.peerId),
        lastSeen: Date.now(),
      })
      this.emit(NODE_EVENTS.PRESENCE, { peerId: contact.peerId, online: true, nickname: contact.nickname })
      sendJson(response, 200, { ok: true })
      return
    }

    sendJson(response, 404, { ok: false, error: 'not found' })
  }

  _handleUpgrade(request, socket, head) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== `${API_PREFIX}/ws`) {
      socket.destroy()
      return
    }
    const connection = acceptUpgradeFromHttp(request, socket, head)
    if (connection === null) return
    let peerId = String(url.searchParams.get('peerId') ?? '')
    const nickname = String(url.searchParams.get('nickname') ?? '')
    if (peerId === '') {
      connection.close(1008, 'peerId required')
      return
    }
    // 同一 peer 重连时踢掉旧连接
    const prev = this.sockets.get(peerId)
    if (prev !== undefined && prev !== connection) {
      try {
        prev.close(1000, 'replaced')
      } catch {}
    }
    this.sockets.set(peerId, connection)
    this.store.upsertContact({ peerId, nickname: nickname || peerId, lastSeen: Date.now(), online: true })
    this.emit(NODE_EVENTS.PRESENCE, { peerId, online: true, nickname })
    connection.on('text', (text) => {
      this._onSocketText(peerId, text)
    })
    connection.on('close', () => {
      if (this.sockets.get(peerId) === connection) this.sockets.delete(peerId)
      this.store.setPresence(peerId, false)
      this.emit(NODE_EVENTS.PRESENCE, { peerId, online: false, nickname })
    })
    connection.on('error', () => {})
    connection.sendJson({ type: 'ready', peerId: this.store.peerId, nickname: this.store.settings.nickname, port: this.actualPort })
  }

  async _onSocketText(peerId, text) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (parsed === null || typeof parsed !== 'object') return
    if (parsed.type === 'message' && typeof parsed.message === 'object') {
      await this.ingest(parsed.message, { fromNetwork: true })
      return
    }
    if (parsed.type === 'ping') {
      const socket = this.sockets.get(peerId)
      socket?.sendJson({ type: 'pong', ts: Date.now() })
      return
    }
    if (parsed.type === 'typing' && typeof parsed.convId === 'string') {
      this.emit('typing', { peerId, convId: parsed.convId })
      return
    }
    if (parsed.type === 'profile' && typeof parsed.peerId === 'string') {
      // 对端改了昵称：更新联系人资料并通知界面
      const contact = this.store.upsertContact({
        peerId: parsed.peerId,
        nickname: String(parsed.nickname || parsed.peerId),
        lastSeen: Date.now(),
      })
      this.emit(NODE_EVENTS.PRESENCE, { peerId: contact.peerId, online: true, nickname: contact.nickname })
      return
    }
  }

  /** 给某个 peer 推送（若已连 WS）。 */
  pushTo(peerId, payload) {
    const socket = this.sockets.get(peerId)
    if (socket === undefined || socket.closed) return false
    try {
      socket.sendJson(payload)
      return true
    } catch {
      return false
    }
  }

  /** 广播给所有已连的 peer。 */
  broadcast(payload) {
    for (const [peerId, socket] of this.sockets) {
      try {
        socket.sendJson(payload)
      } catch {
        this.sockets.delete(peerId)
      }
    }
  }

  // --------------------------------------------------------- 消息入口

  /**
   * 收下一条消息（本地发出 / 网络进来都走这里），落盘 + 广播。
   * @param {object} message
   * @param {{fromNetwork?: boolean}} options
   */
  async ingest(message, options = {}) {
    const normalized = normalizeMessage(message, this.store.peerId)
    if (normalized === null) return false
    const added = await this.store.appendMessage(normalized)
    if (!added) return false
    this.emit(NODE_EVENTS.MESSAGE, normalized)
    // 本地 UI 通过 SSE 收；远端通过 WS 收
    this.broadcast({ type: 'message', message: normalized })
    return true
  }

  /** 把消息投递到某个联系人（HTTP POST /send）。 */
  async deliverToPeer(peerId, message) {
    const contact = this.store.getContact(peerId)
    if (contact === undefined) throw new Error('未知联系人')
    const address = pickAddress(contact)
    if (address === null) throw new Error('联系人没有可用地址')
    const port = Number(contact.port) || this.port
    const response = await postJson(`http://${address}:${port}${API_PREFIX}/send`, { message }, 6000)
    if (!response?.ok) throw new Error(response?.error ?? '投递失败')
    return true
  }

  // ------------------------------------------------------------ 扫描

  /**
   * 扫一个网段找节点。结果通过 'discovered' 事件流式给出。
   * @param {{cidr?: string, addresses?: string[], port?: number, concurrency?: number}} options
   */
  scan(options = {}) {
    const port = Number(options.port) || this.port
    const addresses = Array.isArray(options.addresses) && options.addresses.length > 0
      ? options.addresses.map(String)
      : expandCidr(options.cidr ?? '')
    const concurrency = Math.min(Math.max(Number(options.concurrency) || 48, 1), 256)
    const scanId = randomBytes(6).toString('hex')
    const entry = { timer: null, peers: new Map(), total: addresses.length, done: 0, finished: false }
    this.scans.set(scanId, entry)

    let cursor = 0
    const run = async () => {
      while (cursor < addresses.length) {
        if (this._closed || entry.finished) return
        const address = addresses[cursor]
        cursor += 1
        const found = await probeHost(address, port, PROBE_TIMEOUT)
        entry.done += 1
        if (found !== null && found.peerId !== this.store.peerId) {
          entry.peers.set(found.peerId, found)
          this._noteDiscovered(found)
        }
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, addresses.length) }, () => run())
    Promise.all(workers)
      .then(() => {
        entry.finished = true
      })
      .catch(() => {
        entry.finished = true
      })
    // 5 分钟后自动回收
    entry.timer = setTimeout(() => this.scans.delete(scanId), 300000)
    entry.timer.unref?.()
    return { scanId, total: addresses.length }
  }

  scanStatus(scanId) {
    const entry = this.scans.get(scanId)
    if (entry === undefined) return null
    return {
      scanId,
      done: entry.done,
      total: entry.total,
      finished: entry.finished,
      peers: [...entry.peers.values()],
    }
  }

  /** 主动 UDP 广播一次，收集应答。 */
  async pingSweep(timeoutMs = 2500) {
    const before = new Set(this.discovered.keys())
    if (this.udp !== null) {
      const payload = Buffer.from(`${DISCOVER_TAG}:${this.store.peerId}`, 'utf8')
      const targets = ['255.255.255.255', ...localAddresses().map((address) => {
        const parts = address.split('.')
        parts[3] = '255'
        return parts.join('.')
      })]
      for (const target of new Set(targets)) {
        this.udp.send(payload, this.actualPort + 1, target, () => {})
      }
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      timer.unref?.()
    })
    const out = []
    for (const [peerId, peer] of this.discovered) {
      if (!before.has(peerId)) out.push(peer)
    }
    return out
  }

  /** 关闭监听与连接。 */
  async close() {
    this._closed = true
    if (this._beaconTimer !== null) {
      clearInterval(this._beaconTimer)
      this._beaconTimer = null
    }
    if (this._syncTimer !== null) {
      clearInterval(this._syncTimer)
      this._syncTimer = null
    }
    for (const entry of this.scans.values()) {
      entry.finished = true
      if (entry.timer !== null) clearTimeout(entry.timer)
    }
    this.scans.clear()
    for (const socket of this.sockets.values()) {
      try {
        socket.close(1001, 'server shutting down')
      } catch {}
    }
    this.sockets.clear()
    if (this.udp !== null) {
      try {
        this.udp.close()
      } catch {}
      this.udp = null
    }
    if (this.server !== null) {
      const server = this.server
      this.server = null
      await new Promise((resolve) => {
        server.close(() => resolve())
        setTimeout(resolve, 1500).unref?.()
      })
    }
  }
}

/** 从请求里取客户端 IP（去掉 IPv6 前缀）。 */
function clientAddress(request) {
  const raw = request.socket?.remoteAddress ?? ''
  if (raw.startsWith('::ffff:')) return raw.slice(7)
  return raw
}

/** 规范化一条消息。 */
export function normalizeMessage(input, selfPeerId) {
  if (input === null || typeof input !== 'object') return null
  if (typeof input.id !== 'string' || typeof input.convId !== 'string') return null
  const from = String(input.from ?? '')
  if (from === '') return null
  const kind = String(input.kind ?? 'text')
  const message = {
    id: input.id,
    convId: input.convId,
    from,
    fromName: String(input.fromName ?? ''),
    kind: kind === 'file' || kind === 'system' ? kind : 'text',
    text: String(input.text ?? ''),
    ts: Number(input.ts) || Date.now(),
    self: from === selfPeerId,
  }
  if (message.kind === 'file') {
    message.file = {
      id: String(input.file?.id ?? ''),
      name: String(input.file?.name ?? 'file'),
      size: Number(input.file?.size) || 0,
      mime: String(input.file?.mime ?? 'application/octet-stream'),
      sha256: String(input.file?.sha256 ?? ''),
      stored: input.file?.stored === true,
    }
    if (message.file.id === '') return null
  }
  return message
}

/** 对外暴露的文件元数据（不带本地路径）。 */
export function publicFile(meta) {
  if (meta === undefined || meta === null) return null
  return {
    id: meta.id,
    name: meta.name,
    size: meta.size,
    mime: meta.mime,
    sha256: meta.sha256,
    stored: meta.stored === true,
    ts: meta.ts,
  }
}

/** 从联系人记录里挑一个可连地址。 */
export function pickAddress(contact) {
  const addrs = Array.isArray(contact?.addrs) ? contact.addrs : []
  if (addrs.length > 0) return addrs[0]
  if (typeof contact?.address === 'string' && contact.address !== '') return contact.address
  return null
}

/**
 * 探测一台主机是不是 lan-chat 节点。
 * @returns {Promise<object|null>}
 */
export function probeHost(address, port, timeoutMs = PROBE_TIMEOUT) {
  return new Promise((resolve) => {
    let settled = false
    const socket = connect({ host: address, port })
    const done = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.destroy()
      } catch {}
      resolve(value)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    timer.unref?.()
    socket.on('connect', () => {
      socket.write(`GET ${API_PREFIX}/info HTTP/1.1\r\nHost: ${address}:${port}\r\nConnection: close\r\n\r\n`)
    })
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) {
        if (buffer.length > 16384) done(null)
        return
      }
      const body = buffer.slice(end + 4)
      try {
        const parsed = JSON.parse(body)
        if (parsed?.service !== 'dsh-lan-chat' || typeof parsed.peerId !== 'string') {
          done(null)
          return
        }
        done({
          peerId: parsed.peerId,
          nickname: String(parsed.nickname ?? ''),
          host: String(parsed.host ?? ''),
          address,
          port: Number(parsed.port) || port,
        })
      } catch {
        done(null)
      }
    })
    socket.on('error', () => done(null))
    socket.on('close', () => done(null))
  })
}

/** POST JSON，返回解析后的对象或 null。 */
export function postJson(url, body, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      resolve(null)
      return
    }
    const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8')
    const req = httpRequest(
      {
        host: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': payload.length },
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
    req.end(payload)
  })
}

export { API_PREFIX, DISCOVER_TAG, DISCOVER_REPLY }
