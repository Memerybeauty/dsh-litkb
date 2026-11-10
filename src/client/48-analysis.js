    /* ---------------- 方向分析（v0.16.0） ---------------- */
    const ANALYSIS_STANCE = {
      supports: ['支持', 'is-support'],
      contradicts: ['反驳', 'is-contra'],
      qualifies: ['限定', 'is-qualify'],
      mixed: ['混合', 'is-mixed'],
      mentions: ['提及', 'is-mention'],
      not_relevant: ['不符合', 'is-none'],
    }

    function analysisStance(value) {
      return ANALYSIS_STANCE[value] || ANALYSIS_STANCE.not_relevant
    }

    function AnalysisView({ theme, analysis, job, busy, onStart, onStop, onRetry, onChain }) {
      const [selected, setSelected] = useState(null)
      const [openEvidence, setOpenEvidence] = useState({})
      const running = Boolean(job && ['queued', 'running'].includes(job.status))
      const facets = (theme.facets || []).filter((facet) => facet.enabled)
      const missingFacets = analysis ? facets.filter((facet) => !analysis.facets?.[facet.key]) : []
      const papers = analysis ? Object.values(analysis.papers || {}).sort((a, b) => String(a.title).localeCompare(String(b.title))) : []
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

      const matrix = h('div', { className: 'litkb-anMatrixWrap' },
        h('table', { className: 'litkb-anMatrix' },
          h('thead', null,
            h('tr', null,
              h('th', { className: 'is-facet' }, '研究内容'),
              papers.map((paper) => h('th', { key: paper.paperId, title: paper.title },
                String(paper.title || paper.paperId).slice(0, 9))))),
          h('tbody', null,
            facets.map((facet) => h('tr', { key: facet.key },
              h('th', { className: 'is-facet', title: facet.title }, facet.title),
              papers.map((paper) => {
                const row = paper.facets?.[facet.key]
                const stance = analysisStance(row?.stance)
                return h('td', { key: paper.paperId },
                  h('button', {
                    type: 'button',
                    className: 'litkb-anStance ' + stance[1] + (selected?.paperId === paper.paperId && selected?.facetKey === facet.key ? ' is-on' : ''),
                    title: `${paper.title} · ${facet.title}：${row?.summary || '未涉及'}`,
                    onClick: () => setSelected({ paperId: paper.paperId, facetKey: facet.key }),
                  }, stance[0]))
              }))))))

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
