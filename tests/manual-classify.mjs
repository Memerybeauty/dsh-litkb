import { readFileSync } from 'node:fs'
import { extractPdf } from '../lib/pdf.js'
import { classify } from '../lib/classify.js'
import { readTags } from '../lib/library.js'

const files = process.argv.slice(2)
const tags = readTags().tags
for (const f of files) {
  const t0 = Date.now()
  const buf = readFileSync(f)
  const ex = await extractPdf(buf)
  const meta = classify({ text: ex.text, filename: f.split('/').pop(), info: ex.info }, tags)
  console.log('---', f.split('/').pop())
  console.log(`pages=${ex.numPages} chars=${ex.chars} quality=${ex.quality} ms=${Date.now() - t0}`)
  console.log(JSON.stringify(meta))
}
