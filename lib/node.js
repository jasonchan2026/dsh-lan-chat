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
 * 鉴权模型（v2）：
 *   - 每个节点用自己的 identity.secret 作为「身份密钥」（authKey）。
 *   - 首次握手时把 authKey 交给对方（TOFU，首次信任），对方记在联系人上；
 *     之后同一 peerId 必须出示同一把 authKey，否则拒绝——这样就无法顶掉真人。
 *   - 握手通过后，接收方用「自己的 secret」签发一个带过期时间的 HMAC token
 *     交给对方；对方后续所有 HTTP 请求与 WS 升级都必须带这个 token。
 *   - accessCode 仍然可选，用于限制「谁能第一次跟我握手」。
 * 局域网内默认可信，因此 accessCode 为空时任何能连上的人都能握手——但
 * 只能以「自己」的身份，且无法冒充已建立过联系的节点。
 *
 * @module dsh-lan-chat/node
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
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
/** token 有效期（毫秒）。过期后对端需重新握手。 */
const TOKEN_TTL = 24 * 60 * 60 * 1000
/** 同时最多记住多少个 token（防内存膨胀）。 */
const MAX_TOKENS = 512
/** 同时最多接受多少个 WS 连接。 */
const MAX_SOCKETS = 256
/** 单个 peer 每秒最多处理多少条 WS 文本帧。 */
const SOCKET_RATE_LIMIT = 60

/**
 * 判断一个地址是否属于私网/回环（RFC1918 + CGNAT + 回环）。
 * 用于 SSRF 白名单：服务端主动发起的连接只能打这些地方。
 */
export function isPrivateAddress(address) {
  const text = String(address ?? '').trim()
  if (text === '') return false
  if (text === 'localhost') return true
  if (text === '::1' || text === '::') return true
  // IPv6 唯一本地地址 fc00::/7 与链路本地 fe80::/10
  if (text.includes(':')) {
    const head = text.toLowerCase()
    if (head.startsWith('fc') || head.startsWith('fd')) return true
    if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) return true
    // IPv4-mapped
    const mapped = head.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)
    if (mapped !== null) return isPrivateAddress(mapped[1])
    return false
  }
  const octets = text.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/**
 * 是否允许主动向这个地址发起连接（投递消息 / 拉文件 / 探测）。
 *
 * 比 isPrivateAddress 更严：**排除** 127/8（本机其它服务）和
 * 169.254/16（链路本地，AWS/GCP/Azure 的元数据服务都在这里）。
 * 这两段是 SSRF 最经典的目标，而正常聊天用不到。
 */
export function isDialableAddress(address) {
  if (!isPrivateAddress(address)) return false
  const text = String(address ?? '').trim()
  if (text === 'localhost' || text === '::1' || text === '::') return false
  if (text.includes(':')) {
    const head = text.toLowerCase()
    // 链路本地 fe80::/10 同样排除
    if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) return false
    return true
  }
  const octets = text.split('.').map(Number)
  if (octets.length !== 4) return false
  const [a, b] = octets
  if (a === 127) return false
  if (a === 169 && b === 254) return false
  if (a === 0) return false
  return true
}

/** 校验一个 mime 是否是可安全写进响应头的形式。 */
export function safeMime(value) {
  const text = String(value ?? '').trim()
  // 只允许 type/subtype 加可选参数，字符集收窄到可见 ASCII，禁止 CR/LF。
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[ \t]*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*$/u.test(text)) {
    return 'application/octet-stream'
  }
  return text.slice(0, 255)
}

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

/**
 * 某个地址是否与本机处于同一个 /24 私网段。
 * 用于 UDP 发现：只回应同网段的请求。
 */
export function sameSubnet(address) {
  if (!isPrivateAddress(address)) return false
  const target = String(address).split('.')
  if (target.length !== 4) return false
  for (const local of localAddresses()) {
    const parts = local.split('.')
    if (parts.length !== 4) continue
    if (parts[0] === target[0] && parts[1] === target[1] && parts[2] === target[2]) return true
  }
  return false
}

/** 常量时间比较两个字符串。 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** 常量时间比较两个 Buffer。 */
function safeEqualBuffer(left, right) {
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
    // 默认监听局域网（这是插件的用途）；把 bind 设为 'local' 可只绑回环。
    this.bindAddress = options.bind === 'local' ? '127.0.0.1' : '0.0.0.0'
    // 是否允许向 127.0.0.1 投递。默认禁止（那是 SSRF 打本机其它服务的经典路径）；
    // 只有「同机跑两个节点」的测试场景才需要打开。
    this.allowLoopback = options.allowLoopback === true
    this.server = null
    this.udp = null
    this.actualPort = 0
    /** @type {Map<string, WebSocketConnection>} */
    this.sockets = new Map()
    /** @type {Map<string, {peerId: string, nickname: string, host: string, address: string, port: number, lastSeen: number}>} */
    this.discovered = new Map()
    /** @type {Map<string, {timer: NodeJS.Timeout, peers: Map<string, object>}>} */
    this.scans = new Map()
    /** @type {Map<string, {peerId: string, expiresAt: number}>} token → 持有者 */
    this.tokens = new Map()
    /** 每个 peer 的 WS 帧速率窗口。 @type {Map<string, {count: number, resetAt: number}>} */
    this._socketRates = new Map()
    this._beaconTimer = null
    this._closed = false
    this._syncTimer = null
    this._tokenGcTimer = null
  }

  // -------------------------------------------------------------- 鉴权

  /** 这个来源地址能不能访问本节点（入站方向）。 */
  acceptFrom(address) {
    if (this.bindAddress === '127.0.0.1') return true
    const text = String(address ?? '').trim()
    // 未开启 allowLoopback 时，回环来源也视为「本机测试」放行：
    // 本机进程本来就能直接读写数据目录，不构成新的信任边界。
    if (text === '' || text === '::1' || text.startsWith('127.')) return true
    if (!isPrivateAddress(text)) return false
    // 链路本地（169.254/16、fe80::/10）不是「局域网」，是自动配置地址，
    // 云环境的元数据服务就住在这里，入站也不接受。
    if (text.includes(':')) {
      const head = text.toLowerCase()
      if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) return false
      return true
    }
    const octets = text.split('.').map(Number)
    if (octets[0] === 169 && octets[1] === 254) return false
    return true
  }

  /** 这个地址能不能主动连过去（考虑 allowLoopback 开关）。 */
  dialable(address) {
    if (this.allowLoopback && isPrivateAddress(address)) {
      const text = String(address ?? '').trim()
      // 即便开了 allowLoopback，也绝不碰链路本地（云元数据）。
      if (text.includes(':')) return isDialableAddress(address) || text === '::1'
      const octets = text.split('.').map(Number)
      if (octets[0] === 169 && octets[1] === 254) return false
      return true
    }
    return isDialableAddress(address)
  }

  /** 本机身份密钥（用于向别人证明「我是我」）。 */
  get authKey() {
    return String(this.store.secret ?? '')
  }

  /** 用本机 secret 给一个 token 签名，防伪造。 */
  _signToken(raw) {
    return createHmac('sha256', this.authKey).update(raw).digest('base64url')
  }

  /** 签发一个给对端用的 token。 */
  issueToken(peerId) {
    // 先清掉过期的，顺便限制总量
    this._gcTokens()
    if (this.tokens.size >= MAX_TOKENS) {
      // 淘汰最早过期的一个
      let oldestKey = null
      let oldestExpiry = Infinity
      for (const [key, value] of this.tokens) {
        if (value.expiresAt < oldestExpiry) {
          oldestExpiry = value.expiresAt
          oldestKey = key
        }
      }
      if (oldestKey !== null) this.tokens.delete(oldestKey)
    }
    const raw = randomBytes(18).toString('base64url')
    const token = `${raw}.${this._signToken(raw)}`
    this.tokens.set(token, { peerId, expiresAt: Date.now() + TOKEN_TTL })
    return token
  }

  /** 校验一个 token，返回其持有者 peerId，失败返回 null。 */
  verifyToken(token) {
    if (typeof token !== 'string' || token === '') return null
    const entry = this.tokens.get(token)
    if (entry === undefined) return null
    if (entry.expiresAt <= Date.now()) {
      this.tokens.delete(token)
      return null
    }
    const dot = token.lastIndexOf('.')
    if (dot <= 0) return null
    const raw = token.slice(0, dot)
    const signature = token.slice(dot + 1)
    const expected = this._signToken(raw)
    if (!safeEqual(signature, expected)) return null
    return entry.peerId
  }

  _gcTokens() {
    const now = Date.now()
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt <= now) this.tokens.delete(token)
    }
  }

  /** 从请求里取 token：Authorization: Bearer 优先，其次 ?token=。 */
  _tokenFromRequest(request, url) {
    const header = request.headers?.authorization
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7).trim()
    }
    const fromQuery = url?.searchParams?.get('token')
    if (typeof fromQuery === 'string' && fromQuery !== '') return fromQuery
    return ''
  }

  /**
   * 要求请求带有效 token。通过返回 peerId，不通过则写 401 并返回 null。
   * @returns {string | null}
   */
  requireAuth(request, response, url) {
    const token = this._tokenFromRequest(request, url)
    const peerId = this.verifyToken(token)
    if (peerId === null) {
      sendJson(response, 401, { ok: false, error: 'unauthorized' })
      return null
    }
    return peerId
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
      server.listen(this.port, this.bindAddress)
    })
    this.server = server
    this.actualPort = server.address()?.port ?? this.port
    this.log('info', `lan-chat listening on ${this.bindAddress}:${this.actualPort}`)

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
          // 别人在找节点。只回应「同一 /24 私网段」的请求：
          // 这样既能保留自动发现，又不会被跨网段/公网拿来枚举身份或放大流量。
          if (!sameSubnet(rinfo.address)) return
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
      // autoDiscover 关掉后不再广播自己的存在（仍能回应别人的发现）。
      if (this.store.settings.autoDiscover === false) return
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
    const existing = this.store.getContact(peer.peerId)
    // autoAccept=false：只进「发现列表」，不自动写成联系人。
    // 已经是联系人的（existing !== undefined）照常更新地址。
    if (existing === undefined && this.store.settings.autoAccept === false) {
      this.emit(NODE_EVENTS.DISCOVERED, next)
      return
    }
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
    // 对端必须是内网地址。socket 监听 0.0.0.0 是为了让局域网连得上，
    // 但公网来源的请求一律不处理（本机有公网 IP 时尤其重要）。
    if (!this.acceptFrom(clientAddress(request))) {
      sendJson(response, 403, { ok: false, error: '只接受局域网连接' })
      return
    }
    const route = path.slice(API_PREFIX.length)

    // 身份探测：这是唯一的匿名接口，只回最少的信息，够扫描/握手即可。
    if (route === '/info' && (request.method === 'GET' || request.method === 'HEAD')) {
      sendJson(response, 200, {
        ok: true,
        service: 'dsh-lan-chat',
        version: 2,
        peerId: this.store.peerId,
        nickname: this.store.settings.nickname,
        port: this.actualPort,
        requiresCode: String(this.store.settings.accessCode ?? '') !== '',
        requiresAuth: true,
      })
      return
    }

    if (route === '/hello' && request.method === 'POST') {
      const body = await readJson(request)
      if (body === null || typeof body.peerId !== 'string' || body.peerId === '') {
        sendJson(response, 400, { ok: false, error: 'peerId required' })
        return
      }
      const claimedPeerId = body.peerId
      if (claimedPeerId === this.store.peerId) {
        sendJson(response, 400, { ok: false, error: 'cannot hello yourself' })
        return
      }
      const code = String(this.store.settings.accessCode ?? '')
      if (code !== '') {
        if (!safeEqual(body.accessCode ?? '', code)) {
          sendJson(response, 403, { ok: false, error: 'access code rejected' })
          return
        }
      }
      // TOFU：第一次见这个 peerId 时记住它的 authKey；之后必须一致。
      const providedKey = typeof body.authKey === 'string' ? body.authKey : ''
      const known = this.store.getContact(claimedPeerId)
      const knownKey = typeof known?.authKey === 'string' ? known.authKey : ''
      if (knownKey !== '') {
        if (!safeEqual(providedKey, knownKey)) {
          sendJson(response, 403, { ok: false, error: 'identity key mismatch' })
          return
        }
      } else if (providedKey === '') {
        // 老版本客户端没有 authKey：允许握手，但只给它一个「弱」身份，
        // 不写入 authKey，这样它永远无法冒充已有节点。
        this.log('warn', `lan-chat hello: ${claimedPeerId} 未提供 authKey（旧版本客户端）`)
      }
      const contact = this.store.upsertContact({
        peerId: claimedPeerId,
        nickname: String(body.nickname || claimedPeerId).slice(0, 64),
        host: String(body.host ?? '').slice(0, 255),
        addrs: [clientAddress(request)],
        port: Number(body.port) || 0,
        lastSeen: Date.now(),
        online: true,
        ...(knownKey === '' && providedKey !== '' ? { authKey: providedKey } : {}),
      })
      await this.store.saveNow()
      this.emit(NODE_EVENTS.PRESENCE, { peerId: contact.peerId, online: true, nickname: contact.nickname })
      const token = this.issueToken(contact.peerId)
      sendJson(response, 200, {
        ok: true,
        peerId: this.store.peerId,
        nickname: this.store.settings.nickname,
        port: this.actualPort,
        token,
        expiresIn: TOKEN_TTL,
      })
      return
    }

    if (route === '/file' || route.startsWith('/file/')) {
      const id = route.slice('/file/'.length)
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (this.requireAuth(request, response, url) === null) return
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
      createReadStream(path2).pipe(response)
      return
    }

    if (route === '/upload' && request.method === 'POST') {
      const holder = this.requireAuth(request, response, url)
      if (holder === null) return
      // 配额：单次上传受 maxFileBytes 限制（设置可改），另外限制总量避免磁盘被填满。
      const limit = this.store.maxFileBytes
      if (!this.store.canAcceptFile(limit)) {
        sendJson(response, 507, { ok: false, error: 'storage quota exceeded' })
        return
      }
      const buffer = await readRaw(request, limit)
      if (buffer === null) {
        sendJson(response, 413, { ok: false, error: 'file too large' })
        return
      }
      const id = String(url.searchParams.get('id') ?? '')
      const name = String(url.searchParams.get('name') ?? 'file')
      const mime = safeMime(url.searchParams.get('mime') ?? 'application/octet-stream')
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
      if (this.requireAuth(request, response, url) === null) return
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
      const holder = this.requireAuth(request, response, url)
      if (holder === null) return
      const body = await readJson(request)
      const message = body?.message
      if (message === null || typeof message !== 'object' || typeof message.id !== 'string' || typeof message.convId !== 'string') {
        sendJson(response, 400, { ok: false, error: 'bad message' })
        return
      }
      // 发送者由 token 决定，客户端传什么都不算数。
      await this.ingest({ ...message, from: holder }, { fromNetwork: true })
      sendJson(response, 200, { ok: true })
      return
    }

    if (route === '/group' && request.method === 'POST') {
      const holder = this.requireAuth(request, response, url)
      if (holder === null) return
      const body = await readJson(request)
      if (body === null || typeof body.group !== 'object') {
        sendJson(response, 400, { ok: false, error: 'bad group' })
        return
      }
      // F-16：群资料只能由群主推送，且不能借此把自己塞进别人的群。
      const incoming = body.group
      const groupId = typeof incoming?.id === 'string' ? incoming.id : ''
      if (groupId === '') {
        sendJson(response, 400, { ok: false, error: 'bad group id' })
        return
      }
      const existing = this.store.state.groups?.[groupId]
      if (existing !== undefined && existing.createdBy !== '' && existing.createdBy !== holder) {
        sendJson(response, 403, { ok: false, error: 'not the group owner' })
        return
      }
      // 新建群时创建者必须是 token 持有者，防止伪造 createdBy 抢群。
      if (existing === undefined) incoming.createdBy = holder
      const group = this.store.mergeGroup(incoming)
      sendJson(response, 200, { ok: true, group })
      return
    }

    if (route === '/profile' && request.method === 'POST') {
      const holder = this.requireAuth(request, response, url)
      if (holder === null) return
      const body = await readJson(request)
      if (body === null) {
        sendJson(response, 400, { ok: false, error: 'bad body' })
        return
      }
      // 只允许改自己的资料。
      const contact = this.store.upsertContact({
        peerId: holder,
        nickname: String(body.nickname || holder).slice(0, 64),
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
    if (!this.acceptFrom(clientAddress(request))) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    // WS 升级必须带有效 token：没有的话连握手都不做，直接断开。
    const token = this._tokenFromRequest(request, url)
    const holder = this.verifyToken(token)
    if (holder === null) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    if (this.sockets.size >= MAX_SOCKETS && !this.sockets.has(holder)) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    const connection = acceptUpgradeFromHttp(request, socket, head)
    if (connection === null) return
    // 身份只认 token 的持有者，URL 里的 peerId 仅作为一致性校验。
    const claimed = String(url.searchParams.get('peerId') ?? '')
    if (claimed !== '' && claimed !== holder) {
      connection.close(1008, 'peerId does not match token')
      return
    }
    const peerId = holder
    const nickname = String(url.searchParams.get('nickname') ?? '')
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
      if (!this._allowSocketFrame(peerId)) return
      this._onSocketText(peerId, text).catch(() => {})
    })
    connection.on('close', () => {
      if (this.sockets.get(peerId) === connection) this.sockets.delete(peerId)
      this._socketRates.delete(peerId)
      this.store.setPresence(peerId, false)
      this.emit(NODE_EVENTS.PRESENCE, { peerId, online: false, nickname })
    })
    connection.on('error', () => {})
    connection.sendJson({ type: 'ready', peerId: this.store.peerId, nickname: this.store.settings.nickname, port: this.actualPort })
  }

  /** WS 帧速率限制：每个 peer 每秒最多 SOCKET_RATE_LIMIT 帧。 */
  _allowSocketFrame(peerId) {
    const now = Date.now()
    const entry = this._socketRates.get(peerId)
    if (entry === undefined || entry.resetAt <= now) {
      this._socketRates.set(peerId, { count: 1, resetAt: now + 1000 })
      return true
    }
    if (entry.count >= SOCKET_RATE_LIMIT) return false
    entry.count += 1
    return true
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
      // from 由连接身份决定
      await this.ingest({ ...parsed.message, from: peerId }, { fromNetwork: true })
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
    if (parsed.type === 'profile') {
      // 只能改自己的昵称
      const contact = this.store.upsertContact({
        peerId,
        nickname: String(parsed.nickname || peerId).slice(0, 64),
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

  // --------------------------------------------------------- 消息入口

  /**
   * 收下一条消息（本地发出 / 网络进来都走这里），落盘 + 定向推送。
   *
   * 注意：这里**不做广播**。消息只推给「这条消息所属会话的参与者」，
   * 由调用方通过 deliverToPeer()/fanout() 决定投递范围。
   * @param {object} message
   * @param {{fromNetwork?: boolean}} options
   */
  async ingest(message, options = {}) {
    const normalized = normalizeMessage(message, this.store.peerId)
    if (normalized === null) return false
    const added = await this.store.appendMessage(normalized)
    if (!added) return false
    this.emit(NODE_EVENTS.MESSAGE, normalized)
    // 本地 UI 通过 SSE 收（见 index.js）；远端由 fanout 定向推。
    return true
  }

  /** 把消息投递到某个联系人（HTTP POST /send）。 */
  async deliverToPeer(peerId, message) {
    const contact = this.store.getContact(peerId)
    if (contact === undefined) throw new Error('未知联系人')
    const address = pickAddress(contact)
    if (address === null) throw new Error('联系人没有可用地址')
    if (!this.dialable(address)) throw new Error('拒绝访问非私网地址（含回环与链路本地）')
    const port = Number(contact.port) || this.port
    const token = await this._tokenFor(contact)
    if (token === null) throw new Error('握手失败')
    const response = await postJson(`http://${address}:${port}${API_PREFIX}/send`, { message }, 6000, token)
    if (!response?.ok) throw new Error(response?.error ?? '投递失败')
    return true
  }

  /**
   * 拿到（或重新握手换到）某个联系人的 token。
   * token 由**对端**签发，我们本地无法验证，只能缓存 + 过期重换；
   * 真正的校验发生在对端。token 被污染只会导致请求失败，不会提权。
   * @returns {Promise<string | null>}
   */
  async _tokenFor(contact) {
    const cached = typeof contact?.token === 'string' ? contact.token : ''
    const expiresAt = Number(contact?.tokenExpiresAt) || 0
    if (cached !== '' && expiresAt > Date.now() + 60_000) return cached
    const address = pickAddress(contact)
    if (address === null) return null
    if (!this.dialable(address)) return null
    const port = Number(contact?.port) || this.port
    const hello = await postJson(`http://${address}:${port}${API_PREFIX}/hello`, {
      peerId: this.store.peerId,
      nickname: this.store.settings.nickname,
      port: this.actualPort,
      accessCode: String(this.store.settings.accessCode ?? ''),
      authKey: this.authKey,
    }, 6000)
    if (hello?.ok !== true || typeof hello.token !== 'string') return null
    // 顺手把对方在 /hello 里回报的最新昵称写回联系人：
    // 否则对方改了名、而这次又是它主动来握手，我们这边会一直显示旧名字。
    const patch = {
      peerId: contact.peerId,
      token: hello.token,
      tokenExpiresAt: Date.now() + (Number(hello.expiresIn) || TOKEN_TTL),
    }
    const remoteNick = typeof hello.nickname === 'string' ? hello.nickname.trim().slice(0, 64) : ''
    if (remoteNick !== '') patch.nickname = remoteNick
    if (Number(hello.port) > 0) patch.port = Number(hello.port)
    this.store.upsertContact(patch)
    await this.store.saveNow()
    return hello.token
  }

  // ------------------------------------------------------------ 扫描

  /**
   * 扫一个网段找节点。结果通过 'discovered' 事件流式给出。
   * @param {{cidr?: string, addresses?: string[], port?: number, concurrency?: number}} options
   */
  scan(options = {}) {
    const port = Number(options.port) || this.port
    const raw = Array.isArray(options.addresses) && options.addresses.length > 0
      ? options.addresses.map(String)
      : expandCidr(options.cidr ?? '')
    // 只允许扫私网，并且限制总长度（防被当成扫描器/放大器用）。
    // 只扫「可投递」地址：公网、回环、链路本地（云元数据）一律不碰。
    const addresses = raw.filter((address) => this.dialable(address)).slice(0, 1024)
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
    this.tokens.clear()
    this._socketRates.clear()
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
  // 长度与格式收敛，避免超大字段写进日志/界面。
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(input.id)) return null
  if (input.convId.length === 0 || input.convId.length > 200) return null
  if (from.length > 64) return null
  const kind = String(input.kind ?? 'text')
  const message = {
    id: input.id,
    convId: input.convId,
    from,
    fromName: String(input.fromName ?? '').slice(0, 64),
    kind: kind === 'file' || kind === 'system' ? kind : 'text',
    text: String(input.text ?? '').slice(0, 64 * 1024),
    ts: Number(input.ts) || Date.now(),
    self: from === selfPeerId,
  }
  if (message.kind === 'file') {
    const fileId = String(input.file?.id ?? '')
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(fileId)) return null
    message.file = {
      id: fileId,
      name: String(input.file?.name ?? 'file').slice(0, 255),
      size: Number(input.file?.size) || 0,
      mime: safeMime(input.file?.mime ?? 'application/octet-stream'),
      sha256: String(input.file?.sha256 ?? '').slice(0, 64),
      stored: input.file?.stored === true,
    }
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

/** POST JSON，返回解析后的对象或 null。可选带 Bearer token。 */
export function postJson(url, body, timeoutMs = 8000, token = '') {
  return new Promise((resolve) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      resolve(null)
      return
    }
    const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8')
    const headers = { 'content-type': 'application/json', 'content-length': payload.length }
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
    req.end(payload)
  })
}

export { API_PREFIX, DISCOVER_TAG, DISCOVER_REPLY }
