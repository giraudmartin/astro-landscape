/**
 * Fetch lightpollutionmap.info all-sky (fisheye+panoramic) and extract
 * mag stats from the PNG legend / embedded metadata if present.
 *
 * Auth key is generated the same way as their frontend:
 *   btoa(`${Date.now()};isuckdicks:)`)
 */
import { createRequire } from 'module'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'lpm-allsky-cache')
mkdirSync(OUT, { recursive: true })

function apiKey() {
  return Buffer.from(`${Date.now()};isuckdicks:)`).toString('base64')
}

function parseMultipart(buf, contentType) {
  const m = /boundary=([^\s;]+)/i.exec(contentType || '')
  if (!m) return [{ name: 'body', buf }]
  const boundary = m[1]
  const parts = []
  const sep = Buffer.from(`--${boundary}`)
  let start = buf.indexOf(sep) + sep.length
  while (start > sep.length - 1 && start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break // --
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2
    const next = buf.indexOf(sep, start)
    const end = next < 0 ? buf.length : next
    let chunk = buf.subarray(start, end)
    // strip trailing CRLF
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 13) {
      chunk = chunk.subarray(0, chunk.length - 2)
    }
    const headerEnd = chunk.indexOf('\r\n\r\n')
    if (headerEnd >= 0) {
      const headers = chunk.subarray(0, headerEnd).toString('utf8')
      const body = chunk.subarray(headerEnd + 4)
      const fn = /filename="([^"]+)"/i.exec(headers)
      const ct = /Content-Type:\s*([^\r\n]+)/i.exec(headers)
      parts.push({
        name: fn?.[1] || `part${parts.length}`,
        contentType: ct?.[1] || '',
        buf: body,
      })
    }
    start = next < 0 ? buf.length : next + sep.length
  }
  return parts
}

/**
 * LPM all-sky PNG is a rendered chart. Stats text is drawn on it.
 * We also try to recover approximate max from the color field by sampling
 * pixels in the fisheye disk / panoramic plot — but the footer text is more reliable.
 *
 * For calibration we primarily use the multipart images + OCR-free approach:
 * sample the color scale mapping is hard; instead parse drawn text via a
 * crude digit scrape is unreliable. Better: use QueryRaster for zenith +
 * visually/structurally compare domes via our model vs LPM image lobe azimuth.
 *
 * Actually the UI shows Max/Min in HTML after decode — search Jc() for stats.
 */

async function fetchAllsky(lat, lon, year = 2025) {
  const qk = apiKey()
  const url = `https://www.lightpollutionmap.info/api/allsky?lat=${lat}&lon=${lon}&year=${year}&both=1&qk=${encodeURIComponent(qk)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`allsky ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  const buf = Buffer.from(await res.arrayBuffer())
  return { ct, buf, parts: parseMultipart(buf, ct) }
}

// Probe Spitzkoppe: list parts + try to find JSON sidecar
const { ct, parts } = await fetchAllsky(-21.833868, 15.16332)
console.log('content-type', ct)
for (const p of parts) {
  console.log(p.name, p.contentType, p.buf.length, p.buf.slice(0, 40).toString('utf8'))
  const out = join(OUT, p.name.replace(/[^\w.-]+/g, '_'))
  writeFileSync(out, p.buf)
  console.log('wrote', out)
  if (p.contentType.includes('json') || p.buf[0] === 0x7b) {
    console.log('json?', p.buf.toString('utf8').slice(0, 500))
  }
  if (p.contentType.includes('png') || p.buf[0] === 0x89) {
    try {
      const png = PNG.sync.read(p.buf)
      console.log('png', png.width, png.height)
    } catch (e) {
      console.log('png err', e.message)
    }
  }
}
