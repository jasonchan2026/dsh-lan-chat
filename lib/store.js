/**
 * dsh-lan-chat · 持久化层
 *
 * 所有数据都落在本地磁盘，不依赖任何在线服务：
 *   <dataDir>/identity.json      本机身份（peerId / secret）
 *   <dataDir>/state.json         设置、联系人、群、已读位置、文件索引
 *   <dataDir>/messages/<conv>.jsonl  每个会话一个追加日志
 *   <dataDir>/files/<fileId>     收发的文件实体
 *
 * @module dsh-lan-chat/store
 */
import { createHash, randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

/** 单个会话日志最多保留的行数，防止长年累积拖慢读取。 */
const MAX_LOG_LINES = 20000
/** 读取超大会话日志时只回看尾部这么多字节。 */
const TAIL_BYTES = 8 * 1024 * 1024
/** 本机文件缓存的总配额（超出后拒绝新的上传）。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
/** 无人引用的文件保留多久后回收。 */
const FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** 把 convId 变成安全文件名（保留可读性，替换分隔符）。 */
export function safeConvName(convId) {
  return encodeURIComponent(String(convId)).replace(/[^A-Za-z0-9._~%-]/gu, '_')
}

/** DM 会话 id：两个 peerId 排序后拼接，双方算出同一个值。 */
export function dmConvId(a, b) {
  const [x, y] = [String(a), String(b)].sort()
  return `dm:${x}|${y}`
}

/** 群会话 id。 */
export function groupConvId(groupId) {
  return `grp:${groupId}`
}

/** 默认状态。 */
function defaultState() {
  return {
    version: 1,
    settings: {
      nickname: '',
      accessCode: '',
      autoAccept: true,
      port: 45871,
      autoDiscover: true,
      notifyDesktop: false,
    },
    contacts: {},
    groups: {},
    read: {},
    files: {},
  }
}

/** 简单深合并，用于把旧版本 state.json 升级到当前字段集合。 */
function mergeState(base, loaded) {
  if (loaded === null || typeof loaded !== 'object') return base
  const out = { ...base, ...loaded }
  out.settings = { ...base.settings, ...(loaded.settings ?? {}) }
  out.contacts = { ...(loaded.contacts ?? {}) }
  out.groups = { ...(loaded.groups ?? {}) }
  out.read = { ...(loaded.read ?? {}) }
  out.files = { ...(loaded.files ?? {}) }
  return out
}

export class Store {
  /** @param {{dir: string}} options */
  constructor(options) {
    this.dir = options.dir
    this.messagesDir = join(this.dir, 'messages')
    this.filesDir = join(this.dir, 'files')
    this.identityPath = join(this.dir, 'identity.json')
    this.statePath = join(this.dir, 'state.json')
    this.identity = null
    this.state = null
    this._saveTimer = null
    this._saveChain = Promise.resolve()
    this._closed = false
    /** @type {Set<(message: object) => void>} 新消息落盘后的回调（长轮询唤醒用）。 */
    this.appendListeners = new Set()
  }

  /** 订阅新消息。返回取消订阅函数。 */
  onAppend(listener) {
    this.appendListeners.add(listener)
    return () => this.appendListeners.delete(listener)
  }

  /** 建目录、读身份与状态（首次运行自动生成）。 */
  async init() {
    await mkdir(this.messagesDir, { recursive: true })
    await mkdir(this.filesDir, { recursive: true })
    await this._loadIdentity()
    await this._loadState()
    if (!this.state.settings.nickname) {
      this.state.settings.nickname = defaultNickname()
      await this.saveNow()
    }
  }

  async _loadIdentity() {
    try {
      const parsed = JSON.parse(await readFile(this.identityPath, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.peerId === 'string' && typeof parsed.secret === 'string') {
        this.identity = parsed
        return
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // 身份文件损坏：重建，但保留原文件副本以便排查。
        try {
          await rename(this.identityPath, `${this.identityPath}.broken-${Date.now()}`)
        } catch {}
      }
    }
    this.identity = {
      peerId: `lc${randomBytes(8).toString('hex')}`,
      secret: randomBytes(24).toString('base64url'),
      createdAt: Date.now(),
    }
    await this._atomicWrite(this.identityPath, `${JSON.stringify(this.identity, null, 2)}\n`)
  }

  async _loadState() {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8'))
      this.state = mergeState(defaultState(), parsed)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        try {
          await rename(this.statePath, `${this.statePath}.broken-${Date.now()}`)
        } catch {}
      }
      this.state = defaultState()
    }
  }

  async _atomicWrite(path, text) {
    const tmp = `${path}.tmp-${process.pid}`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  }

  get peerId() {
    return this.identity.peerId
  }

  get secret() {
    return this.identity.secret
  }

  get settings() {
    return this.state.settings
  }

  /** 本机对外身份（发广播、应答 hello 用）。 */
  self(extra) {
    return {
      peerId: this.identity.peerId,
      nickname: this.state.settings.nickname,
      host: hostname(),
      ...extra,
    }
  }

  // ---------------------------------------------------------------- 保存

  /** 标脏，200ms 后合并写盘。 */
  touch() {
    if (this._closed) return
    if (this._saveTimer !== null) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this.saveNow().catch(() => {})
    }, 200)
    this._saveTimer.unref?.()
  }

  /** 立即写盘（串行，避免并发 rename 打架）。 */
  saveNow() {
    const text = `${JSON.stringify(this.state, null, 2)}\n`
    this._saveChain = this._saveChain.then(() => this._atomicWrite(this.statePath, text)).catch(() => {})
    return this._saveChain
  }

  async close() {
    this._closed = true
    if (this._saveTimer !== null) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    await this.saveNow()
  }

  // ------------------------------------------------------------ 联系人

  /** 新建或更新联系人；返回更新后的记录。 */
  upsertContact(patch) {
    const peerId = String(patch.peerId)
    const prev = this.state.contacts[peerId] ?? {
      peerId,
      nickname: peerId,
      host: '',
      addrs: [],
      port: 0,
      added: false,
      blocked: false,
      addedAt: 0,
      lastSeen: 0,
      online: false,
    }
    const next = { ...prev, ...patch }
    if (Array.isArray(patch.addrs)) {
      const merged = new Set([...(prev.addrs ?? []), ...patch.addrs])
      next.addrs = [...merged]
    }
    this.state.contacts[peerId] = next
    this.touch()
    return next
  }

  getContact(peerId) {
    return this.state.contacts[peerId]
  }

  /** 设置在线状态（不触碰其他字段）。 */
  setPresence(peerId, online) {
    const contact = this.state.contacts[peerId]
    if (contact === undefined) return null
    contact.online = online === true
    contact.lastSeen = Date.now()
    this.touch()
    return contact
  }

  /** 删除联系人（不删聊天记录）。 */
  removeContact(peerId) {
    if (this.state.contacts[peerId] === undefined) return false
    delete this.state.contacts[peerId]
    this.touch()
    return true
  }

  contacts() {
    return Object.values(this.state.contacts)
  }

  /** 标记在线/离线，返回是否有变化。 */
  setPresence(peerId, online, seenAt = Date.now()) {
    const contact = this.state.contacts[peerId]
    if (contact === undefined) return false
    const changed = contact.online !== online
    contact.online = online
    if (online) contact.lastSeen = seenAt
    this.touch()
    return changed
  }

  // ---------------------------------------------------------------- 群

  createGroup({ name, members, createdBy }) {
    const id = `g${randomBytes(6).toString('hex')}`
    const group = {
      id,
      name: String(name || '未命名群聊'),
      members: [...new Set(members.map(String))],
      createdBy: String(createdBy),
      createdAt: Date.now(),
    }
    this.state.groups[id] = group
    this.touch()
    return group
  }

  /** 收到别人建的群：按 id 幂等合并。 */
  mergeGroup(group) {
    if (group === null || typeof group !== 'object' || typeof group.id !== 'string') return null
    const prev = this.state.groups[group.id]
    const next = prev === undefined
      ? { id: group.id, name: String(group.name || '群聊'), members: [], createdBy: String(group.createdBy ?? ''), createdAt: Number(group.createdAt) || Date.now() }
      : { ...prev }
    next.name = String(group.name || next.name)
    next.members = [...new Set([...(next.members ?? []), ...(Array.isArray(group.members) ? group.members.map(String) : [])])]
    this.state.groups[group.id] = next
    this.touch()
    return next
  }

  updateGroup(groupId, patch) {
    const prev = this.state.groups[groupId]
    if (prev === undefined) return null
    const next = { ...prev, ...patch }
    if (Array.isArray(patch.members)) next.members = [...new Set(patch.members.map(String))]
    this.state.groups[groupId] = next
    this.touch()
    return next
  }

  removeGroup(groupId) {
    if (this.state.groups[groupId] === undefined) return false
    delete this.state.groups[groupId]
    this.touch()
    return true
  }

  groups() {
    return Object.values(this.state.groups)
  }

  /** 本机参与的群（自己一定在 members 里）。 */
  myGroups() {
    return this.groups().filter((group) => group.members.includes(this.peerId))
  }

  // ------------------------------------------------------------ 消息

  _logPath(convId) {
    return join(this.messagesDir, `${safeConvName(convId)}.jsonl`)
  }

  /** 追加一条消息（幂等：同 id 已存在则忽略）。 */
  async appendMessage(message) {
    const convId = message.convId
    const existing = await this._readLog(convId)
    if (existing.some((row) => row.id === message.id)) return false
    await appendFile(this._logPath(convId), `${JSON.stringify(message)}\n`, 'utf8')
    for (const listener of this.appendListeners) {
      try {
        listener(message)
      } catch {}
    }
    return true
  }

  async _readLog(convId) {
    const path = this._logPath(convId)
    let info
    try {
      info = await stat(path)
    } catch {
      return []
    }
    let text
    if (info.size > TAIL_BYTES) {
      const start = info.size - TAIL_BYTES
      text = await new Promise((resolve, reject) => {
        const chunks = []
        const stream = createReadStream(path, { start })
        stream.on('data', (chunk) => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        stream.on('error', reject)
      })
      // 丢掉被截断的首行
      const nl = text.indexOf('\n')
      if (nl !== -1) text = text.slice(nl + 1)
    } else {
      text = await readFile(path, 'utf8')
    }
    const rows = []
    for (const line of text.split('\n')) {
      if (line === '') continue
      try {
        const parsed = JSON.parse(line)
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.id === 'string') rows.push(parsed)
      } catch {
        // 坏行忽略（进程被杀时可能留下半行）
      }
    }
    if (rows.length > MAX_LOG_LINES) rows.splice(0, rows.length - MAX_LOG_LINES)
    rows.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
    return rows
  }

  /** 读取会话消息，支持增量（since）与向前翻页（before）。 */
  async listMessages(convId, options = {}) {
    const rows = await this._readLog(convId)
    const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 1000)
    let out = rows
    if (Number.isFinite(options.since)) out = out.filter((row) => (row.ts ?? 0) > options.since)
    if (Number.isFinite(options.before)) out = out.filter((row) => (row.ts ?? 0) < options.before)
    if (out.length > limit) out = out.slice(out.length - limit)
    return out
  }

  /** 该会话最后一条消息的时间戳（同步用）。 */
  async lastTs(convId) {
    const rows = await this._readLog(convId)
    return rows.length === 0 ? 0 : rows[rows.length - 1].ts ?? 0
  }

  /** 所有会话的最后时间戳表。 */
  async lastTsMap(convIds) {
    const out = {}
    for (const convId of convIds) out[convId] = await this.lastTs(convId)
    return out
  }

  markRead(convId, ts) {
    const prev = this.state.read[convId] ?? 0
    if (ts > prev) {
      this.state.read[convId] = ts
      this.touch()
    }
  }

  readMarker(convId) {
    return this.state.read[convId] ?? 0
  }

  // ------------------------------------------------------------ 文件

  fileMeta(id) {
    return this.state.files[id]
  }

  filePath(id) {
    return join(this.filesDir, String(id).replace(/[^A-Za-z0-9_-]/gu, ''))
  }

  /** 把 Buffer 落盘并登记元数据。 */
  async putFileBuffer({ id, name, mime, buffer, from, ts }) {
    const path = this.filePath(id)
    await writeFile(path, buffer)
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const meta = {
      id,
      name: String(name || 'file'),
      mime: String(mime || 'application/octet-stream'),
      size: buffer.length,
      sha256,
      from: String(from ?? ''),
      ts: Number(ts) || Date.now(),
      stored: true,
    }
    this.state.files[id] = meta
    this.touch()
    return meta
  }

  /** 登记一个“在别人机器上”的文件（只存元数据）。 */
  registerRemoteFile(meta) {
    if (meta === null || typeof meta !== 'object' || typeof meta.id !== 'string') return null
    const record = {
      id: meta.id,
      name: String(meta.name || 'file'),
      mime: String(meta.mime || 'application/octet-stream'),
      size: Number(meta.size) || 0,
      sha256: String(meta.sha256 || ''),
      from: String(meta.from ?? ''),
      ts: Number(meta.ts) || Date.now(),
      stored: false,
    }
    this.state.files[record.id] = record
    this.touch()
    return record
  }

  markFileStored(id, size) {
    const meta = this.state.files[id]
    if (meta === undefined) return null
    meta.stored = true
    if (Number.isFinite(size)) meta.size = size
    this.touch()
    return meta
  }

  async fileExists(id) {
    try {
      const info = await stat(this.filePath(id))
      return info.isFile()
    } catch {
      return false
    }
  }

  async removeFile(id) {
    try {
      await unlink(this.filePath(id))
    } catch {}
    delete this.state.files[id]
    this.touch()
  }

  /** 本机已存文件占用的总字节数。 */
  fileUsage() {
    let total = 0
    for (const meta of Object.values(this.state.files)) {
      if (meta?.stored === true) total += Number(meta.size) || 0
    }
    return total
  }

  /** 还能不能再收一个 size 字节的文件。 */
  canAcceptFile(size) {
    return this.fileUsage() + (Number(size) || 0) <= MAX_FILE_BYTES
  }

  /**
   * 回收文件：删掉「没有任何消息引用」且超过保留期的本地文件。
   * 以前 removeFile 从来没被调用过，上传目录会无限增长。
   * @returns {Promise<number>} 回收了几个
   */
  async collectFiles({ maxAgeMs = FILE_MAX_AGE_MS } = {}) {
    const referenced = await this._referencedFileIds()
    const now = Date.now()
    let removed = 0
    for (const meta of Object.values(this.state.files)) {
      if (meta?.stored !== true) continue
      if (referenced.has(meta.id)) continue
      const ts = Number(meta.ts) || 0
      if (now - ts < maxAgeMs) continue
      await this.removeFile(meta.id)
      removed += 1
    }
    if (removed > 0) await this.saveNow()
    return removed
  }

  /** 扫一遍所有会话日志，收集仍被引用的 file id。 */
  async _referencedFileIds() {
    const out = new Set()
    const dir = this.messagesDir
    let entries = []
    try {
      entries = await readdir(dir)
    } catch {
      return out
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue
      let text = ''
      try {
        text = await readFile(join(dir, name), 'utf8')
      } catch {
        continue
      }
      // 直接扫文本比逐行 JSON.parse 快，且这里只需要 file id。
      for (const match of text.matchAll(/"file"\s*:\s*\{[^}]*"id"\s*:\s*"([A-Za-z0-9_-]{1,64})"/gu)) {
        out.add(match[1])
      }
    }
    return out
  }
}

/** 默认昵称：主机名（去掉 .local 之类的尾巴）。 */
export function defaultNickname() {
  const base = hostname().replace(/\.(local|lan|localdomain)$/iu, '')
  return base.length > 0 ? base : 'DSH 用户'
}
