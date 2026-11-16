/**
 * HTTP 基础层：JSON 响应、请求体读取、错误 → 状态码/错误码映射，以及统一路由注册器。
 * 这一层不碰业务，只被 40–80 的路由注册函数使用。
 */
function json(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

function readBody(req, limit = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
      // 只停止读，不 destroy：让上层还能正常写回 413，而不是直接断连。
      if (typeof req.pause === 'function') req.pause()
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        fail(Object.assign(new Error('payload too large'), { code: 'TOO_LARGE' }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    req.on('error', fail)
  })
}

/** 统一错误 → HTTP 状态。默认 500，保留各 handler 历史上“抛错即 500”的语义。 */
function errorStatus(error) {
  const explicit = Number(error?.status || error?.statusCode)
  if (Number.isFinite(explicit) && explicit >= 400 && explicit <= 599) return explicit
  if (error?.code === 'TOO_LARGE') return 413
  if (error instanceof SyntaxError) return 400
  return 500
}

/** 统一错误 → 机器可读 code。 */
function errorCode(error) {
  if (error?.code) return String(error.code)
  if (error instanceof SyntaxError) return 'bad_json'
  return 'error'
}

function queryParam(req, key) {
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams.get(key) || ''
  } catch {
    return ''
  }
}



/**
 * 创建一个绑定到宿主的注册器：统一方法白名单 + 统一 { ok, code, error } 错误返回。
 * 每个域的路由注册函数只依赖这里返回的 route()，不再直接摸 webServer。
 */
function createRouter(webServer) {
  let count = 0
  /**
   * 统一路由注册：可选方法白名单 + 统一 { ok, code, error } 错误返回。
   * 不传 methods 时保持历史行为（由 handler 自行分派 GET/POST）。
   */
  function route(path, handler, methods) {
    count += 1
    const allowed = methods ? [].concat(methods).map((method) => String(method).toUpperCase()) : null
    webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        const effective = method === 'HEAD' ? 'GET' : method
        if (allowed && !allowed.includes(effective)) {
          json(res, 405, { ok: false, code: 'method_not_allowed', error: `不支持的方法 ${req.method}` })
          return
        }
        try {
          await handler(req, res)
        } catch (error) {
          json(res, errorStatus(error), { ok: false, code: errorCode(error), error: String(error?.message || error) })
        }
      },
    })
  }
  return { route, get count() { return count } }
}
