#!/usr/bin/env node
/**
 * 把 dsh-litkb 安装到指定的 DSH profile。
 *
 * 用法：
 *   node scripts/install.mjs                     # 默认 desktop profile，用本版本 tgz
 *   node scripts/install.mjs --profile web       # 装到 web profile
 *   node scripts/install.mjs --link              # 开发模式：装当前工作区 link
 *   node scripts/install.mjs --tgz ./x.tgz       # 指定包
 *   node scripts/install.mjs --dry-run           # 只打印计划，不改文件
 *   node scripts/install.mjs --pnpm /path/pnpm   # 指定 pnpm
 *
 * 安装后需要完全退出 DSH 再启动；服务端路由和 Agent 工具只在进程启动时注册。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function parseArgs(argv) {
  const options = { profile: 'desktop', tgz: '', link: false, dryRun: false, pnpm: '', skipInstall: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile' || arg === '-p') options.profile = argv[++i] || ''
    else if (arg === '--tgz') options.tgz = argv[++i] || ''
    else if (arg === '--link') options.link = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--pnpm') options.pnpm = argv[++i] || ''
    else if (arg === '--skip-install') options.skipInstall = true
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
      process.exit(0)
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }
  return options
}

function profilesRoot() {
  return join(homedir(), '.dsh', 'profiles')
}

function resolveProfile(value) {
  if (!value) throw new Error('缺少 --profile')
  const direct = value.startsWith('/') || value.startsWith('.') ? resolve(value) : join(profilesRoot(), value)
  if (!existsSync(join(direct, 'package.json'))) {
    const names = (() => {
      try {
        return readdirSync(profilesRoot())
          .filter((name) => existsSync(join(profilesRoot(), name, 'package.json')))
          .join(', ')
      } catch {
        return '（无）'
      }
    })()
    throw new Error(`profile 不存在或没有 package.json：${direct}\n可用 profile：${names}`)
  }
  return direct
}

function findPnpm(options) {
  if (options.pnpm) return options.pnpm
  if (process.env.DSH_PNPM) return process.env.DSH_PNPM
  return 'pnpm'
}

function ensureTgz(options) {
  if (options.link) return ''
  if (options.tgz) {
    const file = resolve(options.tgz)
    if (!existsSync(file)) throw new Error(`tgz 不存在：${file}`)
    return file
  }
  const expected = join(ROOT, `dsh-litkb-${pkg.version}.tgz`)
  if (existsSync(expected)) return expected
  console.log(`[install] 未找到 dsh-litkb-${pkg.version}.tgz，执行 npm pack…`)
  execFileSync('npm', ['pack'], { cwd: ROOT, stdio: 'inherit' })
  if (!existsSync(expected)) throw new Error(`npm pack 后仍找不到 ${expected}`)
  return expected
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const profileDir = resolveProfile(options.profile)
  const file = ensureTgz(options)
  const spec = options.link ? `link:${ROOT}` : `file:${file}`
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies = manifest.dependencies || {}
  manifest.dependencies['dsh-litkb'] = spec
  manifest.dsh = manifest.dsh || {}
  manifest.dsh.profile = manifest.dsh.profile || {}
  const bundles = new Set(manifest.dsh.profile.bundles || [])
  bundles.add('dsh-litkb')
  manifest.dsh.profile.bundles = [...bundles]

  console.log(`[install] profile : ${profileDir}`)
  console.log(`[install] 依赖    : dsh-litkb@${spec}`)
  console.log(`[install] bundles : ${manifest.dsh.profile.bundles.join(', ')}`)

  if (options.dryRun) {
    console.log('[install] --dry-run，不写入文件')
    return
  }

  copyFileSync(manifestPath, `${manifestPath}.bak-litkb`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  if (!options.skipInstall) {
    const pnpm = findPnpm(options)
    console.log(`[install] 执行 ${pnpm} install …`)
    try {
      execFileSync(pnpm, ['install', '--prefer-offline'], { cwd: profileDir, stdio: 'inherit' })
    } catch (error) {
      copyFileSync(`${manifestPath}.bak-litkb`, manifestPath)
      throw new Error(`pnpm install 失败，已还原 package.json：${String(error?.message || error)}`)
    }
  }

  console.log('')
  console.log('✅ 安装完成')
  console.log('   1. 完全退出 DSH（不是关窗口）再启动')
  console.log('   2. 浏览器 Cmd+Shift+R 强制刷新')
  console.log('   3. 检查健康接口：curl http://127.0.0.1:<端口>/api/litkb/health')
  console.log(`      应显示 "version":"${pkg.version}"`)
  console.log('   数据默认在 ~/Documents/文献库；升级前建议在「设置 → 数据与备份」下载整库备份。')
}

try {
  main()
} catch (error) {
  console.error(`[install] 失败：${String(error?.message || error)}`)
  process.exit(1)
}
