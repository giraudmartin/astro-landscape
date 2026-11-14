/** Short astronomy anecdotes for the immersive terrain loader. */
export const ASTRO_LOADER_TIPS: readonly string[] = [
  'La Voie lactée compte environ 100 à 400 milliards d’étoiles.',
  'La lumière du Soleil met environ 8 minutes à nous atteindre.',
  'La Lune s’éloigne de la Terre d’environ 3,8 cm par an.',
  'Une nuit vraiment noire laisse voir 2 000 à 3 000 étoiles à l’œil nu.',
  'Polaris n’est pas l’étoile la plus brillante. Elle marque juste le nord.',
  'Les étoiles filantes sont surtout de petits grains de poussière.',
  'Andromède est à environ 2,5 millions d’années-lumière. C’est la galaxie visible à l’œil nu la plus lointaine.',
  'Jupiter pourrait contenir environ 1 300 Terres.',
  'La couleur d’une étoile révèle surtout sa température.',
  'Sans pollution lumineuse, la Voie lactée jette parfois une ombre faible.',
  'Une année-lumière fait environ 9 500 milliards de kilomètres.',
  'Sur la Lune, le ciel reste noir même en plein jour.',
  'Sirius est l’étoile la plus brillante du ciel nocturne après le Soleil.',
  'Saturne est moins dense que l’eau. Elle flotterait dans une baignoire assez grande.',
  'Les constellations sont des alignements trompe-l’œil. Les étoiles sont à des distances très différentes.',
  'Vénus est la planète la plus brillante du ciel. On la confond souvent avec un avion.',
  'Mars doit sa teinte rouille à l’oxyde de fer de son sol.',
  'Un jour sur Vénus dure plus longtemps qu’une année vénusienne.',
  'Neptune met environ 165 ans à faire le tour du Soleil.',
  'Il y a plus d’étoiles dans l’Univers observable que de grains de sable sur toutes les plages de la Terre.',
  'Betelgeuse est une supergéante rouge. Si on la mettait à la place du Soleil, elle avalerait Jupiter.',
  'La Station spatiale internationale fait le tour de la Terre en environ 90 minutes.',
  'L’airglow est une faible lueur naturelle de l’atmosphère, visible sous un ciel très sombre.',
  'La lumière de certaines étoiles visibles est partie avant la naissance des pyramides.',
  'Le Soleil pèse à lui seul environ 99,8 % de la masse du Système solaire.',
  'Les taches solaires sont plus froides que le reste de la surface du Soleil.',
  'Orion est l’une des constellations les plus faciles à reconnaître, même en ville.',
  'La Grande Ourse n’est pas une constellation complète. C’est un astérisme.',
  'Les aurores naissent quand le vent solaire excite l’atmosphère terrestre.',
  'Un trou noir stellaire peut peser plusieurs masses solaires dans une zone plus petite qu’une ville.',
  'Titan, lune de Saturne, a une atmosphère plus épaisse que celle de la Terre.',
  'Europe, lune de Jupiter, cache probablement un océan sous sa glace.',
  'La comète de Halley revient près de nous environ tous les 76 ans.',
  'Les anneaux de Saturne font des centaines de milliers de kilomètres de large, mais sont très fins.',
  'Alpha du Centaure est le système stellaire le plus proche du Soleil, à un peu plus de 4 années-lumière.',
  'La magnitude mesure la brillance apparente. Plus le chiffre est bas, plus l’objet est brillant.',
  'La pollution lumineuse peut faire disparaître la Voie lactée d’une ville entière.',
  'La photographie du ciel profite souvent d’expositions longues. La Terre tourne d’environ 15° par heure.',
  'Les nébuleuses brillantes sont surtout de l’hydrogène chauffé par de jeunes étoiles.',
  'Le rayonnement fossile du Big Bang baigne encore tout le ciel, à environ 2,7 K.',
  'La Lune montre toujours à peu près la même face à la Terre.',
  'Un équinoxe, le jour et la nuit durent à peu près autant partout sur Terre.',
  'Au pôle, le Soleil peut rester au-dessus de l’horizon pendant des mois.',
  'Les géocroiseurs sont des astéroïdes dont l’orbite croise celle de la Terre.',
  'La vitesse de la lumière dans le vide est d’environ 300 000 km/s.',
  'Les étoiles naissent dans des nuages froids de gaz et de poussière.',
  'Quand une étoile massive meurt, elle peut exploser en supernova.',
  'Notre galaxie a la forme d’un disque spiralé. Le Soleil n’est pas au centre.',
  'La ceinture de Kuiper, au-delà de Neptune, abrite Pluton et bien d’autres corps glacés.',
  'Observer le ciel, c’est aussi regarder dans le passé. Chaque photon a voyagé.',
]

/** Fisher–Yates shuffle. Returns a fresh array. */
export function shuffleAstroLoaderTips(
  tips: readonly string[] = ASTRO_LOADER_TIPS,
): string[] {
  const out = [...tips]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}
