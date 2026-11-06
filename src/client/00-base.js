/**
 * dsh-litkb · 客户端插件（P2.1）
 * 大类 + 扁平标签 + 七段卡（生成 / 轮询 / 引文页码 / 重新生成）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-litkb',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const h = React.createElement

    /* ---------------- 全局开关 ---------------- */
    let openState = false
    const listeners = new Set()
    function setOpen(next) {
      openState = next
      for (const fn of listeners) fn(next)
    }
    function useOpen() {
      const [value, setValue] = useState(openState)
      useEffect(() => {
        const fn = (v) => setValue(v)
        listeners.add(fn)
        setValue(openState)
        return () => { listeners.delete(fn) }
      }, [])
      return value
    }

    const TABS = ['论文库', '横向精读', '图谱', '写作', '检索']
    const CHAIN_RELATIONS = [['supports', '支持'], ['contradicts', '反驳'], ['qualifies', '限定'], ['derives', '推导'], ['compares', '对比']]
    const CHAIN_ORIGIN = { claim: '论点先行', evidence: '证据先行', question: '问题先行', block: '原文段落' }
    const CHAIN_RELATION_LABELS = Object.fromEntries(CHAIN_RELATIONS)
    const CHAIN_KIND_LABELS = { claim: '论点', evidence: '证据', paper: '论文' }
    const STATUS = ['待读', '略读', '精读', '已引用', '弃读']
    const STATUS_COLOR = { 待读: '#8b949e', 略读: '#d29922', 精读: '#3fb950', 已引用: '#a371f7', 弃读: '#f85149' }
    const FILTERS = ['全部', '未归类', ...STATUS]

    function formatLocal(value) {
      const date = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(date.getTime())) return String(value || '')
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function shortAuthors(authors) {
      const first = String(authors || '').split(/[,，;；]/)[0].trim()
      return first || 'Anon'
    }

    function citationLabel(paper, page) {
      return `${shortAuthors(paper.authors)} ${paper.year || ''}, p.${page}`
    }

    function tagTone(name) {
      let hash = 0
      for (const ch of String(name || '')) hash = ((hash * 31) + ch.charCodeAt(0)) >>> 0
      return hash % 5
    }

    function storedNumber(key, fallback) {
      try {
        const value = Number(window.localStorage?.getItem(key))
        return Number.isFinite(value) && value > 0 ? value : fallback
      } catch {
        return fallback
      }
    }

    function storedWidth(key, fallback) {
      try {
        const value = Number(window.localStorage?.getItem(key))
        return Number.isFinite(value) && value > 0 ? value : fallback
      } catch {
        return fallback
      }
    }

    async function api(path, options) {
      const res = await fetch(path, options)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) {
        const err = new Error(body.error || `HTTP ${res.status}`)
        err.affected = body.affected
        throw err
      }
      return body
    }

