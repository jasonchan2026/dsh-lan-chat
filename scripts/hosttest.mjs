/**
 * 宿主半侧集成自测：用假的 Cordis ctx 起 startHost，然后把所有
 * /lan-chat/... 路由当成真实 HTTP 客户端打一遍。
 *
 * 跑法：node scripts/hosttest.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request } from 'node:http'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}

/** 极简 Cordis ctx：只有 webServer.register + logger + on。 */
function makeCtx() {
  const routes = new Map()
  const handlers = { dispose: [] }
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    webServer: {
      register(route) {
        if (routes.has(route.path)) throw new Error(`webserver: duplicate exact route "${route.path}"`)
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    on(event, handler) {
      ;(handlers[event] ??= []).push(handler)
    },
    routes,
    handlers,
  }
  return ctx
}

/** 起一个只服务 ctx.routes 的 HTTP 服务。 */
function serveRoutes(ctx) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const handler = ctx.routes.get(url.pathname)
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'no route' }))
      return
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error) }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

/** 发一个 JSON 请求。 */
function call(port, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8')
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(payload === null ? {} : { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', 'content-length': payload.length }),
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks)
          let json = null
          try {
            json = JSON.parse(raw.toString('utf8'))
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, json, raw })
        })
      },
    )
    req.on('error', (error) => resolve({ status: 0, error }))
    req.end(payload ?? undefined)
  })
}

const main = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanchat-host-'))
  const { startHost } = await import('../lib/index.js')
  const ctx = makeCtx()

  const host = await startHost(ctx, { dataDir: dir, port: 45911, nickname: '测试主机' })
  check('startHost 返回句柄', host !== null && host.node !== undefined)
  check('局域网端口已监听', host.port === 45911, String(host.port))
  check('注册了全部路由', ctx.routes.size >= 20, `${ctx.routes.size} 条`)

  const { server, port } = await serveRoutes(ctx)
  const api = (path, options) => call(port, `/lan-chat${path}`, options)

  // ---- 状态
  const state = await api('/state')
  check('GET /state 返回 ok', state.json?.ok === true)
  check('/state 带 peerId 与昵称', state.json?.self?.peerId === host.store.peerId && state.json?.self?.nickname === '测试主机', state.json?.self?.nickname)
  check('/state 报告已监听', state.json?.listening === true && state.json?.startError === null)
  check('/state 带本机地址', Array.isArray(state.json?.self?.addresses) && state.json.self.addresses.length > 0)

  // ---- 设置
  const badOrigin = await api('/settings', { method: 'POST', body: { nickname: '黑客' }, headers: { origin: 'http://evil.example.com' } })
  check('跨站写设置被拒（403）', badOrigin.status === 403, String(badOrigin.status))
  const sameOrigin = await api('/settings', { method: 'POST', body: { nickname: '改过的名字' }, headers: { origin: `http://127.0.0.1:${port}` } })
  check('同源写设置通过', sameOrigin.json?.ok === true && sameOrigin.json.settings.nickname === '改过的名字', sameOrigin.json?.settings?.nickname)
  const setCode = await api('/settings', { method: 'POST', body: { accessCode: 'p@ss', autoDiscover: false } })
  check('可设置访问码', setCode.json?.settings?.accessCode === 'p@ss')
  await api('/settings', { method: 'POST', body: { accessCode: '', autoDiscover: true } })

  // ---- 联系人
  const emptyContacts = await api('/contacts')
  check('初始没有联系人', emptyContacts.json?.contacts?.length === 0)

  const addedSelf = await api('/contacts/add', { method: 'POST', body: { peerId: host.store.peerId } })
  check('不能添加自己', addedSelf.status === 400, addedSelf.json?.error)

  const fakePeer = 'lc-peer-b'
  const added = await api('/contacts/add', { method: 'POST', body: { peerId: fakePeer, nickname: '同事B', addrs: ['127.0.0.1'], port: 45912 } })
  check('添加联系人成功', added.json?.ok === true && added.json.contact.added === true)
  const contacts = await api('/contacts')
  check('联系人列表里有它', contacts.json?.contacts?.some((row) => row.peerId === fakePeer))

  const convs = await api('/conversations')
  check('会话列表出现该单聊', convs.json?.conversations?.some((row) => row.kind === 'dm' && row.peerId === fakePeer), JSON.stringify(convs.json?.conversations?.map((r) => r.kind)))

  // ---- 发消息（对端不在线 → delivered 0，但本地必须落盘）
  const dmConv = convs.json.conversations.find((row) => row.peerId === fakePeer).convId
  const sent = await api('/send', { method: 'POST', body: { convId: dmConv, text: '第一条本地消息' } })
  check('发消息返回 ok', sent.json?.ok === true, `delivered=${sent.json?.delivered}`)
  check('离线对端 delivered=0', sent.json?.delivered === 0)

  const emptySend = await api('/send', { method: 'POST', body: { convId: dmConv, text: '   ' } })
  check('空消息被拒', emptySend.status === 400, emptySend.json?.error)

  const msgs = await api(`/messages?convId=${encodeURIComponent(dmConv)}`)
  check('消息能读回', msgs.json?.messages?.length === 1 && msgs.json.messages[0].text === '第一条本地消息')
  check('消息标记为 self', msgs.json?.messages?.[0]?.self === true)

  const afterSend = await api('/conversations')
  const dmSummary = afterSend.json.conversations.find((row) => row.convId === dmConv)
  check('会话摘要带最后一条预览', dmSummary?.lastText === '第一条本地消息', dmSummary?.lastText)

  const read = await api('/read', { method: 'POST', body: { convId: dmConv, ts: Date.now() } })
  check('标记已读成功', read.json?.ok === true)

  // ---- 群
  const group = await api('/groups/create', { method: 'POST', body: { name: '项目组', members: [fakePeer] } })
  check('建群成功', group.json?.ok === true && group.json.group.members.includes(host.store.peerId), group.json?.group?.name)
  const groupConv = group.json.convId
  check('建群产生系统消息', (await api(`/messages?convId=${encodeURIComponent(groupConv)}`)).json?.messages?.[0]?.kind === 'system')

  const groupSend = await api('/send', { method: 'POST', body: { convId: groupConv, text: '群里的第一条' } })
  check('群消息发送成功', groupSend.json?.ok === true)

  const renamed = await api('/groups/update', { method: 'POST', body: { groupId: group.json.group.id, name: '改名后的群' } })
  check('改群名成功', renamed.json?.group?.name === '改名后的群')

  const groups = await api('/groups')
  check('群列表包含它', groups.json?.groups?.some((row) => row.id === group.json.group.id))

  // ---- 文件
  const fileBody = Buffer.from('这是宿主侧上传的文件内容\n'.repeat(50), 'utf8')
  const uploaded = await api(`/upload?convId=${encodeURIComponent(dmConv)}&name=${encodeURIComponent('报告 v1.txt')}&mime=text%2Fplain`, { method: 'POST', body: fileBody })
  check('上传文件成功', uploaded.json?.ok === true, `${uploaded.json?.message?.file?.size} bytes`)
  const fileId = uploaded.json?.message?.file?.id
  check('文件消息 kind=file', uploaded.json?.message?.kind === 'file')

  const downloaded = await api(`/file?id=${encodeURIComponent(fileId)}`)
  check('下载文件成功', downloaded.status === 200)
  check('下载内容一致', downloaded.raw.equals(fileBody), `${downloaded.raw?.length} bytes`)
  check('下载带附件头', String(downloaded.headers['content-disposition'] ?? '').includes('attachment'), downloaded.headers['content-disposition'])

  const missing = await api('/file?id=f-not-exist')
  check('不存在的文件返回 404', missing.status === 404)

  // ---- 发现 / 扫描
  const discover = await api('/discover')
  check('/discover 返回本机网段', Array.isArray(discover.json?.subnets) && discover.json.subnets.length > 0, discover.json?.subnets?.join(','))

  const scan = await api('/scan', { method: 'POST', body: { addresses: ['127.0.0.1'] } })
  check('扫描启动成功', scan.json?.ok === true && scan.json.total === 1, `scanId=${scan.json?.scanId}`)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const scanStatus = await api(`/scan/status?scanId=${scan.json.scanId}`)
  check('扫描状态可查询', scanStatus.json?.ok === true && scanStatus.json.finished === true)

  const badScan = await api('/scan', { method: 'POST', body: { cidr: 'not-a-cidr' } })
  check('坏网段被拒', badScan.status === 400, badScan.json?.error)

  const probe = await api('/probe', { method: 'POST', body: { address: '127.0.0.1', port: host.port } })
  check('probe 自己返回 ok', probe.json?.ok === true && probe.json.peer.peerId === host.store.peerId, probe.json?.peer?.nickname)

  // ---- 诊断
  const diag = await api('/diag')
  check('/diag 返回数据目录', typeof diag.json?.dataDir === 'string' && diag.json.dataDir === dir, diag.json?.dataDir)
  check('/diag 显示监听端口', diag.json?.port === host.port)

  // ---- SSE
  const sseText = await new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: '/lan-chat/events', method: 'GET' }, (res) => {
      let text = ''
      res.on('data', (chunk) => {
        text += chunk.toString('utf8')
        if (text.includes('event: hello')) {
          req.destroy()
          resolve(text)
        }
      })
    })
    req.on('error', () => resolve(''))
    req.end()
    setTimeout(() => {
      req.destroy()
      resolve(text ?? '')
    }, 3000)
    var text = ''
  })
  check('SSE 通道建立并收到 hello', sseText.includes('event: hello'), sseText.slice(0, 40).replace(/\n/gu, ' '))

  // ---- 错误处理
  const notFound = await api('/nope')
  check('未知路由返回 404', notFound.status === 404)
  const wrongMethod = await api('/send', { method: 'GET' })
  check('错误方法返回 405', wrongMethod.status === 405)

  // ---- 重启后数据还在
  await host.dispose()
  server.close()
  const ctx2 = makeCtx()
  const host2 = await startHost(ctx2, { dataDir: dir, port: 45911 })
  const msgs2 = await host2.store.listMessages(dmConv)
  check('重启后消息仍在', msgs2.length === 2, `${msgs2.length} 条`)
  check('重启后身份不变', host2.store.peerId === host.store.peerId)
  check('重启后群还在', host2.store.myGroups().length === 1)
  const settings2 = host2.store.settings
  check('重启后昵称保留', settings2.nickname === '改过的名字', settings2.nickname)
  await host2.dispose()
  await rm(dir, { recursive: true, force: true })

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
