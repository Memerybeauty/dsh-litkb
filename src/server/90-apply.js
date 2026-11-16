/**
 * 插件入口：只做装配。
 * 初始化依赖 → 注册 Agent 工具 → 按域注册路由（40–80），单个域出问题不影响其它域。
 */
export function apply(ctx) {
  const webServer = ctx.webServer
  pluginCtx = ctx
  ctx.logger?.info?.(`[dsh-litkb] plugin loaded v${pkg.version}`)
  try {
    const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools
    if (tools && typeof tools.register === 'function') {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
          const disposers = registerAgentTools(ctx, tools)
          return () => disposers.forEach((dispose) => { try { dispose() } catch { /* ignore */ } })
        }, 'dsh-litkb: agent tools')
      } else {
        registerAgentTools(ctx, tools)
      }
      ctx.logger?.info?.(`[dsh-litkb] ${AGENT_TOOL_NAMES.length} agent tools registered`)
    } else {
      ctx.logger?.warn?.('[dsh-litkb] tools unavailable; agent tools skipped')
    }
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-litkb] agent tools skipped: ${String(error?.message || error)}`)
  }
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[dsh-litkb] webServer unavailable; routes skipped')
    return
  }

  ensureLibrary()
  try {
    const bad = indexBadLines()
    if (bad > 0) ctx.logger?.warn?.(`[dsh-litkb] index.jsonl 有 ${bad} 行无法解析，已保留 index.jsonl.bak`)
  } catch { /* 诊断失败不影响启动 */ }
  try {
    const recovery = recoverInterruptedRestore()
    if (recovery.recovered) {
      ctx.logger?.warn?.(`[dsh-litkb] recovered ${recovery.recovered} data roots from an interrupted restore`)
    }
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-litkb] restore recovery skipped: ${String(error?.message || error)}`)
  }
  try {
    const migrated = migrateAutoStatuses()
    if (migrated) ctx.logger?.info?.(`[dsh-litkb] auto reading status migrated: ${migrated} paper(s)`)
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-litkb] auto status migration skipped: ${String(error?.message || error)}`)
  }

  const router = createRouter(webServer)
  const deps = { ctx, route: router.route }

  // 每个域独立装配：一个域抛错只记日志，不连累其它域和插件启动。
  for (const register of [registerLibraryRoutes, registerGraphRoutes, registerDeepReadRoutes, registerChainRoutes, registerThemeRoutes, registerWritingRoutes]) {
    try {
      register(deps)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-litkb] route group ${register.name} skipped: ${String(error?.message || error)}`)
    }
  }

  ctx.logger?.info?.(`[dsh-litkb] ${router.count} routes registered`)
}
