/**
 * 离线自测：两个节点互发消息 / 传文件 / 建群 / 扫描发现。
 * 不依赖 DSH，直接跑 node scripts/selftest.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store, dmConvId, groupConvId } from '../lib/store.js'
import { LanNode, probeHost, localSubnets, expandCidr, localAddresses, postJson, API_PREFIX } from '../lib/node.js'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}

async function makeNode(port, nickname) {
  const dir = await mkdtemp(join(tmpdir(), 'lanchat-'))
  const store = new Store({ dir })
  await store.init()
  store.settings.nickname = nickname
  // 两个节点都在本机，扫描/投递都走 127.0.0.1；真实部署不开这个开关。
  const node = new LanNode({ store, port, allowLoopback: true })
  const actual = await node.start()
  return { dir, store, node, port: actual }
}

/** 用 authKey 走一次 /hello，拿到对端签发的 token。 */
async function handshake(self, peerPort) {
  const hello = await postJson(`http://127.0.0.1:${peerPort}${API_PREFIX}/hello`, {
    peerId: self.store.peerId,
    nickname: self.store.settings.nickname,
    port: self.port,
    authKey: self.node.authKey,
  })
  if (hello?.ok !== true || typeof hello.token !== 'string') throw new Error(`handshake failed: ${hello?.error}`)
  return hello.token
}

const main = async () => {
  const a = await makeNode(45901, '节点A')
  const b = await makeNode(45902, '节点B')
  check('两个节点都在监听', a.port > 0 && b.port > 0, `${a.port} / ${b.port}`)

  // ---- 1. 身份探测
  const probed = await probeHost('127.0.0.1', b.port, 2000)
  check('probeHost 能认出节点B', probed?.peerId === b.store.peerId, probed?.nickname)

  // ---- 2. 握手 + 联系人
  a.store.upsertContact({
    peerId: b.store.peerId,
    nickname: '节点B',
    addrs: ['127.0.0.1'],
    port: b.port,
    added: true,
    addedAt: Date.now(),
  })
  b.store.upsertContact({
    peerId: a.store.peerId,
    nickname: '节点A',
    addrs: ['127.0.0.1'],
    port: a.port,
    added: true,
    addedAt: Date.now(),
  })

  // ---- 3. 单聊消息（HTTP 投递）
  const dmId = dmConvId(a.store.peerId, b.store.peerId)
  const text = `你好，这是离线测试 ${Date.now()}`
  const received = new Promise((resolve) => {
    b.node.once('message', resolve)
  })
  const tokenForB = await handshake(a, b.port)
  const sent = await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/send`, {
    message: {
      id: 'm-test-1',
      convId: dmId,
      from: a.store.peerId,
      fromName: '节点A',
      kind: 'text',
      text,
      ts: Date.now(),
    },
  }, 8000, tokenForB)
  check('消息投递返回 ok', sent?.ok === true)
  const got = await Promise.race([received, new Promise((resolve) => setTimeout(() => resolve(null), 3000))])
  check('节点B 收到消息事件', got?.text === text, got?.text)
  const bMessages = await b.store.listMessages(dmId)
  check('节点B 落盘了这条消息', bMessages.length === 1 && bMessages[0].text === text)

  // ---- 4. 幂等：同 id 重发不重复
  await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/send`, {
    message: { id: 'm-test-1', convId: dmId, from: a.store.peerId, kind: 'text', text, ts: Date.now() },
  }, 8000, tokenForB)
  const after = await b.store.listMessages(dmId)
  check('重复 id 不产生重复消息', after.length === 1, `count=${after.length}`)

  // ---- 5. WebSocket 实时推送
  const { connectWebSocket } = await import('../lib/ws.js')
  const socket = await connectWebSocket({
    host: '127.0.0.1',
    port: b.port,
    path: `${API_PREFIX}/ws?peerId=${a.store.peerId}&nickname=${encodeURIComponent('节点A')}`,
    headers: { authorization: `Bearer ${tokenForB}` },
  })
  check('WebSocket 握手成功', socket.closed === false)

  /** 收下一帧 JSON（带超时）。 */
  const nextFrame = (timeoutMs = 3000) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        socket.off('text', onText)
        resolve(null)
      }, timeoutMs)
      const onText = (raw) => {
        clearTimeout(timer)
        socket.off('text', onText)
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve(null)
        }
      }
      socket.on('text', onText)
    })

  const ready = await nextFrame()
  check('WS 收到 ready 帧', ready?.type === 'ready' && ready.peerId === b.store.peerId, ready?.type)

  const localEvent = new Promise((resolve) => b.node.once('message', resolve))
  const echo = nextFrame(1200)
  socket.sendJson({
    type: 'message',
    message: { id: 'm-test-2', convId: dmId, from: a.store.peerId, fromName: '节点A', kind: 'text', text: '走 WS 的消息', ts: Date.now() },
  })
  // 关键回归点：消息不再广播给所有连接，发送方不会收到自己的回显。
  const echoed = await echo
  check('消息不再广播回发送方', echoed === null, echoed?.type)
  const localGot = await Promise.race([localEvent, new Promise((resolve) => setTimeout(() => resolve(null), 3000))])
  check('对端本地收到消息事件', localGot?.text === '走 WS 的消息', localGot?.text)
  const bAfterWs = await b.store.listMessages(dmId)
  check('WS 消息已落盘', bAfterWs.some((row) => row.text === '走 WS 的消息'), `count=${bAfterWs.length}`)
  check('节点B 认为 A 在线', b.node.sockets.has(a.store.peerId))

  // 服务端 → 客户端的主动推送
  const pushPromise = nextFrame()
  b.node.pushTo(a.store.peerId, { type: 'notice', text: '来自服务端的推送' })
  const pushed = await pushPromise
  check('服务端可主动推送到客户端', pushed?.type === 'notice' && pushed.text === '来自服务端的推送')

  // 大帧（>125 字节，走 16 位长度分支）与 >64KiB 的帧
  const longText = '长'.repeat(4000)
  const bigEvent = new Promise((resolve) => b.node.once('message', resolve))
  socket.sendJson({
    type: 'message',
    message: { id: 'm-test-3', convId: dmId, from: a.store.peerId, fromName: '节点A', kind: 'text', text: longText, ts: Date.now() + 1 },
  })
  const bigGot = await Promise.race([bigEvent, new Promise((resolve) => setTimeout(() => resolve(null), 5000))])
  check('超过 64KiB 的帧能正确收发', bigGot?.text?.length === longText.length, `${bigGot?.text?.length} 字符`)

  // ---- 6. 文件传输
  const fileBody = Buffer.from(`离线文件内容 ${Date.now()}\n`.repeat(20), 'utf8')
  const uploadQuery = `id=f-test-1&name=${encodeURIComponent('测试 文件.txt')}&mime=text%2Fplain&from=${encodeURIComponent(a.store.peerId)}`
  const uploaded = await new Promise((resolve) => {
    const req = (globalThis.__http ??= undefined)
    import('node:http').then(({ request }) => {
      const r = request(
        { host: '127.0.0.1', port: b.port, path: `${API_PREFIX}/upload?${uploadQuery}`, method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': fileBody.length, authorization: `Bearer ${tokenForB}` } },
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
      r.on('error', () => resolve(null))
      r.end(fileBody)
    })
  })
  check('文件上传成功', uploaded?.ok === true, `${uploaded?.file?.size} bytes`)
  check('上传后 sha256 已计算', typeof uploaded?.file?.sha256 === 'string' && uploaded.file.sha256.length === 64)
  const downloaded = await new Promise((resolve) => {
    import('node:http').then(({ request }) => {
      const r = request({ host: '127.0.0.1', port: b.port, path: `${API_PREFIX}/file/f-test-1`, method: 'GET', headers: { authorization: `Bearer ${tokenForB}` } }, (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks)))
      })
      r.on('error', () => resolve(null))
      r.end()
    })
  })
  check('文件下载内容一致', Buffer.isBuffer(downloaded) && downloaded.equals(fileBody), `${downloaded?.length} bytes`)

  // ---- 7. 群
  const group = b.store.createGroup({ name: '测试群', members: [b.store.peerId, a.store.peerId], createdBy: b.store.peerId })
  const groupConv = groupConvId(group.id)
  const tokenForA = await handshake(b, a.port)
  const groupSync = await postJson(`http://127.0.0.1:${a.port}${API_PREFIX}/group`, { group }, 8000, tokenForA)
  check('群资料同步成功', groupSync?.ok === true)
  check('节点A 有了这个群', a.store.myGroups().some((row) => row.id === group.id))
  await b.store.appendMessage({ id: 'm-g1', convId: groupConv, from: b.store.peerId, fromName: '节点B', kind: 'text', text: '群里说话', ts: Date.now() })
  const groupMessages = await b.store.listMessages(groupConv)
  check('群消息落盘', groupMessages.length === 1)

  // ---- 8. 扫描
  const scan = b.node.scan({ addresses: ['127.0.0.1', '127.0.0.2', '127.0.0.3'], port: a.port })
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const status = b.node.scanStatus(scan.scanId)
  check('扫描完成', status?.finished === true, `${status?.done}/${status?.total}`)
  check('扫描发现节点A', status?.peers?.some((peer) => peer.peerId === a.store.peerId), JSON.stringify(status?.peers?.map((p) => p.nickname)))

  // ---- 9. 网段工具
  const expanded = expandCidr('192.168.1.0/24')
  check('expandCidr 展开 /24', expanded.length === 254 && expanded[0] === '192.168.1.1', `first=${expanded[0]} last=${expanded.at(-1)}`)
  check('expandCidr 拒绝坏输入', expandCidr('abc').length === 0 && expandCidr('1.2.3.4/40').length === 0)
  const subnets = localSubnets()
  check('localSubnets 返回 /24', subnets.every((row) => row.endsWith('/24')), subnets.join(','))

  // ---- 10. 鉴权
  b.store.settings.accessCode = 'secret-code'
  const denied = await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/hello`, { peerId: 'x', accessCode: 'wrong' })
  check('错误访问码被拒', denied?.ok === false, denied?.error)
  const allowed = await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/hello`, {
    peerId: a.store.peerId,
    nickname: '节点A',
    port: a.port,
    accessCode: 'secret-code',
    authKey: a.node.authKey,
  })
  check('正确访问码放行', allowed?.ok === true, allowed?.error)
  check('握手返回 token', typeof allowed?.token === 'string' && allowed.token.length > 10)
  // 身份密钥不对：即使访问码正确也要拒绝（防顶替已有节点）。
  const impostor = await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/hello`, {
    peerId: a.store.peerId,
    nickname: '假节点A',
    port: a.port,
    accessCode: 'secret-code',
    authKey: 'not-the-real-key',
  })
  check('冒用 peerId 被拒（authKey 不匹配）', impostor?.ok === false, impostor?.error)
  // 无 token 访问受保护接口
  const noToken = await postJson(`http://127.0.0.1:${b.port}${API_PREFIX}/send`, {
    message: { id: 'm-x', convId: dmId, from: a.store.peerId, kind: 'text', text: 'no token' },
  })
  check('无 token 投递被拒（401）', noToken?.ok === false)

  // ---- 11. 持久化
  const beforeRestart = await b.store.listMessages(dmId)
  await b.store.close()
  const store2 = new Store({ dir: b.dir })
  await store2.init()
  const afterRestart = await store2.listMessages(dmId)
  check('重启后消息仍在', afterRestart.length === beforeRestart.length, `${afterRestart.length} 条`)
  check('重启后身份不变', store2.peerId === b.store.peerId)
  await store2.close()

  // ---- 收尾
  socket.close()
  await a.node.close()
  await b.node.close()
  await a.store.close()
  await rm(a.dir, { recursive: true, force: true })
  await rm(b.dir, { recursive: true, force: true })

  const failed = results.filter((row) => !row.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) {
    console.log('失败项：')
    for (const row of failed) console.log(`  - ${row.name} ${row.detail ?? ''}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
