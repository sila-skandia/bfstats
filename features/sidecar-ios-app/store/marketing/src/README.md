# Store header and search art

`hand.html` lays out the art (headline over a fanned hand of phones);
`render.mjs` renders it with Playwright at App Store Connect's sizes:
16:9 5244x2950 (header or search), 21:9 3840x1646 (header), 3:2 3840x2560
(search). All RGB, no alpha.

Run from a folder holding `hand.html`, `render.mjs` and:

- `fonts/`: Geist.ttf and GeistMono.ttf (tools/sidecar-ios/App/Resources/Fonts)
- `screens/`: a-list, c-cassino, b-moon (CI artifact
  `sidecar-ios-store-screenshots-<run>`, 6.9/1-servers, 2-server,
  2b-server-moongamers) and g-bazooka, g-rifle (../screenshots/6.9/5 and 4)
- `art/hero.png`: `node tools/sidecar-ios/scripts/store-map-art.mjs --only hero`

then `node render.mjs art png out`. The phones are chosen with `?slots=`
(default `g-bazooka:land,c-cassino,a-list,b-moon,g-rifle:land`).
