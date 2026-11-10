    /* ---------------- 方向分析（v0.16.0） ---------------- */
    const ANALYSIS_STANCE = {
      supports: ['支持', 'is-support', '✓'],
      contradicts: ['反驳', 'is-contra', '✕'],
      qualifies: ['限定', 'is-qualify', '△'],
      mixed: ['混合', 'is-mixed', '◐'],
      mentions: ['提及', 'is-mention', '·'],
      not_relevant: ['不符合', 'is-none', '—'],
    }

    function analysisStance(value) {
      return ANALYSIS_STANCE[value] || ANALYSIS_STANCE.not_relevant
    }

    function AnalysisView({ theme, analysis, job, busy, onStart, onStop, onRetry, onChain }) {
      const [selected, setSelected] = useState(null)
      const [openEvidence, setOpenEvidence] = useState({})
      const [showAll, setShowAll] = useState(false)
      const [hover, setHover] = useState({ r: '', c: '' })
      const running = Boolean(job && ['queued', 'running'].includes(job.status))
      const facets = (theme.facets || []).filter((facet) => facet.enabled)
      const missingFacets = analysis ? facets.filter((facet) => !analysis.facets?.[facet.key]) : []
      const paperScore = (paper) => Object.values(paper.facets || {}).filter((item) => Number(item?.relevance) > 0).length
      const allPapers = analysis
        ? Object.values(analysis.papers || {}).sort((a, b) => paperScore(b) - paperScore(a) || String(a.title).localeCompare(String(b.title)))
        : []
      const relevantPapers = allPapers.filter((paper) => paperScore(paper) > 0)
      const visiblePapers = showAll || !relevantPapers.length ? allPapers : relevantPapers
      const paperNumber = new Map(allPapers.map((paper, index) => [paper.paperId, `P${index + 1}`]))
      const stats = analysis?.stats || { papers: 0, relevant: 0, viewpoints: 0, gaps: 0 }
      const selectedPaper = selected ? analysis?.papers?.[selected.paperId] : null
      const selectedFacet = selected ? facets.find((facet) => facet.key === selected.facetKey) : null
      const selectedAnalysis = selectedPaper && selectedFacet ? selectedPaper.facets?.[selectedFacet.key] : null

      const toggleEvidence = (key) => setOpenEvidence((current) => ({ ...current, [key]: !current[key] }))

      const progress = job && job.total
        ? h('div', { className: 'litkb-anProgress', role: 'status' },
            h('div', { className: 'litkb-anProgressTop' },
              h('span', null, running ? `分析中：${job.step || ''}` : (job.status === 'done' ? '分析完成' : (job.step || '分析失败'))),
              h('span', null, `${job.done || 0}/${job.total || 0}`)),
            h('div', { className: 'litkb-anProgressBar' },
              h('span', { style: { width: `${Math.min(100, Math.round(((job.done || 0) / Math.max(1, job.total)) * 100))}%` } })))
        : null

      if (!analysis) {
        return h('div', { className: 'litkb-anPage' },
          h('div', { className: 'litkb-anHead' },
            h('div', null,
              h('div', { className: 'litkb-colTitle' }, '方向分析'),
              h('div', { className: 'litkb-anIntro' },
                '对进入这个研究方向的每篇论文做全文审查：哪些内容符合、哪些不符合，每篇论文是什么观点，再归纳观点之间的一致与分歧。')),
            h('div', { className: 'litkb-anActions' },
              running ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: onStop }, '停止') : null,
              h('button', {
                type: 'button', className: 'litkb-btn', disabled: running || busy,
                onClick: onStart,
              }, running ? '分析中…' : '开始分析'))),
          progress,
          h('div', { className: 'litkb-anEmpty' },
            h('div', { className: 'litkb-anEmptyTitle' }, '还没有方向分析'),
            h('div', { className: 'litkb-anEmptyText' },
              '现有证据链是关键词候选；方向分析会逐篇读全文，按研究内容判断符合度，并把不同论文的观点放在一起比较。'),
            h('div', { className: 'litkb-anEmptyHint' },
              '建议先确认研究内容和论文清单，再运行；分析结果不会覆盖精读与已有链。')))
      }

      const facetCounts = (facetKey) => {
        const counts = { supports: 0, contradicts: 0, qualifies: 0, mixed: 0, mentions: 0 }
        for (const paper of allPapers) {
          const stance = paper.facets?.[facetKey]?.stance
          if (stance in counts) counts[stance] += 1
        }
        return counts
      }

      // 每篇论文的命中条数（relevance > 0 的研究内容数）
      const hitCount = (paper) => Object.values(paper.facets || {}).filter((item) => Number(item?.relevance) > 0).length
      const shortTitle = (title) => String(title || '').replace(/^\s*\d+\s*/, '').replace(/\s+/g, ' ').trim()
      const hotRow = (facetKey) => hover.r === facetKey
      const hotCol = (paperId) => hover.c === paperId

      const headerRow = h('tr', null,
        h('th', { className: 'is-facet' }, '研究内容'),
        visiblePapers.map((paper) => h('th', {
          key: paper.paperId, className: 'is-paper', title: paper.title,
        }, paperNumber.get(paper.paperId))),
        h('th', { className: 'is-sum' }, '覆盖'))

      const body = h('tbody', null,
        facets.map((facet) => {
          const row = analysis.facets?.[facet.key]
          const counts = facetCounts(facet.key)
          const relevant = Number(row?.relevantCount ?? 0)
          const total = visiblePapers.length
          const pct = total ? Math.round((relevant / total) * 100) : 0
          const headCell = h('th', {
            className: 'is-facet' + (hotRow(facet.key) ? ' is-hot' : ''),
            title: facet.title,
            onMouseEnter: () => setHover((h0) => ({ r: facet.key, c: h0.c })),
            onMouseLeave: () => setHover((h0) => ({ r: '', c: h0.c })),
          },
            h('div', { className: 'litkb-anFacetName' }, facet.title),
            h('div', { className: 'litkb-anFacetBar', title: `相关 ${relevant}/${total}` },
              h('i', { style: { width: `${pct}%` } })),
            h('div', { className: 'litkb-anFacetCounts' },
              h('span', { className: 'is-relevant' }, `相关 ${relevant}`),
              counts.supports ? h('span', { className: 'is-support' }, `✓${counts.supports}`) : null,
              counts.qualifies ? h('span', { className: 'is-qualify' }, `△${counts.qualifies}`) : null,
              counts.contradicts ? h('span', { className: 'is-contra' }, `✕${counts.contradicts}`) : null,
              counts.mentions ? h('span', { className: 'is-mention' }, `·${counts.mentions}`) : null))
          const cells = visiblePapers.map((paper) => {
            const cell = paper.facets?.[facet.key]
            const stance = analysisStance(cell?.stance)
            return h('td', {
              key: paper.paperId,
              className: hotCol(paper.paperId) ? 'is-hot' : '',
              onMouseEnter: () => setHover({ r: facet.key, c: paper.paperId }),
            },
              h('button', {
                type: 'button',
                className: 'litkb-anStance is-icon ' + stance[1] + (selected?.paperId === paper.paperId && selected?.facetKey === facet.key ? ' is-on' : ''),
                title: `${paper.title} · ${facet.title}：${stance[0]}${cell?.summary ? `｜${cell.summary}` : ''}`,
                'aria-label': `${paper.title} ${facet.title} ${stance[0]}`,
                onClick: () => setSelected({ paperId: paper.paperId, facetKey: facet.key }),
              }, stance[2]))
          })
          return h('tr', { key: facet.key }, headCell, cells,
            h('td', { className: 'is-sum' }, `${relevant}/${total}`))
        }))

      const footRow = h('tfoot', null,
        h('tr', null,
          h('th', { className: 'is-facet' }, '每篇命中'),
          visiblePapers.map((paper) => h('th', {
            key: paper.paperId, className: 'is-paper', title: `${paper.title}：${hitCount(paper)} 条研究内容有匹配`,
          }, hitCount(paper))),
          h('th', { className: 'is-sum' }, '')))

      const table = h('table', {
        className: 'litkb-anMatrix',
        'aria-label': '研究内容与论文方向矩阵',
        onMouseLeave: () => setHover({ r: '', c: '' }),
      },
        h('thead', null, headerRow),
        body,
        footRow)

      // 图例与论文编号移到表格上方，避免视线在表格与页脚之间来回跳
      const legendRow = h('div', { className: 'litkb-anLegendGroup' },
        Object.values(ANALYSIS_STANCE).map(([label, cls, icon]) => h('span', { key: label, className: 'litkb-anLegendItem ' + cls },
          h('b', null, icon), label)))
      const nameList = h('div', { className: 'litkb-anPaperLegend' },
        visiblePapers.map((paper) => h('span', { key: paper.paperId, className: 'litkb-anPaperLegendItem', title: paper.title },
          h('b', null, paperNumber.get(paper.paperId)),
          shortTitle(paper.title).slice(0, 30))))

      const matrix = h('div', { className: 'litkb-anMatrixBlock' },
        h('div', { className: 'litkb-anMatrixHead' },
          h('div', { className: 'litkb-anMatrixTitle' }, '研究内容 × 论文'),
          h('label', { className: 'litkb-anToggle' },
            h('input', {
              type: 'checkbox', checked: showAll,
              onChange: (e) => setShowAll(e.target.checked),
            }),
            `显示全部论文（${allPapers.length}）`)),
        h('div', { className: 'litkb-anMatrixAside' }, legendRow, nameList),
        h('div', { className: 'litkb-anMatrixWrap' }, table))

      const detail = selectedPaper && selectedAnalysis
        ? h('div', { className: 'litkb-anDetail' },
            h('div', { className: 'litkb-anDetailHead' },
              h('div', null,
                h('div', { className: 'litkb-anDetailTitle' }, selectedPaper.title),
                h('div', { className: 'litkb-anDetailMeta' },
                  `${selectedFacet.title} · ${analysisStance(selectedAnalysis.stance)[0]} · 相关度 ${selectedAnalysis.relevance}/3`)),
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setSelected(null) }, '收起')),
            selectedAnalysis.summary ? h('div', { className: 'litkb-anDetailSummary' }, selectedAnalysis.summary) : null,
            selectedAnalysis.rationale ? h('div', { className: 'litkb-anDetailRationale' }, selectedAnalysis.rationale) : null,
            (selectedAnalysis.claims || []).length
              ? h('div', { className: 'litkb-anClaims' },
                  selectedAnalysis.claims.map((claim, index) => h('div', { key: index, className: 'litkb-anClaim' },
                    h('span', { className: 'litkb-anClaimRole' }, claim.role),
                    h('span', null, claim.text),
                    claim.evidenceIds?.length
                      ? h('span', { className: 'litkb-anClaimEvidence' },
                          claim.evidenceIds.map((id) => {
                            const ev = selectedPaper.evidence?.[id]
                            return h('span', { key: id, className: 'litkb-anQuote', title: ev?.quote || id },
                              `p.${ev?.page ?? '?'} ${String(ev?.quote || id).slice(0, 46)}`)
                          }))
                      : h('span', { className: 'litkb-anUnsupported' }, '无 q-id')))
              )
              : h('div', { className: 'litkb-anDetailEmpty' }, '这篇论文在这条研究内容上没有抽到明确观点。'))
        : null

      const viewpointSections = facets.map((facet) => {
        const row = analysis.facets?.[facet.key]
        const viewpoints = row?.viewpoints || []
        return h('section', { key: facet.key, className: 'litkb-anFacet' },
          h('div', { className: 'litkb-anFacetHead' },
            h('div', null,
              h('div', { className: 'litkb-anFacetTitle' }, facet.title),
              h('div', { className: 'litkb-anFacetMeta' },
                `${row?.relevantCount ?? 0} 篇涉及 · ${viewpoints.length} 个观点` +
                (row?.disagreements?.length ? ` · ${row.disagreements.length} 处分歧` : '') +
                (row?.fallback ? ' · 已回退' : ''))),
            h('span', { className: 'litkb-anFacetKey' }, facet.key)),
          viewpoints.length
            ? viewpoints.map((viewpoint) => h('div', { key: viewpoint.id, className: 'litkb-anVp' },
                h('div', { className: 'litkb-anVpTop' },
                  h('span', { className: 'litkb-anVpId' }, viewpoint.id),
                  h('span', { className: 'litkb-anVpStatement' }, viewpoint.statement),
                  h('button', {
                    type: 'button', className: 'litkb-miniBtn',
                    title: '把这条观点生成一条草稿链，进入审核队列',
                    onClick: () => onChain(facet.key, viewpoint.id),
                  }, '生成观点链')),
                h('div', { className: 'litkb-anVpPapers' },
                  (viewpoint.papers || []).map((paperId) => {
                    const paper = analysis.papers?.[paperId]
                    return h('span', { key: paperId, className: 'litkb-anPaperChip', title: paper?.title || paperId },
                      String(paper?.title || paperId).slice(0, 18))
                  })),
                (viewpoint.agreements || []).length
                  ? h('div', { className: 'litkb-anCmp is-agree' }, h('b', null, '一致'), viewpoint.agreements.join('；'))
                  : null,
                (viewpoint.disagreements || []).length
                  ? h('div', { className: 'litkb-anCmp is-disagree' }, h('b', null, '分歧'), viewpoint.disagreements.join('；'))
                  : null,
                (viewpoint.evidence || []).length
                  ? h('div', { className: 'litkb-anEvidence' },
                      h('button', {
                        type: 'button', className: 'litkb-anEvidenceToggle',
                        onClick: () => toggleEvidence(`${facet.key}:${viewpoint.id}`),
                      }, `${openEvidence[`${facet.key}:${viewpoint.id}`] ? '收起证据' : `查看证据 ${viewpoint.evidence.length}`} `),
                      openEvidence[`${facet.key}:${viewpoint.id}`]
                        ? viewpoint.evidence.map((item) => h('div', { key: `${item.paperId}:${item.evidenceId}`, className: 'litkb-anEvidenceRow' },
                            h('span', { className: 'litkb-anEvidencePage' }, `p.${item.page ?? '?'}`),
                            h('span', null, item.quote || item.evidenceId)))
                        : null)
                  : h('div', { className: 'litkb-anUnsupported' }, '这个观点还没有绑定 q-id 证据')))
            : h('div', { className: 'litkb-anGap' },
                `空缺：${row?.gaps?.[0] || '还没有论文涉及这条研究内容'}`),
          row?.fallback
            ? h('div', { className: 'litkb-anGap' }, '观点综合被截断，已回退为逐篇观点，建议重试这条研究内容。')
            : null,
          (row?.agreements || []).length
            ? h('div', { className: 'litkb-anCmp is-agree' }, h('b', null, '整体一致'), row.agreements.join('；'))
            : null,
          (row?.disagreements || []).length
            ? h('div', { className: 'litkb-anCmp is-disagree' }, h('b', null, '整体分歧'), row.disagreements.join('；'))
            : null)
      })

      return h('div', { className: 'litkb-anPage' },
        h('div', { className: 'litkb-anHead' },
          h('div', null,
            h('div', { className: 'litkb-colTitle' }, '方向分析'),
            h('div', { className: 'litkb-anIntro' },
              '逐篇全文审查：符合 / 部分符合 / 不符合，观点、一致与分歧。')),
          h('div', { className: 'litkb-anActions' },
            running ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: onStop }, '停止') : null,
            !running && missingFacets.length
              ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: onRetry },
                  `重试失败项 ${missingFacets.length}`)
              : null,
            h('button', {
              type: 'button', className: 'litkb-btn', disabled: running || busy,
              onClick: onStart,
            }, running ? '分析中…' : '重新分析'))),
        progress,
        h('div', { className: 'litkb-anStats' },
          h('span', null, `${stats.papers} 篇已分析`),
          h('span', null, `${stats.relevant} 篇涉及`),
          h('span', null, `${stats.viewpoints} 个观点`),
          h('span', null, `${stats.gaps} 个缺口`)),
        matrix,
        detail,
        viewpointSections,
        job?.errors?.length
          ? h('div', { className: 'litkb-anErrors' },
              h('div', { className: 'litkb-anErrorsTitle' }, '部分论文分析失败'),
              job.errors.slice(0, 6).map((error, index) => h('div', { key: index, className: 'litkb-anErrorLine' },
                `${error.paperId || error.facetKey || ''}：${error.message}`)))
          : null)
    }
