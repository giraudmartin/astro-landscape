const text = await (
  await fetch('https://www.lightpollutionmap.info/assets/index-CrNFzVzd.js')
).text()
const i = text.indexOf('function Jc(')
console.log(text.slice(i, i + 3500))
