/**
 * 界面半侧离线自测：
 *   1. 用假的 __ModuleLoader__ 加载 lib/client.js，检查导出契约；
 *   2. 用真 React + jsdom 挂载主面板，断言侧边栏入口与界面骨架；
 *   3. 用假 fetch 驱动交互（切换页签、发消息、建群）。
 *
 * 需要开发依赖 react / react-dom / jsdom（不进插件包）：
 *   pnpm add -D react react-dom jsdom
 * 或用 REACT_ROOT=/path/to/node_modules 直接指向装着它们的 node_modules 目录。
 *
 * 跑法：node scripts/clienttest.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

/**
 * React / react-dom / jsdom 的位置。
 *
 * 这是**开发期**测试依赖，不进插件包（files 字段不含 scripts）。
 * 优先用本仓库自己装的：pnpm add -D react react-dom jsdom
 * 没装就退回环境变量 REACT_ROOT 指向的任意 node_modules。
 */
const REACT_ROOT = process.env.REACT_ROOT ?? join(resolve(here, '..'), 'node_modules')

/** 在 REACT_ROOT 与常规解析路径里找一个模块，找不到给一条能照做的提示。 */
function loadDevDep(name) {
  const candidates = [join(REACT_ROOT, name), name]
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  console.error(`缺少开发依赖 ${name}。在插件目录跑一次：\n  pnpm add -D react react-dom jsdom\n` +
    `或用 REACT_ROOT=/path/to/node_modules 指向已装好它们的目录。`)
  process.exit(2)
}

const { JSDOM } = loadDevDep('jsdom')

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}

// ------------------------------------------------------------------ jsdom

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
  url: 'http://127.0.0.1:60450/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.KeyboardEvent = window.KeyboardEvent
globalThis.CustomEvent = window.CustomEvent
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0)
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle)
window.HTMLElement.prototype.scrollIntoView = () => {}

const React = loadDevDep('react')
const ReactDOMClient = loadDevDep('react-dom/client')
const { act } = React

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ------------------------------------------------------- 假 fetch 后端

/** 内存后端：模拟宿主 /lan-chat/... 路由。 */
function makeBackend() {
  const state = {
    self: { peerId: 'lc-self', nickname: '我自己', host: 'test', port: 45871, addresses: ['192.168.1.5'], subnets: ['192.168.1.0/24'] },
    settings: { nickname: '我自己', accessCode: '', autoAccept: true, port: 45871, autoDiscover: true },
    listening: true,
    startError: null,
  }
  const contacts = [
    { peerId: 'lc-b', nickname: '同事 B', host: 'b', addrs: ['192.168.1.6'], port: 45871, online: true, added: true, addedAt: 1, lastSeen: Date.now() },
  ]
  const groups = [{ id: 'g1', name: '值班组', members: ['lc-self', 'lc-b'], createdBy: 'lc-self', createdAt: 1 }]
  const messages = {}
  const dmConv = 'dm:lc-b|lc-self'
  const grpConv = 'grp:g1'
  messages[dmConv] = [
    { id: 'm1', convId: dmConv, from: 'lc-b', fromName: '同事 B', kind: 'text', text: '在吗？', ts: Date.now() - 60000, self: false },
    { id: 'm2', convId: dmConv, from: 'lc-self', fromName: '我自己', kind: 'text', text: '在的', ts: Date.now() - 30000, self: true },
  ]
  messages[grpConv] = []
  let counter = 100
  const calls = []

  const conversations = () => [
    { convId: dmConv, kind: 'dm', title: '同事 B', peerId: 'lc-b', online: true, lastText: '在的', lastTs: Date.now() - 30000, unread: 1 },
    { convId: grpConv, kind: 'group', title: '值班组', groupId: 'g1', members: ['lc-self', 'lc-b'], lastText: '', lastTs: 0, unread: 0 },
  ]

  const discovered = [
    { peerId: 'lc-c', nickname: '同事 C', host: 'c', address: '192.168.1.7', port: 45871, lastSeen: Date.now(), added: false },
  ]

  const json = (value, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  })

  const fetchImpl = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const parsed = new URL(String(url), 'http://127.0.0.1:60450')
    const path = parsed.pathname.replace(/^\/lan-chat/, '')
    calls.push({ method, path, query: parsed.searchParams, body: init?.body })

    if (path === '/state') return json({ ok: true, ...state })
    if (path === '/settings' && method === 'POST') {
      Object.assign(state.settings, JSON.parse(init.body))
      state.self.nickname = state.settings.nickname
      return json({ ok: true, settings: state.settings })
    }
    if (path === '/conversations') return json({ ok: true, conversations: conversations() })
    if (path === '/contacts') return json({ ok: true, contacts })
    if (path === '/contacts/add') {
      const body = JSON.parse(init.body)
      contacts.push({ peerId: body.peerId, nickname: body.nickname, host: '', addrs: body.addrs ?? [], port: body.port ?? 0, online: true, added: true, addedAt: Date.now(), lastSeen: Date.now() })
      return json({ ok: true, contact: contacts[contacts.length - 1] })
    }
    if (path === '/contacts/remove') {
      const body = JSON.parse(init.body)
      const index = contacts.findIndex((row) => row.peerId === body.peerId)
      if (index !== -1) contacts.splice(index, 1)
      return json({ ok: true, removed: index !== -1 })
    }
    if (path === '/discover') return json({ ok: true, peers: discovered, subnets: ['192.168.1.0/24'], addresses: ['192.168.1.5'] })
    if (path === '/messages') {
      const convId = parsed.searchParams.get('convId')
      return json({ ok: true, messages: messages[convId] ?? [] })
    }
    if (path === '/read') return json({ ok: true })
    if (path === '/send' && method === 'POST') {
      const body = JSON.parse(init.body)
      counter += 1
      const message = { id: `m${counter}`, convId: body.convId, from: 'lc-self', fromName: '我自己', kind: 'text', text: body.text, ts: Date.now(), self: true }
      ;(messages[body.convId] ??= []).push(message)
      return json({ ok: true, message, delivered: 1 })
    }
    if (path === '/upload' && method === 'POST') {
      const convId = parsed.searchParams.get('convId')
      const name = parsed.searchParams.get('name')
      counter += 1
      const message = {
        id: `m${counter}`,
        convId,
        from: 'lc-self',
        fromName: '我自己',
        kind: 'file',
        text: name,
        ts: Date.now(),
        self: true,
        file: { id: `f${counter}`, name, size: init.body?.length ?? 0, mime: 'text/plain', sha256: '', stored: true },
      }
      ;(messages[convId] ??= []).push(message)
      return json({ ok: true, message, delivered: 1 })
    }
    if (path === '/groups/create' && method === 'POST') {
      const body = JSON.parse(init.body)
      counter += 1
      const group = { id: `g${counter}`, name: body.name, members: ['lc-self', ...body.members], createdBy: 'lc-self', createdAt: Date.now() }
      groups.push(group)
      messages[`grp:${group.id}`] = [{ id: `m${counter}`, convId: `grp:${group.id}`, from: 'lc-self', fromName: '我自己', kind: 'system', text: `创建了群聊「${group.name}」`, ts: Date.now(), self: true }]
      return json({ ok: true, group, convId: `grp:${group.id}` })
    }
    if (path === '/groups') return json({ ok: true, groups })
    if (path === '/scan' && method === 'POST') return json({ ok: true, scanId: 'scan1', total: 254 })
    if (path === '/scan/status') return json({ ok: true, scanId: 'scan1', done: 254, total: 254, finished: true, peers: discovered })
    if (path === '/probe' && method === 'POST') {
      const body = JSON.parse(init.body)
      return json({ ok: true, peer: { peerId: 'lc-d', nickname: '同事 D', host: 'd', address: body.address, port: 45871 } })
    }
    if (path === '/events') return json({ ok: true })
    return json({ ok: false, error: `no fake route ${path}` }, 404)
  }

  return { state, contacts, groups, messages, calls, fetchImpl, dmConv, grpConv, discovered }
}

// --------------------------------------------------- 假 EventSource

function makeEventSource() {
  const instances = []
  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.listeners = new Map()
      this.readyState = 1
      this.closed = false
      instances.push(this)
    }
    addEventListener(name, handler) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(handler)
    }
    removeEventListener(name, handler) {
      const list = this.listeners.get(name) ?? []
      const index = list.indexOf(handler)
      if (index !== -1) list.splice(index, 1)
    }
    close() {
      this.closed = true
      this.readyState = 2
    }
    /** 测试用：推一个事件。 */
    emit(name, data) {
      for (const handler of this.listeners.get(name) ?? []) handler({ data: JSON.stringify(data) })
    }
  }
  return { FakeEventSource, instances }
}

// --------------------------------------------------- 加载 client.js

const source = readFileSync(resolve(here, '../lib/client.js'), 'utf8')

let loaded = null
const moduleRegistry = new Map()

const fakeWindow = window
fakeWindow.__ModuleLoader__ = {
  load(definition) {
    const module = { exports: {} }
    const requireFn = (name) => {
      if (name === 'react') return React
      if (name === 'react/jsx-runtime') return loadDevDep('react/jsx-runtime')
      throw new Error(`unexpected module: ${name}`)
    }
    const returned = definition.factory(requireFn)
    // 约定：factory 返回自己的 module.exports（真实 loader 取返回值）
    loaded = { id: definition.id, exports: returned ?? module.exports, returned }
    moduleRegistry.set(definition.id, loaded.exports)
  },
}

const contextRef = { current: null }
// 让 client.js 里的 window 指向 jsdom 的 window
globalThis.__ModuleLoader__ = fakeWindow.__ModuleLoader__

// 只注入 window；document / fetch / EventSource 走 globalThis，与浏览器一致
new Function('window', source)(window)

check('bundle 通过 __ModuleLoader__ 注册', loaded !== null && loaded.id === 'dsh-lan-chat', loaded?.id)
const mod = loaded?.exports ?? {}
check('导出 apply 函数', typeof mod.apply === 'function')
check('导出 inject 数组且含 slots', Array.isArray(mod.inject) && mod.inject.includes('slots'), JSON.stringify(mod.inject))
check('PANEL_ID 为 lan-chat', mod.PANEL_ID === 'lan-chat', mod.PANEL_ID)

// 工具函数
const test = mod.__test ?? {}
check('dmConvId 双方对称', test.dmConvId('a', 'b') === test.dmConvId('b', 'a'), test.dmConvId?.('a', 'b'))
check('dmConvId 带 dm: 前缀', String(test.dmConvId?.('a', 'b')).startsWith('dm:'), test.dmConvId?.('a', 'b'))
check('dmConvId 空值返回空串', test.dmConvId?.('', 'b') === '')
check('sizeText 格式化字节', test.sizeText?.(1536) === '1.5 KB', test.sizeText?.(1536))
check('sizeText 格式化 MB', test.sizeText?.(5 * 1024 * 1024) === '5.0 MB', test.sizeText?.(5 * 1024 * 1024))
check('initialOf 取首字', test.initialOf?.('张三') === '张', test.initialOf?.('张三'))
check('initialOf 群用「群」', test.initialOf?.('随便', true) === '群')
check('relText 一分钟内是「刚刚」', test.relText?.(Date.now() - 5000) === '刚刚', test.relText?.(Date.now() - 5000))
check('colorOf 稳定', test.colorOf?.('x') === test.colorOf?.('x'), test.colorOf?.('x'))
check('sameDay 判断同一天', test.sameDay?.(Date.now(), Date.now()) === true)

// ------------------------------------------------- 用假 ctx 执行 apply

const registrations = []
const effects = []
const fakeCtx = {
  slots: {
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
    inject(name, factory) {
      const off = factory()
      return typeof off === 'function' ? off : () => {}
    },
  },
  get() {
    return undefined
  },
  effect(factory, label) {
    const off = factory()
    effects.push({ label, off })
    return () => {
      if (typeof off === 'function') off()
    }
  },
  logger: { info: () => {}, warn: () => {} },
}
contextRef.current = fakeCtx

const backend = makeBackend()
const { FakeEventSource, instances: eventSources } = makeEventSource()
globalThis.fetch = backend.fetchImpl
window.fetch = backend.fetchImpl
globalThis.EventSource = FakeEventSource
window.EventSource = FakeEventSource

mod.apply(fakeCtx)

check('注册了两个 slot', registrations.length === 2, `${registrations.length}`)
const mainReg = registrations.find((row) => row.options.name === 'main')
const sidebarReg = registrations.find((row) => row.options.name === 'sidebar.panellist')
check('注册了 main 面板', mainReg !== undefined)
check('注册了 sidebar.panellist 入口', sidebarReg !== undefined)
check('两者 id/key 一致', mainReg?.options.key === 'lan-chat' && sidebarReg?.options.id === 'lan-chat', `${mainReg?.options.key} / ${sidebarReg?.options.id}`)
check('侧边栏 label 可求值', typeof sidebarReg?.options.label === 'function' && sidebarReg.options.label() === '局域网聊天助手', String(sidebarReg?.options.label?.()))
check('侧边栏有 order', typeof sidebarReg?.options.order === 'number', String(sidebarReg?.options.order))

// 侧边栏图标能渲染（用真 React 渲染，不能直接调用函数组件）
const iconHost = window.document.createElement('div')
window.document.body.appendChild(iconHost)
const iconRoot = ReactDOMClient.createRoot(iconHost)
await act(async () => {
  iconRoot.render(React.createElement(sidebarReg.component, { size: 18, active: false }))
})
const iconSvg = iconHost.querySelector('svg')
check('侧边栏图标可渲染', iconSvg !== null)
check('侧边栏图标接受 size', iconSvg?.getAttribute('width') === '18', String(iconSvg?.getAttribute('width')))
await act(async () => {
  iconRoot.unmount()
})
iconHost.remove()

// ------------------------------------------------- 挂载主面板

const MainPanel = mainReg.component
const container = window.document.getElementById('app')
const root = ReactDOMClient.createRoot(container)

const flush = async (times = 6) => {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

await act(async () => {
  root.render(React.createElement(MainPanel, {}))
})
await flush()

const text = () => container.textContent ?? ''
const byClass = (name) => [...container.querySelectorAll(`.${name}`)]
const byText = (tag, value) => [...container.querySelectorAll(tag)].find((node) => (node.textContent ?? '').includes(value))

check('渲染出根容器', container.querySelector('.lanchat-root') !== null)
check('显示自己的昵称', text().includes('我自己'), byClass('lanchat-meName')[0]?.textContent)
check('显示监听端口', text().includes('45871'))
check('三个页签都在', ['会话', '联系人', '发现'].every((label) => byClass('lanchat-tab').some((node) => (node.textContent ?? '').includes(label))))
check('会话列表出现单聊', byClass('lanchat-rowName').some((node) => (node.textContent ?? '').includes('同事 B')), byClass('lanchat-rowName').map((n) => n.textContent).join('|'))
check('会话列表出现群聊', byClass('lanchat-rowName').some((node) => (node.textContent ?? '').includes('值班组')))
check('有未读红点', byClass('lanchat-badge').length > 0, `${byClass('lanchat-badge').length}`)
check('未选中会话时显示引导', byClass('lanchat-emptyTitle').length === 1, byClass('lanchat-emptyTitle')[0]?.textContent)

// ---- 打开会话
const dmRow = byClass('lanchat-row').find((node) => (node.textContent ?? '').includes('同事 B'))
await act(async () => {
  dmRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()

check('打开会话后显示消息', byClass('lanchat-bubbleMsg').length === 2, `${byClass('lanchat-bubbleMsg').length}`)
check('消息内容正确', byClass('lanchat-bubbleMsg').some((node) => (node.textContent ?? '') === '在吗？'))
check('自己的消息右对齐', byClass('lanchat-msg').some((node) => node.className.includes('self')))
check('出现输入框', container.querySelector('.lanchat-composer textarea') !== null)
check('会话已标记已读', backend.calls.some((row) => row.path === '/read'))

// ---- 发消息
const textarea = container.querySelector('.lanchat-composer textarea')
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '测试发消息')
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
})
await flush()

const sendBtn = container.querySelector('.lanchat-sendBtn')
check('发送按钮在草稿非空时可用', sendBtn.disabled === false, String(sendBtn.disabled))

await act(async () => {
  sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()

check('发消息请求已发出', backend.calls.some((row) => row.path === '/send' && String(row.body).includes('测试发消息')))
check('新消息出现在线程里', byClass('lanchat-bubbleMsg').some((node) => (node.textContent ?? '') === '测试发消息'), `${byClass('lanchat-bubbleMsg').length} 条`)
check('发完清空输入框', (container.querySelector('.lanchat-composer textarea').value ?? '') === '')

// ---- Enter 发送
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, '回车发送')
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
})
await flush()
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await flush()
check('Enter 能发送', backend.calls.some((row) => row.path === '/send' && String(row.body).includes('回车发送')))

// ---- 切到联系人
const contactsTab = byClass('lanchat-tab').find((node) => (node.textContent ?? '').includes('联系人'))
await act(async () => {
  contactsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
check('联系人页签显示联系人', byClass('lanchat-peerName').some((node) => (node.textContent ?? '').includes('同事 B')))
check('联系人有「聊天」按钮', byClass('lanchat-btn').some((node) => (node.textContent ?? '') === '聊天'))

// ---- 切到发现
const discoverTab = byClass('lanchat-tab').find((node) => (node.textContent ?? '').includes('发现'))
await act(async () => {
  discoverTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
check('发现页显示扫描输入', [...container.querySelectorAll('input')].some((node) => node.getAttribute('aria-label') === '扫描网段'))
check('发现页显示本机网段快捷键', byClass('lanchat-btn').some((node) => (node.textContent ?? '').includes('192.168.1.0/24')))
check('发现页列出发现的节点', byClass('lanchat-peerName').some((node) => (node.textContent ?? '').includes('同事 C')), byClass('lanchat-peerName').map((n) => n.textContent).join('|'))

// ---- 扫描
const scanBtn = byClass('lanchat-btn').find((node) => (node.textContent ?? '') === '扫描')
await act(async () => {
  scanBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
check('扫描请求已发出', backend.calls.some((row) => row.path === '/scan'))
check('显示扫描进度', byClass('lanchat-progress').length === 1)

// ---- 添加发现的节点
await flush(10)
const addBtn = byClass('lanchat-btn').find((node) => (node.textContent ?? '') === '添加')
check('发现节点有「添加」按钮', addBtn !== undefined)
if (addBtn !== undefined) {
  await act(async () => {
    addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await flush()
  check('添加联系人请求已发出', backend.calls.some((row) => row.path === '/contacts/add' && String(row.body).includes('lc-c')))
}

// ---- 新建群
const plusBtn = [...container.querySelectorAll('.lanchat-iconBtn')].find((node) => (node.getAttribute('title') ?? '') === '新建群聊')
check('有新建群按钮', plusBtn !== undefined)
await act(async () => {
  plusBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
check('弹出新建群对话框', container.querySelector('.lanchat-modal') !== null)
check('对话框有群名输入', container.querySelector('#lanchat-gname') !== null)

const groupInput = container.querySelector('#lanchat-gname')
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(groupInput, '新的群')
  groupInput.dispatchEvent(new window.Event('input', { bubbles: true }))
})
await flush()
const createBtn = [...container.querySelectorAll('.lanchat-modalFoot .lanchat-btn')].find((node) => (node.textContent ?? '') === '创建')
check('创建按钮存在', createBtn !== undefined)
await act(async () => {
  createBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
check('建群请求已发出', backend.calls.some((row) => row.path === '/groups/create' && String(row.body).includes('新的群')))

// ---- 设置
const settingsBtn = [...container.querySelectorAll('.lanchat-iconBtn')].find((node) => (node.getAttribute('title') ?? '') === '设置')
check('有设置按钮', settingsBtn !== undefined)
await act(async () => {
  settingsBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
check('设置对话框打开', container.querySelector('#lanchat-nick') !== null)
check('设置里显示自己的 ID', text().includes('lc-self'))
check('设置里显示本机地址', text().includes('192.168.1.5'))

const nickInput = container.querySelector('#lanchat-nick')
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(nickInput, '新昵称')
  nickInput.dispatchEvent(new window.Event('input', { bubbles: true }))
})
await flush()
const saveBtn = [...container.querySelectorAll('.lanchat-modalFoot .lanchat-btn')].find((node) => (node.textContent ?? '') === '保存')
await act(async () => {
  saveBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
check('保存设置请求已发出', backend.calls.some((row) => row.path === '/settings' && String(row.body).includes('新昵称')))

// ---- 回到单聊（建群后主面板已切到新群）
const chatsTab = byClass('lanchat-tab').find((node) => (node.textContent ?? '').includes('会话'))
await act(async () => {
  chatsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
const dmRow2 = byClass('lanchat-row').find((node) => (node.textContent ?? '').includes('同事 B'))
check('会话页签回到单聊', dmRow2 !== undefined)
await act(async () => {
  dmRow2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
await flush()
check('切回单聊后消息可见', byClass('lanchat-bubbleMsg').length >= 2, `${byClass('lanchat-bubbleMsg').length}`)

// ---- SSE 实时消息
check('建立了 EventSource', eventSources.length >= 1, `${eventSources.length}`)
const source0 = eventSources[0]
const before = byClass('lanchat-bubbleMsg').length
await act(async () => {
  source0.emit('message', { id: 'sse-1', convId: backend.dmConv, from: 'lc-b', fromName: '同事 B', kind: 'text', text: '实时推送来的', ts: Date.now(), self: false })
})
await flush()
check('SSE 消息追加到线程', byClass('lanchat-bubbleMsg').length === before + 1, `${before} → ${byClass('lanchat-bubbleMsg').length}`)
check('SSE 消息内容正确', byClass('lanchat-bubbleMsg').some((node) => (node.textContent ?? '') === '实时推送来的'))

// ---- 文件消息渲染
await act(async () => {
  source0.emit('message', {
    id: 'sse-2',
    convId: backend.dmConv,
    from: 'lc-b',
    fromName: '同事 B',
    kind: 'file',
    text: 'report.pdf',
    ts: Date.now(),
    self: false,
    file: { id: 'f-9', name: 'report.pdf', size: 20480, mime: 'application/pdf', sha256: '', stored: true },
  })
})
await flush()
check('文件消息渲染成卡片', byClass('lanchat-fileCard').length === 1)
check('文件卡片显示大小', text().includes('20.0 KB'))
check('文件卡片链接到下载路由', byClass('lanchat-fileCard')[0]?.getAttribute('href')?.includes('/lan-chat/file?id=f-9'), byClass('lanchat-fileCard')[0]?.getAttribute('href'))

// ---- 清理
await act(async () => {
  root.unmount()
})
for (const entry of effects) {
  try {
    entry.off?.()
  } catch (error) {
    /* ignore */
  }
}

const failed = results.filter((row) => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.log('失败项：')
  for (const row of failed) console.log(`  - ${row.name} ${row.detail ?? ''}`)
  process.exit(1)
}
process.exit(0)
