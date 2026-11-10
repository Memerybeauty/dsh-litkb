/* ---------------- 卡片编辑 / 批注 / 状态 ---------------- */
const STATUSES = ['待读', '略读', '精读', '已引用', '弃读']

async function updateStatus(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 32 * 1024)).toString('utf8'))
    const record = readIndex().find((r) => r.id === String(body.id || ''))
    if (!record) {
      json(res, 404, { ok: false, error: '论文不存在' })
      return
    }
    const from = record.status || '待读'
    const to = String(body.to || '').trim()
    const reason = String(body.reason || '').trim()
    if (!STATUSES.includes(to)) {
      json(res, 422, { ok: false, error: '未知状态', from, to })
      return
    }
    const nextRecord = { ...record, status: to, statusReason: reason, statusSource: 'manual' }
    const card = readCard(record.id)
    if (card) {
      card.statusHistory = Array.isArray(card.statusHistory) ? card.statusHistory : []
      card.statusHistory.push({ from, to, at: new Date().toISOString(), reason })
      card.updatedAt = new Date().toISOString()
      writeCard(card, nextRecord)
    } else {
      upsert(nextRecord)
    }
    json(res, 200, { ok: true, paper: nextRecord, card })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

function queryParam(req, key) {
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams.get(key) || ''
  } catch {
    return ''
  }
}

