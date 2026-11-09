/**
 * 文稿 → DOCX。只做结构化转换，不改写正文。
 * 支持 #/##/### 标题、- 列表、空行与普通段落。
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

function lineToParagraph(line) {
  const heading = /^(#{1,3})\s+(.*)$/.exec(line)
  if (heading) {
    const level = heading[1].length === 1
      ? HeadingLevel.HEADING_1
      : heading[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
    return new Paragraph({ text: heading[2], heading: level })
  }
  const bullet = /^[-*]\s+(.*)$/.exec(line)
  if (bullet) return new Paragraph({ text: bullet[1], bullet: { level: 0 } })
  if (!line.trim()) return new Paragraph({ text: '' })
  return new Paragraph({ children: [new TextRun(line)] })
}

export async function draftToDocx(draft, references = []) {
  const children = [new Paragraph({ text: draft.title || '未命名文稿', heading: HeadingLevel.TITLE })]
  for (const line of String(draft.body || '').split('\n')) children.push(lineToParagraph(line))
  children.push(new Paragraph({ text: '参考文献', heading: HeadingLevel.HEADING_1 }))
  if (references.length) {
    for (const [index, ref] of references.entries()) {
      children.push(new Paragraph({ text: `[${index + 1}] ${ref.text || ref}` }))
    }
  } else {
    children.push(new Paragraph({ text: '（暂无引用）' }))
  }
  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}
