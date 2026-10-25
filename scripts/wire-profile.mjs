/**
 * 把 dsh-lan-chat 接进 DSH Desktop profile。
 *
 * 幂等：重复运行只会补齐缺失的部分，不会重复插入。
 * 会先备份 package.json（同目录 .bak-<时间戳>）。
 *
 * 只改 package.json 两处：dependencies 里加 link 依赖、dsh.profile.bundles 里加插件名。
 * **不要**往 profile 的 cordis.patch.yml 写 insert —— bundle 的 patch 由 app-boot
 * 自动叠加，再写一遍会重复注册同一个条目。
 *
 * 跑法：
 *   node wire-profile.mjs            # 真写
 *   node wire-profile.mjs --dry-run  # 只看要改什么
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dryRun = process.argv.includes('--dry-run')

const PLUGIN_NAME = 'dsh-lan-chat'
const PLUGIN_PATH = resolve(here, '..')
const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'desktop')

const log = (...args) => console.log(...args)

// ── 1. package.json ────────────────────────────────────────────────

const pkgPath = join(PROFILE_DIR, 'package.json')
if (!existsSync(pkgPath)) {
  console.error(`找不到 profile：${pkgPath}`)
  process.exit(1)
}

const pkgRaw = readFileSync(pkgPath, 'utf8')
const pkg = JSON.parse(pkgRaw)
pkg.dependencies ??= {}
pkg.dsh ??= {}
pkg.dsh.profile ??= {}
pkg.dsh.profile.bundles ??= []

const changes = []

const wantedSpec = `link:${PLUGIN_PATH}`
if (pkg.dependencies[PLUGIN_NAME] !== wantedSpec) {
  changes.push(`dependencies["${PLUGIN_NAME}"]: ${pkg.dependencies[PLUGIN_NAME] ?? '(无)'} → ${wantedSpec}`)
  pkg.dependencies[PLUGIN_NAME] = wantedSpec
}

if (!pkg.dsh.profile.bundles.includes(PLUGIN_NAME)) {
  changes.push(`dsh.profile.bundles: 追加 "${PLUGIN_NAME}"（当前 ${pkg.dsh.profile.bundles.length} 项）`)
  pkg.dsh.profile.bundles.push(PLUGIN_NAME)
}

// ── 2. cordis.patch.yml（只做校验，不写入）────────────────────────
//
// 重要：插件的 cordis.patch.yml 由 bundle 机制自动应用 ——
//   app-boot 按 dsh.profile.bundles 顺序，把每个 bundle 的 dsh.bundle.patch
//   叠加到空条目表上，最后才叠 profile 自己的 cordis.patch.yml。
// 所以 profile 的 patch 里**不需要**再写一条 insert；写了会导致重复注册。
// 这里只检查有没有历史遗留的重复条目，有就报出来让人处理。

const patchPath = join(PROFILE_DIR, 'cordis.patch.yml')
const patchRaw = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''

const ENTRY_ID = 'lan-chat'
const hasDuplicate = new RegExp(`^\\s*-?\\s*id:\\s*${ENTRY_ID}\\s*$`, 'mu').test(patchRaw)
if (hasDuplicate) {
  console.warn(`警告：cordis.patch.yml 里已有 id: ${ENTRY_ID} 的条目，会和 bundle 自带的 patch 重复注册。`)
  console.warn('      请手动删掉那一条（插件自身的 cordis.patch.yml 已经声明过了）。')
}

// bundle 自带的 patch 必须存在，否则插件不会进 Loader 树
const ownPatch = join(PLUGIN_PATH, 'cordis.patch.yml')
if (!existsSync(ownPatch)) {
  console.error(`缺少 ${ownPatch} —— 插件无法被 Loader 加载。`)
  process.exit(1)
}

// ── 汇报 / 落盘 ────────────────────────────────────────────────────

if (changes.length === 0) {
  log('已是最新，无需改动。')
  process.exit(0)
}

log(dryRun ? '将要做的改动：' : '改动：')
for (const line of changes) log(`  · ${line}`)

if (dryRun) {
  log('\n（--dry-run，未写入）')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
copyFileSync(pkgPath, `${pkgPath}.bak-${stamp}`)
log(`备份：${pkgPath}.bak-${stamp}`)

// 保持 2 空格缩进 + 末尾换行，尽量少动原文件格式
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
log(`已写入：${pkgPath}`)

log('\n完成。重启 DSH Desktop 后左侧会出现「局域网聊天助手」。')
