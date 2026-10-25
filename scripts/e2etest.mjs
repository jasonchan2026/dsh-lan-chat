/**
 * 端到端自测：两个真实宿主进程内互联，走完 发现 → 添加 → 单聊 → 群聊 → 文件。
 * 这是最接近“两台机器”的离线验证（同一台机器上跑两个端口）。
 *
 * 跑法：node scripts/e2etest.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request } from 'node:http'
import { startHost } from '../lib/index.js'

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}

/** 假 Cordis ctx。 */
function makeCtx() {
  const routes = new Map()
  return {
    logger: { info: () => {}, warn: () => {} },
    webServer: {
      register(route) {
        if (routes.has(route.path)) throw new Error(`duplicate ${route.path}`)
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    on: () => {},
    routes,
  }
}

/** 把 ctx 的路由挂到一个本地 HTTP 端口上（模拟 DSH web server）。 */
function serve(ctx) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const handler = ctx.routes.get(url.pathname)
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"ok":false}')
      return
    }
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end('{"ok":false}')
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function call(port, path, { method = "GET", body, headers = {} } = {}) {
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
          origin: `http://127.0.0.1:${port}`,
          "sec-fetch-site": "same-origin",
          ...(payload === null ? {} : { "content-type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json", "content-length": payload.length }),
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
          resolve({ status: res.statusCode, json, raw, headers: res.headers })
        })
      },
    )
    req.on('error', () => resolve({ status: 0, json: null, raw: Buffer.alloc(0), headers: {} }))
    req.end(payload ?? undefined)
  })
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 挑一对相邻且空闲的端口（发现用 port+1，所以两个都得空）。
 * 不写死 45871 —— 本机真跑着插件时那个端口是占着的，写死会让测试假失败。
 */
async function pickPortPair(start = 46000) {
  const net = await import('node:net')
  const isFree = (port) => new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '0.0.0.0')
  })
  for (let port = start; port < start + 400; port += 2) {
    if (await isFree(port) && await isFree(port + 1)) return port
  }
  throw new Error('找不到空闲端口对')
}


/** 等到条件成立或超时。 */
async function until(predicate, timeoutMs = 6000, stepMs = 120) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await wait(stepMs)
  }
  return false
}

const main = async () => {
  const dirA = await mkdtemp(join(tmpdir(), 'lanchat-e2e-a-'))
  const dirB = await mkdtemp(join(tmpdir(), 'lanchat-e2e-b-'))

  const ctxA = makeCtx()
  const ctxB = makeCtx()
  // 两个节点用相邻端口（发现用 port+1），端口对动态挑，避免和本机在跑的实例撞车
  const nodePortA = await pickPortPair()
  const nodePortB = nodePortA + 1
  // allowLoopback：两个节点都在本机，必须允许往 127.0.0.1 投递。
  // 真实部署不会开这个开关，回环地址默认被 SSRF 防护挡掉。
  const hostA = await startHost(ctxA, { dataDir: dirA, port: nodePortA, nickname: '机器甲', allowLoopback: true })
  const hostB = await startHost(ctxB, { dataDir: dirB, port: nodePortB, nickname: '机器乙', allowLoopback: true })

  check('两台机器都启动', hostA.port === nodePortA && hostB.port === nodePortB, `${hostA.port} / ${hostB.port}`)

  // 本地 HTTP 服务（模拟 DSH web server 的端口），与节点端口是两回事
  const { server: serverA, port: portA } = await serve(ctxA)
  const { server: serverB, port: portB } = await serve(ctxB)
  const apiA = (path, options) => call(portA, `/lan-chat${path}`, options)
  const apiB = (path, options) => call(portB, `/lan-chat${path}`, options)

  // ---- 1. 互相探测
  const probeA = await apiA('/probe', { method: 'POST', body: { address: '127.0.0.1', port: nodePortB } })
  check('甲能探测到乙', probeA.json?.ok === true && probeA.json.peer.peerId === hostB.store.peerId, probeA.json?.peer?.nickname)
  const probeB = await apiB('/probe', { method: 'POST', body: { address: '127.0.0.1', port: nodePortA } })
  check('乙能探测到甲', probeB.json?.ok === true && probeB.json.peer.peerId === hostA.store.peerId, probeB.json?.peer?.nickname)

  // ---- 2. 互相添加
  const addA = await apiA('/contacts/add', {
    method: 'POST',
    body: { peerId: hostB.store.peerId, nickname: '机器乙', addrs: ['127.0.0.1'], port: nodePortB },
  })
  check('甲添加乙', addA.json?.ok === true)
  const addB = await apiB('/contacts/add', {
    method: 'POST',
    body: { peerId: hostA.store.peerId, nickname: '机器甲', addrs: ['127.0.0.1'], port: nodePortA },
  })
  check('乙添加甲', addB.json?.ok === true)

  // ---- 3. 单聊：甲发 → 乙收到
  const convsA = await apiA('/conversations')
  const dmA = convsA.json.conversations.find((row) => row.peerId === hostB.store.peerId)?.convId
  check('甲有与乙的单聊会话', typeof dmA === 'string' && dmA.startsWith('dm:'), dmA)
  const convsB = await apiB('/conversations')
  const dmB = convsB.json.conversations.find((row) => row.peerId === hostA.store.peerId)?.convId
  check('双方算出同一个会话 id', dmA === dmB, `${dmA} vs ${dmB}`)

  const sent = await apiA('/send', { method: 'POST', body: { convId: dmA, text: '甲对乙说：你好' } })
  check('甲发出消息', sent.json?.ok === true)
  check('甲的消息已送达乙（delivered=1）', sent.json?.delivered === 1, `delivered=${sent.json?.delivered}`)

  const arrived = await until(async () => {
    const payload = await apiB(`/messages?convId=${encodeURIComponent(dmB)}`)
    return (payload.json?.messages ?? []).some((row) => row.text === '甲对乙说：你好')
  })
  check('乙收到了这条消息', arrived)

  const bMessages = await apiB(`/messages?convId=${encodeURIComponent(dmB)}`)
  const received = (bMessages.json?.messages ?? []).find((row) => row.text === '甲对乙说：你好')
  check('乙侧消息标记为对方发的', received?.self === false, `self=${received?.self}`)
  check('乙侧保留了发送者昵称', received?.fromName === '机器甲', received?.fromName)

  // 乙的会话列表出现未读
  const convsB2 = await apiB('/conversations')
  const dmSummaryB = convsB2.json.conversations.find((row) => row.convId === dmB)
  check('乙的会话列表有未读', dmSummaryB?.unread >= 1, `unread=${dmSummaryB?.unread}`)
  check('乙的会话列表有预览', dmSummaryB?.lastText === '甲对乙说：你好', dmSummaryB?.lastText)

  // ---- 4. 乙回复 → 甲收到
  const reply = await apiB('/send', { method: 'POST', body: { convId: dmB, text: '乙回复：收到' } })
  check('乙发出回复', reply.json?.ok === true)
  check('乙的回复送达甲', reply.json?.delivered === 1, `delivered=${reply.json?.delivered}`)
  const replyArrived = await until(async () => {
    const payload = await apiA(`/messages?convId=${encodeURIComponent(dmA)}`)
    return (payload.json?.messages ?? []).some((row) => row.text === '乙回复：收到')
  })
  check('甲收到了回复', replyArrived)

  // ---- 5. 文件：甲传 → 乙能下载
  const fileBody = Buffer.from(`端到端文件 ${Date.now()}\n`.repeat(80), 'utf8')
  const uploaded = await apiA(`/upload?convId=${encodeURIComponent(dmA)}&name=${encodeURIComponent('端到端 文件.bin')}&mime=application/octet-stream`, {
    method: 'POST',
    body: fileBody,
  })
  check('甲上传文件', uploaded.json?.ok === true, `${uploaded.json?.message?.file?.size} bytes`)
  check('文件已推送给乙', uploaded.json?.delivered === 1, `delivered=${uploaded.json?.delivered}`)
  const fileId = uploaded.json?.message?.file?.id

  const fileArrived = await until(async () => {
    const payload = await apiB(`/messages?convId=${encodeURIComponent(dmB)}`)
    return (payload.json?.messages ?? []).some((row) => row.kind === 'file' && row.file?.id === fileId)
  })
  check('乙收到文件消息', fileArrived)

  const downloaded = await apiB(`/file?id=${encodeURIComponent(fileId)}`)
  check('乙能下载文件', downloaded.status === 200)
  check('乙下载的内容一致', downloaded.raw.equals(fileBody), `${downloaded.raw?.length} vs ${fileBody.length}`)

  // ---- 6. 群聊：甲建群拉乙 → 群消息双向
  const groupCreated = await apiA('/groups/create', { method: 'POST', body: { name: '跨机群', members: [hostB.store.peerId] } })
  check('甲建群成功', groupCreated.json?.ok === true, groupCreated.json?.group?.name)
  const groupConv = groupCreated.json.convId

  const groupArrived = await until(async () => {
    const payload = await apiB('/groups')
    return (payload.json?.groups ?? []).some((row) => row.id === groupCreated.json.group.id)
  })
  check('乙同步到了这个群', groupArrived)

  const groupSend = await apiA('/send', { method: 'POST', body: { convId: groupConv, text: '群消息：大家好' } })
  check('甲在群里发消息', groupSend.json?.ok === true)
  check('群消息送达乙', groupSend.json?.delivered === 1, `delivered=${groupSend.json?.delivered}`)

  const groupMsgArrived = await until(async () => {
    const payload = await apiB(`/messages?convId=${encodeURIComponent(`grp:${groupCreated.json.group.id}`)}`)
    return (payload.json?.messages ?? []).some((row) => row.text === '群消息：大家好')
  })
  check('乙收到群消息', groupMsgArrived)

  const groupReply = await apiB('/send', { method: 'POST', body: { convId: `grp:${groupCreated.json.group.id}`, text: '群回复：我也在' } })
  check('乙在群里回复', groupReply.json?.ok === true)
  const groupReplyArrived = await until(async () => {
    const payload = await apiA(`/messages?convId=${encodeURIComponent(groupConv)}`)
    return (payload.json?.messages ?? []).some((row) => row.text === '群回复：我也在')
  })
  check('甲收到群回复', groupReplyArrived)

  // ---- 6.5 群主解散群：乙那边也要跟着删掉（群和消息一起）
  {
    const gid = groupCreated.json.group.id
    const bMsgsBefore = ((await apiB(`/messages?convId=${encodeURIComponent(`grp:${gid}`)}`)).json?.messages ?? []).length
    check('解散前乙有群消息', bMsgsBefore > 0, `${bMsgsBefore} 条`)

    const dissolved = await apiA('/groups/remove', { method: 'POST', body: { groupId: gid } })
    check('甲（群主）解散群', dissolved.json?.ok === true && dissolved.json?.dissolved === true)

    const bGone = await until(async () => {
      const payload = await apiB('/groups')
      return !(payload.json?.groups ?? []).some((row) => row.id === gid)
    })
    check('乙侧的群也被删掉', bGone)
    const bMsgsAfter = ((await apiB(`/messages?convId=${encodeURIComponent(`grp:${gid}`)}`)).json?.messages ?? []).length
    check('乙侧的群消息也清空', bMsgsAfter === 0, `${bMsgsAfter} 条`)
    const bConvs = await apiB('/conversations')
    check('乙会话列表不再有该群', !(bConvs.json?.conversations ?? []).some((row) => row.groupId === gid))
  }

  // ---- 7. 昵称同步
  await apiA('/settings', { method: 'POST', body: { nickname: '机器甲改名' } })
  const renamed = await until(async () => {
    const payload = await apiB('/contacts')
    return (payload.json?.contacts ?? []).some((row) => row.peerId === hostA.store.peerId && row.nickname === '机器甲改名')
  })
  check('乙侧看到甲的新昵称', renamed)

  // ---- 8. 访问码
  await apiB('/settings', { method: 'POST', body: { accessCode: 'team-2026' } })
  const denied = await call(portA, '/lan-chat/probe', { method: 'POST', body: { address: '127.0.0.1', port: nodePortB } })
  check('设置访问码后仍可探测（info 不鉴权）', denied.json?.ok === true)

  // 用错码握手
  const { postJson } = await import('../lib/node.js')
  const wrongHello = await postJson(`http://127.0.0.1:${nodePortB}/lan-chat/v1/hello`, { peerId: 'lc-x', accessCode: 'bad' })
  check('错误访问码握手被拒', wrongHello?.ok === false, wrongHello?.error)
  const rightHello = await postJson(`http://127.0.0.1:${nodePortB}/lan-chat/v1/hello`, {
    peerId: hostA.store.peerId,
    nickname: '机器甲',
    port: nodePortA,
    accessCode: 'team-2026',
    authKey: hostA.node.authKey,
  })
  check('正确访问码握手通过', rightHello?.ok === true, rightHello?.error)
  check('握手拿到 token', typeof rightHello?.token === 'string' && rightHello.token.length > 10)

  // ---- 9. 离线行为
  await apiB('/contacts/remove', { method: 'POST', body: { peerId: hostA.store.peerId } })
  const offlineSend = await apiA('/send', { method: 'POST', body: { convId: dmA, text: '对端删了我还能发吗' } })
  check('对端删除后仍能本地记录', offlineSend.json?.ok === true)

  // ---- 收尾
  await hostA.dispose()
  await hostB.dispose()
  serverA.close()
  serverB.close()
  await rm(dirA, { recursive: true, force: true })
  await rm(dirB, { recursive: true, force: true })

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
