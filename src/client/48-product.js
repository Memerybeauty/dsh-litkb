    /* ---------------- 产品化：首次上手引导 ---------------- */
    const GUIDE_KEY = 'litkb.guide.dismissed'

    function guideStoredDismissed() {
      try { return window.localStorage?.getItem(GUIDE_KEY) === '1' } catch { return false }
    }

    function setGuideStoredDismissed(hidden) {
      try {
        if (hidden) window.localStorage?.setItem(GUIDE_KEY, '1')
        else window.localStorage?.removeItem(GUIDE_KEY)
      } catch { /* 隐私模式忽略 */ }
    }

    function notifyGuide(hidden) {
      setGuideStoredDismissed(hidden)
      try {
        window.dispatchEvent(new CustomEvent('litkb:guide', { detail: { dismissed: hidden } }))
      } catch { /* 非浏览器环境 */ }
    }

    function formatBytes(bytes) {
      const value = Number(bytes) || 0
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
      if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
      return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
    }

    function guideJump(item, { onImport, onOpenLibrary, onOpenWriting, onCreateTheme }) {
      if (!item) return
      if (item.key === 'paper' && onImport) onImport()
      else if (item.target === 'writing') onOpenWriting?.()
      else if (item.target === 'theme') onCreateTheme?.()
      else onOpenLibrary?.()
    }

    function OnboardingPanel({ guide, dismissed, force = false, onDismiss, onImport, onOpenLibrary, onOpenWriting, onCreateTheme }) {
      if (!guide || dismissed) return null
      const items = Array.isArray(guide.items) ? guide.items : []
      const total = Number(guide.total) || items.length
      const completed = Number(guide.completed) || items.filter((item) => item.done).length
      const allDone = total > 0 && completed >= total
      if (!total || (allDone && !force)) return null
      const welcome = !(guide.counts?.papers)
      const jump = (item) => guideJump(item, { onImport, onOpenLibrary, onOpenWriting, onCreateTheme })

      const steps = items.map((item, index) => h('button', {
        key: item.key,
        type: 'button',
        className: 'litkb-guideStep' + (item.done ? ' is-done' : '') + (guide.next === item.key ? ' is-next' : ''),
        title: item.hint || '',
        onClick: () => jump(item),
        disabled: item.done,
      },
      h('span', { className: 'litkb-guideNum', 'aria-hidden': 'true' }, item.done ? '✓' : String(index + 1)),
      h('span', { className: 'litkb-guideStepMain' },
        h('span', { className: 'litkb-guideStepTitle' }, item.title),
        h('span', { className: 'litkb-guideStepHint' }, item.hint || '')),
      h('span', { className: 'litkb-guideStepState' }, item.done ? `${item.count || 0}` : '去完成')))

      if (welcome) {
        return h('section', { className: 'litkb-guide is-welcome' },
          h('button', {
            type: 'button', className: 'litkb-guideClose', title: '不再显示上手引导',
            'aria-label': '不再显示上手引导', onClick: onDismiss,
          }, '×'),
          h('div', { className: 'litkb-guideIntro' },
            h('div', { className: 'litkb-guideKicker' }, '本地优先 · 证据可追溯'),
            h('div', { className: 'litkb-guideHeroTitle' }, '把论文变成可追溯的证据链'),
            h('div', { className: 'litkb-guideText' },
              '导入 PDF，生成七段卡与精读；每条结论都带 q-id 和页码，再带进研究、证据链与写作。'),
            h('div', { className: 'litkb-guideActions' },
              h('button', { type: 'button', className: 'litkb-btn', onClick: onImport }, '导入第一篇 PDF'),
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: onOpenLibrary }, '浏览论文库'),
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: onCreateTheme }, '新建研究'))),
          h('div', { className: 'litkb-guideSteps' }, steps))
      }

      return h('section', { className: 'litkb-guide is-progress' },
        h('div', { className: 'litkb-guideHead' },
          h('span', { className: 'litkb-guideTitle' }, allDone ? '上手完成' : '上手进度'),
          h('span', { className: 'litkb-guideCount' }, `${completed}/${total}`),
          h('span', { className: 'litkb-guideBar', 'aria-hidden': 'true' },
            h('span', { className: 'litkb-guideBarFill', style: { width: `${Math.round((completed / total) * 100)}%` } })),
          h('span', { className: 'litkb-spacer' }),
          h('button', { type: 'button', className: 'litkb-link', onClick: onDismiss }, allDone ? '关闭' : '不再显示')),
        allDone
          ? h('div', { className: 'litkb-guideText' }, '五个步骤都已完成。需要回看时，可在设置 →「上手引导」里重新显示。')
          : null,
        h('div', { className: 'litkb-guideList' }, steps))
    }

    /* ---------------- 产品化：入库自动管线状态 ---------------- */
    const INGEST_STEPS = [
      ['blocks', '原文解析'],
      ['card', '七段卡'],
      ['deepread', '精读'],
    ]

    function ingestMark(status) {
      if (status === 'done') return '✓'
      if (status === 'running') return '…'
      if (status === 'failed') return '!'
      if (status === 'skipped') return '–'
      return '·'
    }

    function ingestSummary(job) {
      if (!job?.steps) return ''
      return INGEST_STEPS.map(([key, label]) => `${label} ${ingestMark(job.steps[key]?.status)}`).join(' · ')
    }
