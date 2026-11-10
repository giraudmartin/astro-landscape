/**
 * Build compact JSON catalogs for celestial search.
 *
 * Sources / licenses:
 * - HYG Database v4.1 (Astronexus) — CC BY-SA 4.0
 *   https://github.com/astronexus/HYG-Database
 * - OpenNGC (Mattia Verga) — CC BY-SA 4.0
 *   https://github.com/mattiaverga/OpenNGC
 * - IAU constellation names — public domain designations; French aliases curated.
 *
 * Usage:
 *   node scripts/build-celestial-catalogs.mjs
 *
 * Reads:
 *   scripts/_openngc_NGC.csv / _openngc_addendum.csv  (OpenNGC downloads)
 *   src/hygBrightStars.ts     (already in repo)
 *   src/constellationFigures.ts
 *
 * Writes:
 *   public/catalogs/stars.json
 *   public/catalogs/constellations.json
 *   public/catalogs/deep-sky.json
 *   public/catalogs/ATTRIBUTION.md
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public', 'catalogs')

const STAR_FR = {
  Sirius: ['Sirius'],
  Canopus: ['Canopus'],
  Arcturus: ['Arcturus'],
  Vega: ['Véga', 'Vega'],
  Capella: ['Capella'],
  Rigel: ['Rigel'],
  Procyon: ['Procyon'],
  Achernar: ['Achernar'],
  Betelgeuse: ['Bételgeuse', 'Betelgeuse'],
  Altair: ['Altair'],
  Aldebaran: ['Aldébaran', 'Aldebaran'],
  Spica: ['Spica'],
  Antares: ['Antarès', 'Antares'],
  Pollux: ['Pollux'],
  Fomalhaut: ['Fomalhaut'],
  Deneb: ['Deneb'],
  Regulus: ['Régulus', 'Regulus'],
  Castor: ['Castor'],
  Bellatrix: ['Bellatrix'],
  Polaris: ['Polaris', 'Étoile polaire'],
  'Rigil Kentaurus': ['Alpha du Centaure', 'Rigil Kentaurus'],
  Toliman: ['Toliman'],
  Hadar: ['Hadar'],
  Acrux: ['Acrux'],
  Mimosa: ['Mimosa'],
  Adhara: ['Adhara'],
  Gacrux: ['Gacrux'],
  Shaula: ['Shaula'],
  Elnath: ['Elnath'],
  Alnilam: ['Alnilam'],
  Alnitak: ['Alnitak'],
  Alioth: ['Alioth'],
  Mirfak: ['Mirfak'],
  Dubhe: ['Dubhe'],
  Alkaid: ['Alkaid'],
  Merak: ['Merak'],
  Phecda: ['Phecda'],
  Megrez: ['Megrez'],
  Mizar: ['Mizar'],
  Alcor: ['Alcor'],
  Saiph: ['Saiph'],
  Mintaka: ['Mintaka'],
}

/** Approximate geometric centers for IAU constellations absent from stick figures. */
const CONST_CENTERS_FALLBACK = {
  Cetus: { raHours: 1.67, decDeg: -7.0 },
  Mensa: { raHours: 5.7, decDeg: -77.5 },
  Microscopium: { raHours: 21.0, decDeg: -36.0 },
}

const CONST_FR = {
  Andromeda: ['Andromède', 'Andromeda'],
  Antlia: ['Machine pneumatique', 'Antlia'],
  Apus: ['Oiseau de paradis', 'Apus'],
  Aquarius: ['Verseau', 'Aquarius'],
  Aquila: ['Aigle', 'Aquila'],
  Ara: ['Autel', 'Ara'],
  Aries: ['Bélier', 'Aries'],
  Auriga: ['Cocher', 'Auriga'],
  Bootes: ['Bouvier', 'Bootes', 'Boötes'],
  Caelum: ['Burin', 'Caelum'],
  Camelopardalis: ['Girafe', 'Camelopardalis'],
  Cancer: ['Cancer', 'Crabe'],
  CanesVenatici: ['Chiens de chasse', 'Canes Venatici'],
  CanisMajor: ['Grand Chien', 'Canis Major'],
  CanisMinor: ['Petit Chien', 'Canis Minor'],
  Capricornus: ['Capricorne', 'Capricornus'],
  Carina: ['Carène', 'Carina'],
  Cassiopeia: ['Cassiopée', 'Cassiopeia'],
  Centaurus: ['Centaure', 'Centaurus'],
  Cepheus: ['Céphée', 'Cepheus'],
  Cetus: ['Baleine', 'Cetus'],
  Chamaeleon: ['Caméléon', 'Chamaeleon'],
  Circinus: ['Compas', 'Circinus'],
  Columba: ['Colombe', 'Columba'],
  ComaBerenices: ['Chevelure de Bérénice', 'Coma Berenices'],
  CoronaAustralis: ['Couronne australe', 'Corona Australis'],
  CoronaBorealis: ['Couronne boréale', 'Corona Borealis'],
  Corvus: ['Corbeau', 'Corvus'],
  Crater: ['Coupe', 'Crater'],
  Crux: ['Croix du Sud', 'Crux'],
  Cygnus: ['Cygne', 'Cygnus'],
  Delphinus: ['Dauphin', 'Delphinus'],
  Dorado: ['Dorade', 'Dorado'],
  Draco: ['Dragon', 'Draco'],
  Equuleus: ['Petit Cheval', 'Equuleus'],
  Eridanus: ['Éridan', 'Eridanus'],
  Fornax: ['Fourneau', 'Fornax'],
  Gemini: ['Gémeaux', 'Gemini'],
  Grus: ['Grue', 'Grus'],
  Hercules: ['Hercule', 'Hercules'],
  Horologium: ['Horloge', 'Horologium'],
  Hydra: ['Hydre', 'Hydra'],
  Hydrus: ['Hydre mâle', 'Hydrus'],
  Indus: ['Indien', 'Indus'],
  Lacerta: ['Lézard', 'Lacerta'],
  Leo: ['Lion', 'Leo'],
  LeoMinor: ['Petit Lion', 'Leo Minor'],
  Lepus: ['Lièvre', 'Lepus'],
  Libra: ['Balance', 'Libra'],
  Lupus: ['Loup', 'Lupus'],
  Lynx: ['Lynx'],
  Lyra: ['Lyre', 'Lyra'],
  Mensa: ['Table', 'Mensa'],
  Microscopium: ['Microscope', 'Microscopium'],
  Monoceros: ['Licorne', 'Monoceros'],
  Musca: ['Mouche', 'Musca'],
  Norma: ['Règle', 'Norma'],
  Octans: ['Octant', 'Octans'],
  Ophiuchus: ['Ophiuchus', 'Serpentaire'],
  Orion: ['Orion'],
  Pavo: ['Paon', 'Pavo'],
  Pegasus: ['Pégase', 'Pegasus'],
  Perseus: ['Persée', 'Perseus'],
  Phoenix: ['Phénix', 'Phoenix'],
  Pictor: ['Peintre', 'Pictor'],
  Pisces: ['Poissons', 'Pisces'],
  PiscisAustrinus: ['Poisson austral', 'Piscis Austrinus'],
  Puppis: ['Poupe', 'Puppis'],
  Pyxis: ['Boussole', 'Pyxis'],
  Reticulum: ['Réticule', 'Reticulum'],
  Sagitta: ['Flèche', 'Sagitta'],
  Sagittarius: ['Sagittaire', 'Sagittarius'],
  Scorpius: ['Scorpion', 'Scorpius'],
  Sculptor: ['Sculpteur', 'Sculptor'],
  Scutum: ['Écu de Sobieski', 'Scutum'],
  Serpens: ['Serpent', 'Serpens'],
  SerpensA: ['Serpent', 'Serpens'],
  SerpensB: ['Serpent', 'Serpens'],
  Sextans: ['Sextant', 'Sextans'],
  Taurus: ['Taureau', 'Taurus'],
  Telescopium: ['Télescope', 'Telescopium'],
  Triangulum: ['Triangle', 'Triangulum'],
  TriangulumAustrale: ['Triangle austral', 'Triangulum Australe'],
  Tucana: ['Toucan', 'Tucana'],
  UrsaMajor: ['Grande Ourse', 'Ursa Major'],
  UrsaMinor: ['Petite Ourse', 'Ursa Minor'],
  Vela: ['Voiles', 'Vela'],
  Virgo: ['Vierge', 'Virgo'],
  Volans: ['Poisson volant', 'Volans'],
  Vulpecula: ['Petit Renard', 'Vulpecula'],
}

const DSO_FR = {
  M31: ['Galerie d’Andromède', 'Galaxie d’Andromède', 'Andromeda Galaxy', 'Andromède'],
  M42: ['Nébuleuse d’Orion', 'Orion Nebula'],
  M45: ['Pléiades', 'Pleiades', 'Seven Sisters'],
  M13: ['Amas d’Hercule', 'Great Globular Cluster in Hercules'],
  M51: ['Galaxie du Tourbillon', 'Whirlpool Galaxy'],
  M57: ['Nébuleuse de la Lyre', 'Ring Nebula'],
  M27: ['Nébuleuse de l’Haltère', 'Dumbbell Nebula'],
  M1: ['Nébuleuse du Crabe', 'Crab Nebula'],
  M8: ['Nébuleuse de la Lagune', 'Lagoon Nebula'],
  M16: ['Nébuleuse de l’Aigle', 'Eagle Nebula'],
  M17: ['Nébuleuse Oméga', 'Omega Nebula', 'Swan Nebula'],
  M20: ['Nébuleuse Trifide', 'Trifid Nebula'],
  M33: ['Galaxie du Triangle', 'Triangulum Galaxy'],
  M81: ['Galaxie de Bode', "Bode's Galaxy"],
  M82: ['Galaxie du Cigare', 'Cigar Galaxy'],
  M104: ['Galaxie du Sombrero', 'Sombrero Galaxy'],
  NGC7000: ['Nébuleuse North America', 'North America Nebula', 'North America'],
  NGC6960: ['Dentelle du Cygne', 'Veil Nebula', 'Western Veil'],
  NGC6992: ['Dentelle du Cygne', 'Veil Nebula', 'Eastern Veil'],
  NGC2237: ['Nébuleuse de la Rosette', 'Rosette Nebula'],
  NGC2264: ['Nébuleuse du Cône', 'Cone Nebula', 'Christmas Tree Cluster'],
  NGC1976: ['Nébuleuse d’Orion', 'Orion Nebula'],
  NGC869: ['Double amas de Persée', 'Double Cluster'],
  NGC884: ['Double amas de Persée', 'Double Cluster'],
  NGC253: ['Galaxie du Sculpteur', 'Sculptor Galaxy'],
  NGC5128: ['Centaurus A'],
  NGC3372: ['Nébuleuse de la Carène', 'Carina Nebula', 'Eta Carinae Nebula'],
}

function parseRaToHours(ra) {
  // HH:MM:SS.s
  const m = String(ra).trim().match(/^(\d+):(\d+):([\d.]+)$/)
  if (!m) return null
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600
}

function parseDecToDeg(dec) {
  const m = String(dec)
    .trim()
    .match(/^([+-]?)(\d+):(\d+):([\d.]+)$/)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600)
}

function splitCsvLine(line) {
  // OpenNGC uses ';' and no quoted fields with semicolons in practice for our columns.
  return line.split(';')
}

function mapOpenNgcType(type) {
  switch (type) {
    case 'G':
    case 'GGroup':
    case 'GPair':
    case 'GTrpl':
      return 'galaxy'
    case 'PN':
      return 'nebula'
    case 'HII':
    case 'Neb':
    case 'EmN':
    case 'RfN':
    case 'SNR':
      return 'nebula'
    case 'OCl':
    case '*Ass':
      return 'cluster'
    case 'GCl':
      return 'cluster'
    case 'Cl+N':
      // Cluster + nebula complexes (e.g. M42) — surface as nebula for search UX.
      return 'nebula'
    case 'Dark':
      return 'nebula'
    case '**':
    case 'NonEx':
    case 'Other':
    case '*':
    case '**?':
      return 'star'
    default:
      return 'dso'
  }
}

function loadHygStars() {
  const src = fs.readFileSync(path.join(root, 'src', 'hygBrightStars.ts'), 'utf8')
  const json = src.match(/\[\{[\s\S]*\}\]/)?.[0]
  if (!json) throw new Error('Could not parse HYG_BRIGHT_STARS')
  const stars = JSON.parse(json)
  const out = []
  for (const star of stars) {
    const isHygFallback = /^HYG\s/i.test(star.name)
    const display = isHygFallback
      ? star.hip != null
        ? `HIP ${star.hip}`
        : star.name
      : star.name
    const aliases = []
    if (!isHygFallback && STAR_FR[star.name]) {
      for (const a of STAR_FR[star.name]) {
        if (a !== display) aliases.push(a)
      }
    }
    if (star.hip != null) {
      aliases.push(`HIP ${star.hip}`, `HIP${star.hip}`)
    }
    if (!isHygFallback && star.name !== display) aliases.push(star.name)
    out.push({
      id: star.hip != null ? `hip:${star.hip}` : `hyg:${star.raHours.toFixed(6)}:${star.decDeg.toFixed(6)}`,
      name: display,
      aliases: [...new Set(aliases)],
      catalogIds: {
        ...(star.hip != null ? { hip: star.hip } : {}),
      },
      type: 'star',
      raHours: star.raHours,
      decDeg: star.decDeg,
      mag: star.mag,
      constellation: null,
    })
  }
  return out
}

function loadConstellations() {
  const src = fs.readFileSync(
    path.join(root, 'src', 'constellationFigures.ts'),
    'utf8',
  )
  const json = src.match(/\[\{[\s\S]*\}\]/)?.[0]
  if (!json) throw new Error('Could not parse CONSTELLATION_FIGURES')
  const figures = JSON.parse(json)
  /** @type {Map<string, {raSum:number, decSum:number, n:number}>} */
  const acc = new Map()
  for (const fig of figures) {
    let key = fig.name
    if (key === 'SerpensA' || key === 'SerpensB') key = 'Serpens'
    let row = acc.get(key)
    if (!row) {
      row = { raSum: 0, decSum: 0, n: 0 }
      acc.set(key, row)
    }
    for (const p of fig.points) {
      // circular mean for RA via unit vectors in equatorial plane + Dec average
      row.raSum += p.raHours
      row.decSum += p.decDeg
      row.n += 1
    }
  }
  // Better RA circular mean
  const out = []
  for (const [key, _dummy] of acc) {
    const points = []
    for (const fig of figures) {
      const figKey =
        fig.name === 'SerpensA' || fig.name === 'SerpensB' ? 'Serpens' : fig.name
      if (figKey !== key) continue
      points.push(...fig.points)
    }
    let x = 0
    let y = 0
    let decSum = 0
    for (const p of points) {
      const raRad = (p.raHours / 24) * Math.PI * 2
      x += Math.cos(raRad)
      y += Math.sin(raRad)
      decSum += p.decDeg
    }
    const raHours = ((Math.atan2(y, x) / (Math.PI * 2)) * 24 + 24) % 24
    const decDeg = decSum / points.length
    const en = key.replace(/([a-z])([A-Z])/g, '$1 $2')
    const aliases = CONST_FR[key] ?? CONST_FR[en.replace(/\s/g, '')] ?? [en]
    const nameFr = aliases.find((a) => /[éèêàùôîçœÉÈÂ]/.test(a) || a !== en) ?? aliases[0]
    out.push({
      id: `const:${key}`,
      name: aliases[0] ?? en,
      aliases: [...new Set([en, key, ...aliases].filter(Boolean))],
      catalogIds: { iau: key },
      type: 'constellation',
      raHours: Number(raHours.toFixed(6)),
      decDeg: Number(decDeg.toFixed(6)),
      mag: null,
      constellation: key,
    })
  }
  for (const [key, center] of Object.entries(CONST_CENTERS_FALLBACK)) {
    if (out.some((row) => row.catalogIds.iau === key)) continue
    const en = key.replace(/([a-z])([A-Z])/g, '$1 $2')
    const aliases = CONST_FR[key] ?? [en]
    out.push({
      id: `const:${key}`,
      name: aliases[0] ?? en,
      aliases: [...new Set([en, key, ...aliases].filter(Boolean))],
      catalogIds: { iau: key },
      type: 'constellation',
      raHours: center.raHours,
      decDeg: center.decDeg,
      mag: null,
      constellation: key,
    })
  }

  // 88 unique (Serpens merged from A/B figures)
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

function parseDeepSkyCsv(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8')
  const lines = text.split(/\r?\n/)
  const header = splitCsvLine(lines[0])
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const rows = []

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    const cols = splitCsvLine(line)
    const name = cols[idx.Name]
    const type = cols[idx.Type]
    const messier = cols[idx.M]?.trim() || ''
    const isMessier = Boolean(messier)
    // Keep Messier entries even when OpenNGC marks them as ** / NonEx (e.g. M40).
    if (!name || type === 'DrkN') continue
    if ((type === '**' || type === 'NonEx') && !isMessier) continue
    const raHours = parseRaToHours(cols[idx.RA])
    const decDeg = parseDecToDeg(cols[idx.Dec])
    if (raHours == null || decDeg == null) continue
    const vMagRaw = cols[idx['V-Mag']]
    const bMagRaw = cols[idx['B-Mag']]
    const mag = vMagRaw ? Number(vMagRaw) : bMagRaw ? Number(bMagRaw) : null
    const ngc = cols[idx.NGC]?.trim() || ''
    const ic = cols[idx.IC]?.trim() || ''
    const common = (cols[idx['Common names']] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const constel = cols[idx.Const]?.trim() || null

    const hasCommon = common.length > 0
    const brightEnough = mag != null && Number.isFinite(mag) && mag <= 10.5
    const interestingType = [
      'PN',
      'HII',
      'Neb',
      'EmN',
      'RfN',
      'SNR',
      'OCl',
      'GCl',
      'Cl+N',
      '*Ass',
    ].includes(type)
    if (
      !isMessier &&
      !hasCommon &&
      !brightEnough &&
      !(interestingType && mag != null && mag <= 12)
    ) {
      continue
    }

    const catalogIds = {}
    const aliases = [...common]
    let primary = name
    if (messier) {
      const mId = `M${Number(messier)}`
      catalogIds.messier = Number(messier)
      aliases.push(mId, `M ${Number(messier)}`, `Messier ${Number(messier)}`)
      primary = mId
      const fr = DSO_FR[mId]
      if (fr) aliases.push(...fr)
    }
    if (name.startsWith('NGC')) {
      catalogIds.ngc = name.replace(/^NGC0+/, 'NGC')
      aliases.push(
        name,
        name.replace(/^NGC0+/, 'NGC'),
        name.replace(/^NGC/, 'NGC '),
      )
      const fr = DSO_FR[name.replace(/^NGC0+/, 'NGC')]
      if (fr) aliases.push(...fr)
    }
    if (name.startsWith('IC')) {
      catalogIds.ic = name.replace(/^IC0+/, 'IC')
      aliases.push(name, name.replace(/^IC0+/, 'IC'), name.replace(/^IC/, 'IC '))
    }
    if (ngc && !catalogIds.ngc) {
      const parts = ngc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts[0]) {
        catalogIds.ngc = `NGC${parts[0]}`
        aliases.push(`NGC${parts[0]}`, `NGC ${parts[0]}`)
      }
    }
    if (ic && !catalogIds.ic) {
      const parts = ic
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (parts[0]) {
        catalogIds.ic = `IC${parts[0]}`
        aliases.push(`IC${parts[0]}`, `IC ${parts[0]}`)
      }
    }
    if (common[0] && messier) {
      aliases.unshift(common[0])
    } else if (common[0] && !messier) {
      primary = common[0]
      aliases.push(name)
    }

    rows.push({
      id: `dso:${name}`,
      name: primary,
      aliases: [...new Set(aliases.filter(Boolean))],
      catalogIds,
      type: mapOpenNgcType(type),
      raHours: Number(raHours.toFixed(6)),
      decDeg: Number(decDeg.toFixed(6)),
      mag: mag != null && Number.isFinite(mag) ? Number(mag.toFixed(2)) : null,
      constellation: constel,
      openNgcType: type,
    })
  }
  return rows
}

function loadDeepSky() {
  const mainPath = path.join(root, 'scripts', '_openngc_NGC.csv')
  const addPath = path.join(root, 'scripts', '_openngc_addendum.csv')
  if (!fs.existsSync(mainPath)) {
    throw new Error('Missing scripts/_openngc_NGC.csv — download OpenNGC first')
  }
  const rows = [
    ...parseDeepSkyCsv(mainPath),
    ...(fs.existsSync(addPath) ? parseDeepSkyCsv(addPath) : []),
  ]

  // Deduplicate Messier preferred over NGC duplicate (same M)
  const byMessier = new Map()
  const rest = []
  for (const row of rows) {
    if (row.catalogIds.messier != null) {
      byMessier.set(row.catalogIds.messier, row)
    } else {
      rest.push(row)
    }
  }

  // M102 is historically ambiguous; OpenNGC often omits it. Map to NGC 5866 if present.
  if (!byMessier.has(102)) {
    const ngc5866 = rest.find(
      (row) =>
        row.catalogIds.ngc === 'NGC5866' ||
        row.id === 'dso:NGC5866' ||
        row.id === 'dso:NGC5866',
    )
    if (ngc5866) {
      byMessier.set(102, {
        ...ngc5866,
        id: 'dso:M102',
        name: 'M102',
        aliases: [
          ...new Set([
            ...ngc5866.aliases,
            'M102',
            'M 102',
            'Messier 102',
            'NGC5866',
          ]),
        ],
        catalogIds: { ...ngc5866.catalogIds, messier: 102 },
      })
    }
  }

  return [...byMessier.values(), ...rest]
}

function writeJson(file, data) {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(data))
  console.log(`wrote ${file} (${data.length ?? Object.keys(data).length} entries)`)
}

fs.mkdirSync(outDir, { recursive: true })

const stars = loadHygStars()
const constellations = loadConstellations()
const deepSky = loadDeepSky()

writeJson('stars.json', stars)
writeJson('constellations.json', constellations)
writeJson('deep-sky.json', deepSky)

fs.writeFileSync(
  path.join(outDir, 'ATTRIBUTION.md'),
  `# Celestial catalog attribution

Compiled for Photo Sightline / Astro Landscape search.

| File | Source | License |
|------|--------|---------|
| \`stars.json\` | HYG Database v4.1 (Astronexus), filtered mag ≤ 6 from in-repo \`hygBrightStars.ts\` | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| \`constellations.json\` | IAU 88 constellation designations; centers derived from in-repo stick figures (Alan MacRobert / Dominic Ford, CC BY 4.0) | Designations public domain; geometry CC BY 4.0 |
| \`deep-sky.json\` | [OpenNGC](https://github.com/mattiaverga/OpenNGC) (Mattia Verga) — Messier + bright/named NGC/IC subset | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

French common-name aliases are curated for search UX and are not an authoritative IAU translation.

Regenerate: \`node scripts/build-celestial-catalogs.mjs\`
`,
)

console.log('done')
