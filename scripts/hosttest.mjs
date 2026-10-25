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
import { createServer as createNetServer } from 'node:net'

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
          // 模拟真实浏览器：同源 fetch 一定带 Origin 与 Sec-Fetch-Site。
          // 测「缺 Origin」「跨站」时用 headers 覆盖掉这两项。
          origin: `http://127.0.0.1:${port}`,
          'sec-fetch-site': 'same-origin',
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

  const host = await startHost(ctx, { dataDir: dir, port: 45911, nickname: '测试主机', allowLoopback: true })
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
  check('可设置访问码（响应只回 hasAccessCode）', setCode.json?.settings?.hasAccessCode === true)
  check('响应里不再回显明文访问码', setCode.json?.settings?.accessCode === undefined)
  const stateAfterCode = await api('/state')
  check('/state 不再泄露访问码', stateAfterCode.json?.settings?.accessCode === undefined && stateAfterCode.json?.settings?.hasAccessCode === true)

  // ---- F-09：写操作缺 Origin 必须拒绝（表单型 CSRF 不带 Origin）
  const noOrigin = await api('/settings', { method: 'POST', body: { nickname: 'csrf' }, headers: { origin: '', 'sec-fetch-site': '' } })
  check('F-09 写操作缺 Origin 被拒（403）', noOrigin.status === 403, String(noOrigin.status))
  const noOriginGet = await api('/state', { headers: { origin: '', 'sec-fetch-site': '' } })
  check('F-09 读操作缺 Origin 仍放行（EventSource/导航）', noOriginGet.status === 200, String(noOriginGet.status))

  // ---- 桌面端（dsh-app://app）：Electron 主进程转发时会删掉 Origin，
  //      写操作改认 x-lan-chat-client: desktop 这个自定义头。
  const desktopWrite = await api('/settings', {
    method: 'POST',
    body: { nickname: '桌面改名' },
    headers: { origin: '', 'sec-fetch-site': '', 'x-lan-chat-client': 'desktop' },
  })
  check('桌面端无 Origin 的写操作放行', desktopWrite.status === 200 && desktopWrite.json?.settings?.nickname === '桌面改名', String(desktopWrite.status))
  // 关键：不能因为放行桌面端就削弱 CSRF —— 没有这个头的写操作仍然必须被拒。
  const spoofOrigin = await api('/settings', {
    method: 'POST',
    body: { nickname: 'csrf2' },
    headers: { origin: 'http://evil.example.com', 'x-lan-chat-client': 'desktop' },
  })
  check('桌面端标识头不能绕过跨站 Origin 检查', spoofOrigin.status === 403, String(spoofOrigin.status))
  const rebindDesktop = await api('/settings', {
    method: 'POST',
    body: { nickname: 'csrf3' },
    headers: { host: 'evil.example.com', 'x-lan-chat-client': 'desktop', origin: '' },
  })
  check('桌面端标识头不能绕过 DNS rebinding 检查', rebindDesktop.status === 403, String(rebindDesktop.status))
  const badClientValue = await api('/settings', {
    method: 'POST',
    body: { nickname: 'csrf4' },
    headers: { origin: '', 'sec-fetch-site': '', 'x-lan-chat-client': 'browser' },
  })
  check('未知客户端标识值仍被拒（403）', badClientValue.status === 403, String(badClientValue.status))
  await api('/settings', { method: 'POST', body: { nickname: '改过的名字' } })

  // ---- F-10：DNS rebinding —— Host 不是回环就拒绝
  const rebind = await api('/state', { headers: { host: 'evil.example.com' } })
  check('F-10 非回环 Host 被拒（403）', rebind.status === 403, String(rebind.status))
  const rebindWrite = await api('/settings', { method: 'POST', body: { nickname: 'x' }, headers: { host: 'evil.example.com', origin: 'http://evil.example.com' } })
  check('F-10 非回环 Host 写操作被拒（403）', rebindWrite.status === 403, String(rebindWrite.status))

  // ---- F-08：每个路由都要过同源检查（不是只有部分）
  // 只列注册过的精确路由（/file 是前缀路由，不走 route()）。
  const routePaths = ['/state', '/settings', '/contacts', '/contacts/alias', '/conversations', '/groups', '/messages', '/messages/delete', '/discover', '/diag', '/events', '/probe', '/scan', '/read', '/listen/retry']
  let guarded = 0
  for (const path of routePaths) {
    const res = await api(path, { headers: { host: 'evil.example.com' } })
    if (res.status === 403) guarded += 1
  }

  // 两个新写接口：缺 Origin 的 POST 必须被拒（挡跨站表单/JS 直接打）
  for (const [path, body] of [
    ['/contacts/alias', { peerId: 'lc-peer-b', alias: 'x' }],
    ['/messages/delete', { convId: 'dm:a|b', all: true }],
  ]) {
    const res = await api(path, { method: 'POST', body, headers: { origin: 'http://evil.example.com', 'sec-fetch-site': 'cross-site' } })
    check(`新接口 ${path} 拒跨站 POST（403）`, res.status === 403, String(res.status))
  }
  check('F-08 全部路由都过同源检查', guarded === routePaths.length, `${guarded}/${routePaths.length}`)

  // ---- F-12：SSE 需要同源
  const sseBad = await api('/events', { headers: { host: 'evil.example.com' } })
  check('F-12 SSE 非回环 Host 被拒（403）', sseBad.status === 403, String(sseBad.status))
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

  // ---- 联系人备注（只改本机显示）
  const aliasSet = await api('/contacts/alias', { method: 'POST', body: { peerId: fakePeer, alias: '隔壁老王' } })
  check('可以给联系人设备注', aliasSet.json?.ok === true && aliasSet.json.contact.alias === '隔壁老王')
  const aliasConvs = await api('/conversations')
  const aliasRow = aliasConvs.json?.conversations?.find((row) => row.peerId === fakePeer)
  check('会话标题跟着用备注名', aliasRow?.title === '隔壁老王', aliasRow?.title)
  const aliasList = await api('/contacts')
  const aliasContact = aliasList.json?.contacts?.find((row) => row.peerId === fakePeer)
  check('备注不影响对方昵称字段', aliasContact?.nickname === '同事B' && aliasContact?.alias === '隔壁老王', `${aliasContact?.nickname} / ${aliasContact?.alias}`)
  const aliasClear = await api('/contacts/alias', { method: 'POST', body: { peerId: fakePeer, alias: '' } })
  check('备注可以清空', aliasClear.json?.ok === true && aliasClear.json.contact.alias === '')
  const aliasMissing = await api('/contacts/alias', { method: 'POST', body: { peerId: 'lc-nobody', alias: 'x' } })
  check('给不存在的联系人设备注返回 404', aliasMissing.status === 404)

  // 备注改回来后，后面的断言继续用原昵称
  await api('/contacts/alias', { method: 'POST', body: { peerId: fakePeer, alias: '' } })

  // ---- 文件上限可配
  const quotaState = await api('/state')
  check('状态里带出文件上限可配范围', typeof quotaState.json?.settings?.maxFileBytes === 'number' && quotaState.json.settings.quotaMinBytes > 0 && quotaState.json.settings.quotaMaxBytes > quotaState.json.settings.quotaMinBytes)
  const quotaSet = await api('/settings', { method: 'POST', body: { maxFileBytes: 256 * 1024 * 1024 } })
  check('可以把单文件上限改成 256MB', quotaSet.json?.settings?.maxFileBytes === 256 * 1024 * 1024, String(quotaSet.json?.settings?.maxFileBytes))
  const quotaTooSmall = await api('/settings', { method: 'POST', body: { maxFileBytes: 1024 } })
  check('过小的上限被夹到下限', quotaTooSmall.json?.settings?.maxFileBytes === 64 * 1024 * 1024, String(quotaTooSmall.json?.settings?.maxFileBytes))
  const quotaZero = await api('/settings', { method: 'POST', body: { maxFileBytes: 0 } })
  check('上限填 0 被拒', quotaZero.status === 400, quotaZero.json?.error)
  // 恢复成默认，避免影响后面的上传测试
  await api('/settings', { method: 'POST', body: { maxFileBytes: 512 * 1024 * 1024 } })


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

  // ---- 删除消息
  const convIdForDelete = encodeURIComponent(dmConv)
  const seeded = await api(`/messages?convId=${convIdForDelete}&limit=1000`)
  const firstId = seeded.json?.messages?.[0]?.id
  check('会话里有消息可删', typeof firstId === 'string' && seeded.json.messages.length >= 1, `${seeded.json?.messages?.length} 条`)
  const delMissing = await api('/messages/delete', { method: 'POST', body: { convId: dmConv, messageId: 'm-not-exist' } })
  check('删不存在的消息返回 404', delMissing.status === 404)
  const deleted = await api('/messages/delete', { method: 'POST', body: { convId: dmConv, messageId: firstId } })
  check('可以删除单条消息', deleted.json?.ok === true && deleted.json.removed === true)
  const afterDelete = await api(`/messages?convId=${convIdForDelete}&limit=1000`)
  check('删掉的消息不再返回', !(afterDelete.json?.messages ?? []).some((row) => row.id === firstId), `剩 ${afterDelete.json?.messages?.length} 条`)

  const cleared = await api('/messages/delete', { method: 'POST', body: { convId: dmConv, all: true } })
  check('可以清空整个会话', cleared.json?.ok === true && cleared.json.removed >= 0, `删除 ${cleared.json?.removed} 条`)
  const afterClear = await api(`/messages?convId=${convIdForDelete}&limit=1000`)
  check('清空后会话为空', (afterClear.json?.messages ?? []).length === 0)

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
  // 绝对路径属于内部信息，不再回传，只回目录名。
  check('/diag 不回传绝对路径', diag.json?.dataDir === undefined)
  check('/diag 返回目录名', typeof diag.json?.dataDirName === 'string' && dir.endsWith(diag.json.dataDirName), diag.json?.dataDirName)
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

  // ---- 端口被占用时的自愈：先占住端口，验证报错；释放后重试应恢复
  {
    const busyPort = 45913
    const squatter = createNetServer(() => {})
    await new Promise((resolve) => squatter.listen(busyPort, '0.0.0.0', resolve))
    const busyDir = await mkdtemp(join(tmpdir(), 'lanchat-busy-'))
    const busyCtx = makeCtx()
    const busyHost = await startHost(busyCtx, { dataDir: busyDir, port: busyPort, nickname: '被占端口' })
    check('端口被占用时监听失败但不崩溃', busyHost.port === 0 && typeof busyHost.startError === 'string', String(busyHost.startError))
    check('端口占用错误是 EADDRINUSE', String(busyHost.startError).includes('EADDRINUSE'), String(busyHost.startError))
    const busyState = await busyHost.store.settings
    check('监听失败时仍能读写本地数据', busyState !== null)

    const { server: busyServer, port: busyApiPort } = await serveRoutes(busyCtx)
    const busyApi = (path, options) => call(busyApiPort, `/lan-chat${path}`, options)
    const stateBusy = await busyApi('/state')
    check('/state 报告未监听并给出重试信息', stateBusy.json?.listening === false && stateBusy.json?.retry?.pending === true, JSON.stringify(stateBusy.json?.retry))

    // 先测「仍在占用时重试」：应保持失败，不能假报成功
    const stillBusy = await busyApi('/listen/retry', { method: 'POST', body: {} })
    check('端口仍被占用时重试返回未监听', stillBusy.json?.listening === false && stillBusy.json?.ok === true)

    // 释放端口后重试：应真正监听成功
    await new Promise((resolve) => squatter.close(resolve))
    const recovered = await busyApi('/listen/retry', { method: 'POST', body: {} })
    check('端口释放后重试监听成功', recovered.json?.listening === true && recovered.json?.port === busyPort, JSON.stringify(recovered.json))
    const stateAfter = await busyApi('/state')
    check('/state 反映恢复后的监听状态', stateAfter.json?.listening === true && stateAfter.json?.startError === null)
    check('恢复后 host.port 同步更新', busyHost.port === busyPort, String(busyHost.port))

    // 恢复后可正常收发：再重试一次应该幂等
    const again = await busyApi('/listen/retry', { method: 'POST', body: {} })
    check('已监听时重复重试幂等', again.json?.alreadyListening === true && again.json?.port === busyPort)

    busyServer.close()
    await busyHost.dispose()
    await rm(busyDir, { recursive: true, force: true })
  }

  // ---- 重启后数据还在
  await host.dispose()
  server.close()
  const ctx2 = makeCtx()
  const host2 = await startHost(ctx2, { dataDir: dir, port: 45911 })
  const msgs2 = await host2.store.listMessages(dmConv)
  check('重启后消息仍在（删过 1 条后剩 1 条）', msgs2.length === 1, `${msgs2.length} 条`)
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
