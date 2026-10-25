/**
 * dsh-lan-chat · 最小 WebSocket 实现（RFC 6455 服务端 + 客户端）
 *
 * 为什么不用 `ws` 包：本插件必须能在完全离线的隔离网内工作，不能假定
 * profile 里恰好装了解析得到的第三方依赖。这里只用 node:crypto /
 * node:net 手写帧编解码，覆盖聊天所需的文本帧、二进制帧、ping/pong、
 * 分片与关闭握手；不做扩展协商（permessage-deflate 一律不选）。
 *
 * @module dsh-lan-chat/ws
 */
import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { connect } from 'node:net'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 帧操作码。 */
export const OPCODE = {
  CONT: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
}

/** 单条消息上限（默认 8 MiB，文件走 HTTP 不占这个额度）。 */
const MAX_PAYLOAD = 8 * 1024 * 1024

/** 计算 Sec-WebSocket-Accept。 */
export function acceptKey(clientKey) {
  return createHash('sha1').update(`${clientKey}${GUID}`).digest('base64')
}

/** 编一帧（服务端 → 客户端不加掩码）。 */
export function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
  const length = data.length
  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  header[0] = 0x80 | (opcode & 0x0f)
  return Buffer.concat([header, data])
}

/** 编一帧（客户端 → 服务端必须加掩码）。 */
export function encodeFrameMasked(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
  const length = data.length
  const mask = randomBytes(4)
  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = 0x80 | length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 0x80 | 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  header[0] = 0x80 | (opcode & 0x0f)
  const masked = Buffer.allocUnsafe(length)
  for (let index = 0; index < length; index += 1) masked[index] = data[index] ^ mask[index & 3]
  return Buffer.concat([header, mask, masked])
}

/**
 * 一条 WebSocket 连接。事件：
 *   'text'   (string)
 *   'binary' (Buffer)
 *   'close'  (code, reason)
 *   'error'  (Error)
 */
export class WebSocketConnection extends EventEmitter {
  /** @param {import('node:net').Socket} socket @param {{masked?: boolean, role?: string}} options */
  constructor(socket, options = {}) {
    super()
    this.socket = socket
    this.masked = options.masked === true
    this.role = options.role ?? 'server'
    this.closed = false
    this._buffer = Buffer.alloc(0)
    this._fragments = []
    this._fragmentOpcode = 0
    this._fragmentBytes = 0
    this.remoteAddress = socket.remoteAddress ?? ''
    this.remotePort = socket.remotePort ?? 0

    socket.setNoDelay?.(true)
    socket.on('data', (chunk) => this._onData(chunk))
    socket.on('error', (error) => {
      this._finish(1006, 'socket error')
      this.emit('error', error)
    })
    socket.on('close', () => this._finish(1006, 'socket closed'))
    socket.on('end', () => this._finish(1000, 'socket ended'))
  }

  _onData(chunk) {
    if (this.closed) return
    this._buffer = this._buffer.length === 0 ? chunk : Buffer.concat([this._buffer, chunk])
    while (this._tryFrame()) {
      // 继续消费
    }
  }

  /** 从缓冲区切一帧；返回是否消费成功。 */
  _tryFrame() {
    const buffer = this._buffer
    if (buffer.length < 2) return false
    const first = buffer[0]
    const second = buffer[1]
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let offset = 2
    if (length === 126) {
      if (buffer.length < 4) return false
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (buffer.length < 10) return false
      const big = buffer.readBigUInt64BE(2)
      if (big > BigInt(MAX_PAYLOAD)) {
        this.close(1009, 'message too big')
        return false
      }
      length = Number(big)
      offset = 10
    }
    if (length > MAX_PAYLOAD) {
      this.close(1009, 'message too big')
      return false
    }
    let maskKey = null
    if (masked) {
      if (buffer.length < offset + 4) return false
      maskKey = buffer.subarray(offset, offset + 4)
      offset += 4
    }
    if (buffer.length < offset + length) return false

    const payload = Buffer.from(buffer.subarray(offset, offset + length))
    if (maskKey !== null) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= maskKey[index & 3]
    }
    this._buffer = buffer.subarray(offset + length)
    this._dispatch(fin, opcode, payload)
    return true
  }

  _dispatch(fin, opcode, payload) {
    switch (opcode) {
      case OPCODE.CONT: {
        if (this._fragmentOpcode === 0) return
        // 累计上限：单帧有 MAX_PAYLOAD，但无限多帧累加会把内存吃光。
        this._fragmentBytes += payload.length
        if (this._fragmentBytes > MAX_PAYLOAD) {
          this._fragments = []
          this._fragmentOpcode = 0
          this._fragmentBytes = 0
          this.close(1009, 'message too big')
          return
        }
        this._fragments.push(payload)
        if (!fin) return
        const whole = Buffer.concat(this._fragments)
        const kind = this._fragmentOpcode
        this._fragments = []
        this._fragmentOpcode = 0
        this._fragmentBytes = 0
        this._deliver(kind, whole)
        return
      }
      case OPCODE.TEXT:
      case OPCODE.BINARY: {
        if (!fin) {
          this._fragmentOpcode = opcode
          this._fragments = [payload]
          this._fragmentBytes = payload.length
          return
        }
        this._deliver(opcode, payload)
        return
      }
      case OPCODE.PING: {
        this._write(OPCODE.PONG, payload)
        return
      }
      case OPCODE.PONG:
        return
      case OPCODE.CLOSE: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : ''
        if (!this.closed) {
          this._write(OPCODE.CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0))
          this._finish(code, reason)
        }
        return
      }
      default:
        this.close(1002, 'unknown opcode')
    }
  }

  _deliver(opcode, payload) {
    if (opcode === OPCODE.TEXT) this.emit('text', payload.toString('utf8'))
    else this.emit('binary', payload)
  }

  _write(opcode, payload) {
    if (this.closed || this.socket.destroyed) return
    try {
      const frame = this.masked ? encodeFrameMasked(opcode, payload) : encodeFrame(opcode, payload)
      this.socket.write(frame)
    } catch (error) {
      this._finish(1006, 'write failed')
    }
  }

  /** 发文本帧。 */
  send(text) {
    this._write(OPCODE.TEXT, Buffer.from(String(text), 'utf8'))
  }

  /** 发 JSON。 */
  sendJson(value) {
    this.send(JSON.stringify(value))
  }

  /** 发二进制帧。 */
  sendBinary(buffer) {
    this._write(OPCODE.BINARY, buffer)
  }

  /** 主动关闭。 */
  close(code = 1000, reason = '') {
    if (this.closed) return
    const reasonBuf = Buffer.from(String(reason), 'utf8')
    const payload = Buffer.alloc(2 + reasonBuf.length)
    payload.writeUInt16BE(code, 0)
    reasonBuf.copy(payload, 2)
    this._write(OPCODE.CLOSE, payload)
    this._finish(code, reason)
    try {
      this.socket.end()
    } catch {}
    setTimeout(() => {
      try {
        this.socket.destroy()
      } catch {}
    }, 1000).unref?.()
  }

  _finish(code, reason) {
    if (this.closed) return
    this.closed = true
    this._buffer = Buffer.alloc(0)
    this._fragments = []
    this._fragmentOpcode = 0
    this._fragmentBytes = 0
    this.emit('close', code, reason)
  }

  destroy() {
    this._finish(1006, 'destroyed')
    try {
      this.socket.destroy()
    } catch {}
  }
}

/** 解析 HTTP 头，返回小写 key → value（重复头用逗号拼接）。 */
function parseHeaders(text) {
  const headers = {}
  for (const line of text.split('\r\n')) {
    if (line === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    headers[key] = headers[key] === undefined ? value : `${headers[key]}, ${value}`
  }
  return headers
}

/**
 * 从已升级的 socket 上完成服务端握手。调用方负责先把 HTTP 头读出来。
 * @param {import('node:net').Socket} socket
 * @param {Record<string, string>} headers
 * @param {Buffer} rest 头之后残留的字节
 * @returns {WebSocketConnection | null}
 */
export function acceptUpgrade(socket, headers, rest) {
  const key = headers['sec-websocket-key']
  const upgrade = (headers.upgrade ?? '').toLowerCase()
  if (key === undefined || upgrade !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    return null
  }
  const response = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    '\r\n',
  ].join('\r\n')
  socket.write(response)
  const connection = new WebSocketConnection(socket, { masked: false, role: 'server' })
  // 与握手同一个 TCP 包里的首帧要延后一拍再投递：调用方拿回连接后
  // 才能先挂好监听器，否则 'ready' 之类的首帧会丢。
  if (rest !== undefined && rest.length > 0) setImmediate(() => connection._onData(rest))
  return connection
}

/**
 * 在一个 http server 的 'upgrade' 事件上完成握手。
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head
 */
export function acceptUpgradeFromHttp(request, socket, head) {
  const headers = {}
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const key = String(request.rawHeaders[index]).toLowerCase()
    const value = String(request.rawHeaders[index + 1])
    headers[key] = headers[key] === undefined ? value : `${headers[key]}, ${value}`
  }
  return acceptUpgrade(socket, headers, head)
}

/**
 * 客户端：连到 ws://host:port/path。
 * @param {{host: string, port: number, path?: string, timeoutMs?: number, headers?: Record<string,string>}} options
 * @returns {Promise<WebSocketConnection>}
 */
export function connectWebSocket(options) {
  return new Promise((resolve, reject) => {
    const path = options.path ?? '/'
    const key = randomBytes(16).toString('base64')
    const socket = connect({ host: options.host, port: options.port })
    const timeoutMs = options.timeoutMs ?? 8000
    let settled = false
    let buffer = Buffer.alloc(0)

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(`websocket: connect timeout ${options.host}:${options.port}`))
    }, timeoutMs)
    timer.unref?.()

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('error', onError)
      socket.off('connect', onConnect)
      socket.off('data', onData)
      socket.off('close', onClose)
    }

    const onError = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onClose = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`websocket: closed before handshake ${options.host}:${options.port}`))
    }
    const onConnect = () => {
      const hostHeader = options.host.includes(':') ? `[${options.host}]:${options.port}` : `${options.host}:${options.port}`
      const extra = Object.entries(options.headers ?? {}).map(([name, value]) => `${name}: ${value}`)
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${hostHeader}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          ...extra,
          '\r\n',
        ].join('\r\n'),
      )
    }
    const onData = (chunk) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) {
        if (buffer.length > 64 * 1024) {
          settled = true
          cleanup()
          socket.destroy()
          reject(new Error('websocket: handshake response too large'))
        }
        return
      }
      const head = buffer.subarray(0, end).toString('utf8')
      const rest = buffer.subarray(end + 4)
      const [statusLine, ...headerLines] = head.split('\r\n')
      const status = Number((statusLine ?? '').split(' ')[1])
      if (status !== 101) {
        settled = true
        cleanup()
        socket.destroy()
        reject(new Error(`websocket: handshake rejected (${statusLine ?? 'no status'})`))
        return
      }
      const headers = parseHeaders(headerLines.join('\r\n'))
      if (headers['sec-websocket-accept'] !== acceptKey(key)) {
        settled = true
        cleanup()
        socket.destroy()
        reject(new Error('websocket: bad accept key'))
        return
      }
      settled = true
      cleanup()
      const connection = new WebSocketConnection(socket, { masked: true, role: 'client' })
      // 同上：首帧延后一拍，让调用方先挂监听器
      if (rest.length > 0) setImmediate(() => connection._onData(rest))
      resolve(connection)
    }

    socket.on('error', onError)
    socket.on('close', onClose)
    socket.on('connect', onConnect)
    socket.on('data', onData)
  })
}
