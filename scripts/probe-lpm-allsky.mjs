const text = await (
  await fetch('https://www.lightpollutionmap.info/assets/index-CrNFzVzd.js')
).text()

const ztIdx = text.indexOf('function zt(')
console.log('zt @', ztIdx)
console.log(text.slice(ztIdx, ztIdx + 400))

// Find ke base URL near api/allsky usage
const allskyIdx = text.indexOf('api/allsky?lat=')
console.log('context around allsky call:')
console.log(text.slice(allskyIdx - 200, allskyIdx + 250))

// Search for http(s) base that ends with /
for (const m of text.matchAll(/https?:\/\/[^"'\\\s]+/g)) {
  const u = m[0]
  if (/api|lightpollution|allsky/i.test(u)) console.log('url', u)
}

// zt() might decode a baked key
const ztBody = text.slice(ztIdx, ztIdx + 800)
const b64 = [...ztBody.matchAll(/[A-Za-z0-9+/=]{16,}/g)].map((x) => x[0])
console.log('b64 candidates in zt', b64)
