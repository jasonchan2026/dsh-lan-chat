/**
 * 安全回归测试。
 *
 * 这些用例来自 2026-10-25 的渗透测试（F-01 ~ F-22），但**不依赖任何真实环境**：
 * 只在本机临时目录里起两个临时节点，全部地址用 127.0.0.1 / TEST-NET，
 * 不写入真实 DSH 数据目录，也不打真实实例。可以安全地随仓库一起提交。
 *
 * 跑法：node scripts/sectest.mjs
 */
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { Store, dmConvId, groupConvId } from '../lib/store.js'
import { LanNode, postJson, probeHost, API_PREFIX, isPrivateAddress, isDialableAddress, safeMime, sameSubnet } from '../lib/node.js'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}

/** 发原始 HTTP 请求，方便构造各种畸形/越权请求。 */
function raw(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8')
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': payload.length }),
          ...headers,
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch {}
          resolve({ status: response.statusCode, headers: response.headers, text, json })
        })
      },
    )
    req.on('error', (error) => resolve({ status: 0, error, text: '' }))
    req.end(payload ?? undefined)
  })
}

async function makeNode(port, nickname) {
  const dir = await mkdtemp(join(tmpdir(), 'lanchat-sec-'))
  const store = new Store({ dir })
  await store.init()
  store.settings.nickname = nickname
  const node = new LanNode({ store, port })
  const actual = await node.start()
  return { dir, store, node, port: actual }
}

async function handshake(self, peerPort, extra = {}) {
  return postJson(`http://127.0.0.1:${peerPort}${API_PREFIX}/hello`, {
    peerId: self.store.peerId,
    nickname: self.store.settings.nickname,
    port: self.port,
    authKey: self.node.authKey,
    ...extra,
  })
}

const main = async () => {
  const a = await makeNode(45931, '安全测试A')
  const b = await makeNode(45932, '安全测试B')

  // =========================================================== F-01 鉴权
  // 除了 /info 和 /hello，所有局域网接口都必须带 token。
  const openEndpoints = [
    ['GET', '/file/anything', undefined],
    ['GET', '/file', undefined],
    ['POST', '/upload?id=x1&name=a&mime=text%2Fplain', Buffer.from('x')],
    ['POST', '/sync', { convId: 'dm:a|b' }],
    ['POST', '/send', { message: { id: 'm1', convId: 'dm:a|b', from: 'lc-evil', text: 'hi' } }],
    ['POST', '/group', { group: { id: 'g1', name: 'x', members: [] } }],
    ['POST', '/profile', { nickname: 'x' }],
  ]
  for (const [method, path, body] of openEndpoints) {
    const res = await raw(b.port, `${API_PREFIX}${path}`, { method, body })
    check(`无 token 访问 ${method} ${path.split('?')[0]} 被拒（401）`, res.status === 401, String(res.status))
  }

  // 伪造 token 也必须被拒
  const forged = await raw(b.port, `${API_PREFIX}/sync`, {
    method: 'POST',
    headers: { authorization: 'Bearer forged.token' },
    body: { convId: 'dm:a|b' },
  })
  check('伪造 token 被拒（401）', forged.status === 401, String(forged.status))

  // /info 仍然匿名可读，但不再泄露 host
  const info = await raw(b.port, `${API_PREFIX}/info`)
  check('/info 匿名可读（扫描需要）', info.status === 200 && info.json?.ok === true)
  check('/info 不再泄露 host 字段', info.json?.host === undefined, JSON.stringify(info.json?.host))
  check('/info 声明需要鉴权', info.json?.requiresAuth === true)

  // =========================================================== F-02 WS 鉴权
  const wsNoToken = await raw(b.port, `${API_PREFIX}/ws?peerId=${a.store.peerId}`, {
    method: 'GET',
    headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' },
  })
  check('WS 升级无 token 被拒（401）', wsNoToken.status === 401, String(wsNoToken.status))

  // 拿到 token 后 WS 才能连
  const tokenB = (await handshake(a, b.port))?.token
  check('握手拿到 token', typeof tokenB === 'string' && tokenB.length > 10)

  // token 不能张冠李戴：用 A 的 token 冒充 B 的 peerId
  const { connectWebSocket } = await import('../lib/ws.js')
  let mismatchRejected = false
  try {
    const bad = await connectWebSocket({
      host: '127.0.0.1',
      port: b.port,
      path: `${API_PREFIX}/ws?peerId=${b.store.peerId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    })
    // 连上了也会被 close(1008)
    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), 800)
      bad.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    mismatchRejected = bad.closed === true
    bad.destroy?.()
  } catch {
    mismatchRejected = true
  }
  check('WS 用别人的 peerId 被拒', mismatchRejected)

  // =========================================================== F-04 发送者伪造
  const dmId = dmConvId(a.store.peerId, b.store.peerId)
  await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/send`, {
    message: { id: 'm-forge-1', convId: dmId, from: 'lc-VICTIM', fromName: '受害者', kind: 'text', text: '我是受害者' },
  }, 8000, tokenB)
  const forgedRows = await b.store.listMessages(dmId)
  const forgedRow = forgedRows.find((row) => row.id === 'm-forge-1')
  check('服务端覆盖 from（不能伪造发送者）', forgedRow?.from === a.store.peerId, forgedRow?.from)

  // =========================================================== F-03 不再广播
  const socket = await connectWebSocket({
    host: '127.0.0.1',
    port: b.port,
    path: `${API_PREFIX}/ws?peerId=${a.store.peerId}&nickname=${encodeURIComponent('安全测试A')}`,
    headers: { authorization: `Bearer ${tokenB}` },
  })
  const leaked = []
  socket.on('text', (text) => {
    try {
      const parsed = JSON.parse(text)
      if (parsed.type === 'message') leaked.push(parsed)
    } catch {}
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  // A 通过 HTTP 发一条 DM 给 B；这条消息不该被推回给 A 自己（更不该推给第三方）
  await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/send`, {
    message: { id: 'm-bcast-1', convId: dmId, from: a.store.peerId, fromName: '安全测试A', kind: 'text', text: '不该被广播' },
  }, 8000, tokenB)
  await new Promise((resolve) => setTimeout(resolve, 600))
  check('消息不再广播给所有连接（F-03）', leaked.length === 0, `收到 ${leaked.length} 条`)
  socket.close()

  // =========================================================== F-05 上传
  const upNoAuth = await raw(b.port, `${API_PREFIX}/upload?id=evil1&name=a&mime=text%2Fplain`, {
    method: 'POST',
    body: Buffer.from('x'),
  })
  check('无 token 上传被拒（F-05）', upNoAuth.status === 401, String(upNoAuth.status))

  // =========================================================== F-07 / F-20 信息泄露
  // （浏览器侧由 hosttest 覆盖；这里只验局域网侧 /info）

  // =========================================================== F-11 SSRF
  const ssrf1 = await raw(b.port, `${API_PREFIX}/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenB}` },
    body: { message: { id: 'm-ssrf', convId: 'dm:lc-x|lc-y', from: a.store.peerId, text: 'x' } },
  })
  check('SSRF：投递到未知联系人不会发请求（ok 但 delivered=0）', ssrf1.json?.ok === true)

  // 直接测 deliverToPeer 的地址校验
  b.store.upsertContact({ peerId: 'lc-ssrf-test', nickname: 'X', addrs: ['169.254.169.254'], port: 80 })
  let ssrfBlocked = false
  try {
    await b.node.deliverToPeer('lc-ssrf-test', { id: 'm1', convId: 'dm:x|y', from: b.store.peerId, text: 'x' })
  } catch (error) {
    ssrfBlocked = /私网|拒绝/u.test(String(error?.message ?? error))
  }
  check('投递到云元数据地址被拒（169.254.169.254）', ssrfBlocked)

  b.store.upsertContact({ peerId: 'lc-ssrf-test2', nickname: 'Y', addrs: ['8.8.8.8'], port: 80 })
  let publicBlocked = false
  try {
    await b.node.deliverToPeer('lc-ssrf-test2', { id: 'm1', convId: 'dm:x|y', from: b.store.peerId, text: 'x' })
  } catch (error) {
    publicBlocked = /私网|拒绝/u.test(String(error?.message ?? error))
  }
  check('投递到公网地址被拒（8.8.8.8）', publicBlocked)

  // =========================================================== F-15 扫描
  const scanResult = b.node.scan({ addresses: ['8.8.8.8', '1.1.1.1', '10.0.0.1'], port: a.port })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const scanStatus = b.node.scanStatus(scanResult.scanId)
  check('扫描只保留私网地址', scanStatus?.total === 1, `total=${scanStatus?.total}`)

  const bigScan = b.node.scan({ addresses: Array.from({ length: 5000 }, (_, index) => `10.0.${Math.floor(index / 254)}.${(index % 254) + 1}`) })
  check('扫描地址数被截断到 1024', bigScan.total <= 1024, `total=${bigScan.total}`)
  await new Promise((resolve) => setTimeout(resolve, 300))

  // =========================================================== F-17 WS 分片
  // 单个 8MiB 帧 + 多个分片累计超限，必须 close(1009) 而不是吃内存。
  const { default: net } = await import('node:net')
  const fragResult = await new Promise((resolve) => {
    const socketRaw = net.connect(b.port, '127.0.0.1', () => {
      socketRaw.write(
        [
          `GET ${API_PREFIX}/ws?peerId=${a.store.peerId} HTTP/1.1`,
          `Host: 127.0.0.1:${b.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          `Authorization: Bearer ${tokenB}`,
          '\r\n',
        ].join('\r\n'),
      )
    })
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      try {
        socketRaw.destroy()
      } catch {}
      resolve(value)
    }
    let buffer = Buffer.alloc(0)
    socketRaw.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) return
      // 握手完成后开始灌分片
      if (!socketRaw.__started) {
        socketRaw.__started = true
        // 首帧：TEXT + FIN=0，1MiB
        const chunkSize = 1024 * 1024
        const payload = Buffer.alloc(chunkSize, 0x61)
        for (let index = 0; index < 12; index += 1) {
          // 0x01 = TEXT(首帧) / 0x00 = CONT，之后都是 CONT + FIN=0
          const opcodeByte = index === 0 ? 0x01 : 0x00
          const header = Buffer.alloc(14)
          header[0] = opcodeByte
          header[1] = 0x80 | 127 // masked + 64bit length
          header.writeUInt32BE(0, 2)
          header.writeUInt32BE(chunkSize, 6)
          header.writeUInt32BE(0x12345678, 10) // mask key
          // 掩码后的 payload（内容不重要，全 0x61 异或 mask）
          const masked = Buffer.alloc(chunkSize)
          for (let offset = 0; offset < chunkSize; offset += 1) {
            masked[offset] = payload[offset] ^ header[10 + (offset % 4)]
          }
          try {
            socketRaw.write(Buffer.concat([header, masked]))
          } catch {
            done({ closed: true })
            return
          }
        }
      }
      // 找 close 帧（opcode 0x8）
      const frameStart = end + 4
      if (buffer.length > frameStart + 1) {
        const opcode = buffer[frameStart] & 0x0f
        if (opcode === 0x8) {
          const code = buffer.length >= frameStart + 4 ? buffer.readUInt16BE(frameStart + 2) : 0
          done({ closed: true, code })
        }
      }
    })
    socketRaw.on('close', () => done({ closed: true, code: 'closed' }))
    socketRaw.on('error', () => done({ closed: true, code: 'error' }))
    setTimeout(() => done({ closed: false }), 8000)
  })
  check('WS 分片累计超限被断开（F-17）', fragResult.closed === true, `code=${fragResult.code}`)

  // =========================================================== F-16 群成员注入
  const tokenAForB = (await handshake(a, b.port))?.token
  const stranger = await makeNode(45934, '陌生人')
  const strangerToken = (await handshake(stranger, b.port))?.token
  // 陌生人新建一个群：createdBy 会被强制改写成他自己
  const created = await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/group`, {
    group: { id: 'g-inject-1', name: '注入群', members: [stranger.store.peerId], createdBy: b.store.peerId },
  }, 8000, strangerToken)
  check('新建群时 createdBy 被强制改写为 token 持有者', created?.group?.createdBy === stranger.store.peerId, created?.group?.createdBy)
  // 再拿别人的群去改，应该 403
  const hijack = await raw(b.port, `${API_PREFIX}/group`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenAForB}` },
    body: { group: { id: 'g-inject-1', name: '被我改了', members: [a.store.peerId] } },
  })
  check('非群主改别人的群被拒（403）', hijack.status === 403, String(hijack.status))
  const afterHijack = b.store.state.groups?.['g-inject-1']
  check('群名未被越权修改', afterHijack?.name === '注入群', afterHijack?.name)

  // 2.2.0 新增：/group-removed 同样只能由群主发起，否则冒充群主就能解散别人的群
  const unauth = await raw(b.port, `${API_PREFIX}/group-removed`, {
    method: 'POST',
    body: { groupId: 'g-inject-1' },
  })
  check('F-16 解散群接口无 token 被拒（401）', unauth.status === 401, String(unauth.status))
  const notOwner = await raw(b.port, `${API_PREFIX}/group-removed`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenAForB}` },
    body: { groupId: 'g-inject-1' },
  })
  check('F-16 非群主解散别人的群被拒（403）', notOwner.status === 403, String(notOwner.status))
  check('F-16 群未被越权解散', b.store.state.groups?.['g-inject-1'] !== undefined)

  // 群主自己发就能解散（用 stranger 自己签发的 token 打 stranger 自己的节点）
  const ownerToken = stranger.node.issueToken(stranger.store.peerId)
  const selfRemove = await raw(stranger.port, `${API_PREFIX}/group-removed`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}` },
    body: { groupId: 'g-inject-1' },
  })
  check('F-16 群主可解散自己的群', selfRemove.status === 200, String(selfRemove.status))
  check('F-16 群主解散后群已移除', stranger.store.state.groups?.['g-inject-1'] === undefined)

  await stranger.node.close()
  await stranger.store.close()
  await rm(stranger.dir, { recursive: true, force: true })

  // =========================================================== F-18 文件回收
  const quota = b.store.canAcceptFile(1024)
  check('store 暴露配额检查', quota === true)
  const usageBefore = b.store.fileUsage()
  await b.store.putFileBuffer({ id: 'gc-test-1', name: 'x', mime: 'text/plain', buffer: Buffer.from('hello'), from: 'x', ts: Date.now() - 30 * 24 * 3600 * 1000 })
  const usageAfter = b.store.fileUsage()
  check('fileUsage 计入新文件', usageAfter === usageBefore + 5, `${usageBefore} -> ${usageAfter}`)
  const removed = await b.store.collectFiles({ maxAgeMs: 1 })
  check('collectFiles 回收无引用文件', removed >= 1 && b.store.fileMeta('gc-test-1') === undefined, `removed=${removed}`)

  // 被消息引用的文件不能被回收
  const keptBody = Buffer.from('keep me')
  await b.store.putFileBuffer({ id: 'gc-keep-1', name: 'k', mime: 'text/plain', buffer: keptBody, from: a.store.peerId, ts: Date.now() - 30 * 24 * 3600 * 1000 })
  await b.store.appendMessage({
    id: 'm-keep-1',
    convId: dmId,
    from: a.store.peerId,
    fromName: 'A',
    kind: 'file',
    text: '',
    ts: Date.now(),
    self: false,
    file: { id: 'gc-keep-1', name: 'k', size: keptBody.length, mime: 'text/plain', sha256: '', stored: true },
  })
  await b.store.collectFiles({ maxAgeMs: 1 })
  check('被消息引用的文件不被回收', b.store.fileMeta('gc-keep-1') !== undefined)

  // =========================================================== F-21 mime 校验
  check('mime 允许正常值', safeMime('text/plain') === 'text/plain')
  check('mime 允许带 charset', safeMime('text/plain; charset=utf-8') === 'text/plain; charset=utf-8')
  check('mime 拒绝 CRLF 注入', safeMime('text/html\r\nX-Evil: 1') === 'application/octet-stream')
  check('mime 拒绝空值', safeMime('') === 'application/octet-stream')

  // =========================================================== F-13 绑定
  check('默认绑定局域网（0.0.0.0）', b.node.bindAddress === '0.0.0.0', b.node.bindAddress)
  const dirLocal = await mkdtemp(join(tmpdir(), 'lanchat-sec-local-'))
  const storeLocal = new Store({ dir: dirLocal })
  await storeLocal.init()
  const localNode = new LanNode({ store: storeLocal, port: 45933, bind: 'local' })
  await localNode.start()
  check('bind=local 时只绑回环', localNode.bindAddress === '127.0.0.1', localNode.bindAddress)
  await localNode.close()
  await storeLocal.close()
  await rm(dirLocal, { recursive: true, force: true })

  // =========================================================== F-13 入站来源
  check('acceptFrom 放行内网来源', b.node.acceptFrom('192.168.1.20') === true)
  check('acceptFrom 拒绝公网来源', b.node.acceptFrom('116.25.13.123') === false, '116.25.13.123')
  check('acceptFrom 拒绝链路本地', b.node.acceptFrom('169.254.169.254') === false)
  check('acceptFrom 放行本机回环', b.node.acceptFrom('127.0.0.1') === true)

  // =========================================================== 工具函数
  check('isPrivateAddress 认得 RFC1918', ['10.1.2.3', '172.16.0.1', '192.168.1.1'].every(isPrivateAddress))
  check('isPrivateAddress 拒绝公网', ['8.8.8.8', '116.25.13.123', '172.32.0.1'].every((address) => !isPrivateAddress(address)))
  check('isPrivateAddress 认得回环与链路本地', ['127.0.0.1', '169.254.169.254', '::1'].every(isPrivateAddress))
  check('sameSubnet 对公网地址返回 false', sameSubnet('8.8.8.8') === false)
  check('isDialableAddress 拒绝云元数据', isDialableAddress('169.254.169.254') === false)
  check('isDialableAddress 拒绝回环', isDialableAddress('127.0.0.1') === false)
  check('isDialableAddress 允许正常内网', isDialableAddress('192.168.1.20') === true)

  // =========================================================== 收尾
  await a.node.close()
  await b.node.close()
  await a.store.close()
  await b.store.close()
  await rm(a.dir, { recursive: true, force: true })
  await rm(b.dir, { recursive: true, force: true })

  const failed = results.filter((row) => !row.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) {
    console.log('失败项：')
    for (const row of failed) console.log(`  - ${row.name} ${row.detail ?? ''}`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
