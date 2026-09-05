// Checked against the saved official 2025 catalog; never use a latest/composite URL.
export const DATA_SOURCES = {
  buildings: {
    year: 2025,
    lod: 1,
    retrievedAt: '2026-09-05T06:24:08.789548+00:00',
    sha256: 'dc2b322e126757e1bae9d38061b0fbc6c016a786b48fa610f9e7441452a82a91',
    url: 'https://assets.cms.plateau.reearth.io/assets/2f/68cfb0-341f-4e67-a522-89d844f79a85/03202_miyako-shi_city_2025_citygml_1_op_bldg_3dtiles_lod1/tileset.json',
    catalogUrl: 'https://www.geospatial.jp/ckan/dataset/plateau-03202-miyako-shi-2025',
    indexMapUrl: 'https://assets.cms.plateau.reearth.io/assets/df/6b6322-deea-4594-83a7-cbc713f8ab05/03202_indexmap_op.pdf',
    licenseUrl: 'https://www.mlit.go.jp/plateau/site-policy/',
  },
  terrain: {
    url: 'https://tile.plateauview.mlit.go.jp/terrain/',
    metadataUrl: 'https://tile.plateauview.mlit.go.jp/terrain/layer.json',
    documentationUrl: 'https://docs.plateauview.mlit.go.jp/datasets/terrain/',
    credit: '<a href="https://www.mlit.go.jp/plateau/">PLATEAU</a> | <a href="https://mapterhorn.com/">Mapterhorn</a> | <a href="https://www.gsi.go.jp/">国土地理院</a>',
  },
  imagery: {
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
    credit: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
    minimumLevel: 9,
    maximumLevel: 18,
  },
  population: {
    sha256: '2ca30e11eaf5328098c93af59a11ec2f55e73a727c3359f297a4667c628c0d59',
    url: '/data/miyako-population.geojson',
    metadataUrl: '/data/data-meta.json',
    borderUrl: '/data/miyako-border.geojson',
    sourceUrl: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-mesh500r6.html',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
} as const;

// Confirmed from the related ZIP's station GeoJSON, not a geocoding guess.
export const MIYAKO_STATION = { longitude: 141.94674615, latitude: 39.640204425 } as const;
