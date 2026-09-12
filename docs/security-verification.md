# Minimal security fixes — local verification, 2026-09-06

This is new evidence for the security changes on top of clean `c0229a0` (`main`, initially equal to `origin/main`). `verification.md`, `mvp-verification.json`, and the existing MVP performance claims remain historical and were not rewritten. No commit, push, deployment, login, dependency update, data regeneration, or upstream source patch was performed.

## Findings, changes and impact

1. `src/map/createViewer.ts` omitted `showRenderLoopErrors`. Installed `@cesium/engine/Source/Widget/CesiumWidget.js` assigns its formatted error message to `innerHTML` (around lines 947–987). Set `showRenderLoopErrors: false`. `MapViewport`'s existing `scene.renderError` subscription, initialization catch, React text alert and retry button are unchanged. This removes only the unsafe library panel, not application error notifications.
2. `src/components/MapViewport.tsx` exposed live viewer/layer objects with only `?acceptance=1`. `vite.config.ts` now defines the compile-time boolean `__ACCEPTANCE__` from the explicit `acceptance` mode. Both hook creation and cleanup are gated and eliminated from normal production output. A query string cannot enable them. Acceptance mode writes **`dist-acceptance/`**, which is ignored and must never be deployed. `wrangler.jsonc` still points only to `dist/`. Normal dev mode also has no hooks.
3. `public/_headers` adds only `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(),microphone=(),geolocation=()` under `/*`. No CSP or frame policy was added. These capabilities are not used by the ordinary UI.
4. `public/NOTICE.txt`, `public/THIRD_PARTY_LICENSES.txt`, and `public/THIRD_PARTY_PROVENANCE.json` distribute notices, full collected license texts, and provenance. The software's root MIT `LICENSE` and all data-source credits remain independent and unchanged. **Known terms have been included, but full binary/asset legal clearance is not established; see the unresolved items below.**

## Reproduce locally

Node 22.22.1, npm 11.16.0, Chrome 152, Playwright 1.63.0, ANGLE SwiftShader. Browser runs use the existing harness, real published data, a temporary Chrome profile, a 120-second deadline and up to 15 seconds cleanup. They contact the existing map/building/terrain providers; IP address and requested tile regions are disclosed as in normal application use. They do not download Chrome or population originals.

```sh
npm run typecheck
npm test
npm run test:python
npm run data:verify

# Detailed inspection is explicitly local acceptance mode only.
npm run build:acceptance
BROWSER_ACCEPTANCE=1 npm run test:browser -- preview --stage mvp
BROWSER_ACCEPTANCE=1 MVP_SUITE=controls MVP_YEARS=2050 npm run test:browser -- preview --stage mvp
BROWSER_ACCEPTANCE=1 MVP_FOCUS=zero MVP_YEARS=2050 npm run test:browser -- preview --stage mvp

# Other existing detailed suites remain available, each separately bounded:
# BROWSER_ACCEPTANCE=1 MVP_FAULT=terrain npm run test:browser -- preview --stage mvp
# BROWSER_ACCEPTANCE=1 MVP_FOCUS=slope MVP_YEARS=2050 npm run test:browser -- dev --stage mvp

# Always finish with ordinary production. Do not deploy dist-acceptance.
npm run build
npm run test:browser -- preview --stage mvp
npm run test:headers
```

`BROWSER_ACCEPTANCE=1` instructs the harness to start Vite in explicit acceptance mode; it does not make ordinary production hooks reappear. `preview` consumes the corresponding existing output directory. Normal production tests use DOM/public controls only; the only reads of hook names assert that they are absent. No test bridge is added to the production app.

## New results

- Typecheck passed. **Vitest 242 tests passed** (241 existing + one explicit unsafe-panel configuration regression), **Python 16 tests passed**. `artifacts/security-vitest.json` records the Vitest result.
- Read-only `npm run data:verify` passed: 692 shapes, all **7,612 PTN values / 11 years**, border and metadata match the fixed originals. Git diff confirms `data/`, `public/data/`, root `LICENSE`, `package-lock.json` and historical verification documents are unchanged.
- Acceptance all-years: **95,306 ms + 3,478 ms cleanup**. All 692 cells at each of 11 years, numeric values, colors, B/L, entity/viewer/provider/building/camera identity, and no fixed-data refetch on year changes passed.
- Acceptance controls: **61,352 ms + 2,692 ms cleanup**. Year keyboard steps, real zero selection, opacity and three independent layer toggles passed.
- Acceptance zero-cell focus: **83,309 ms + 1,046 ms cleanup**. Real `drillPick` and a real pointer click selected `594115541` at 2070; B was 691.5698001732892 m. No synthetic population data was substituted.
- In all three acceptance runs, injected `scene.renderError.raiseEvent(scene, new Error(...))` with HTML-looking `img`/`svg` event-handler payloads. Asserted the real widget's unsafe panel flag is false, React alert text contains the exact payload, serialized HTML contains `&lt;img`, no injected elements or Cesium error panel exist, and no payload executes.
- Final ordinary production browser run: **68,304 ms + 875 ms cleanup**. Opened `?acceptance=1`; hooks stayed absent before/after interactions. Real map status reported 692 cells; public year control switched to 2020 and 2070, mesh selector switched station/zero cells, and visible population text matched the actual GeoJSON. The initial 2050 screenshot was visually inspected: terrain/map, population geometry, selected station and UI are displayed. Afterwards the harness forced a real Viewer initialization failure by making canvas `getContext` throw an HTML-looking error during reload. Existing React initialization alert retained it as escaped text with no unsafe panel, execution or hooks.
- Local Workers Static Assets: **10 response checks passed**, cleanup **100 ms**, owned process group stopped. Checked `/`, an SPA fallback route, an application JS chunk, a Cesium worker, **all four WASM files**, `NOTICE.txt` and `THIRD_PARTY_LICENSES.txt`. Each returned HTTP 200, exact expected file bytes, correct MIME and all three requested headers. This used **Wrangler 4.129.0 / local workerd**, not Vite. Script is `scripts/check_headers.mjs`; no authentication or deployment is involved.
- Final ordinary `dist`: **400 files, 17,471,904 bytes**. All 389 Cesium static files are byte-identical to installed upstream files. No source maps, local `/Users/ryota` paths, `__mvp` hook identifiers or `__ACCEPTANCE__` identifiers occur anywhere in the output. Existing upstream Rust compiler paths in WASM are not project paths.

New artifacts (ignored, local only):

- `artifacts/browser-security-production-mvp-preview.json` / `.png`
- `artifacts/browser-security-acceptance-mvp-preview.json` / `.png`
- `artifacts/browser-security-acceptance-mvp-preview-2050-controls.json` / `.png`
- `artifacts/browser-security-acceptance-mvp-preview-2050-zero.json` / `.png`
- `artifacts/browser-security-acceptance-mvp-preview-zero.png`
- `artifacts/security-workers-headers.json`

Browser reports include request/error/cleanup evidence. Earlier normal-production attempts also passed; one intermediate screenshot was taken too soon after a camera move and was blurry. The final report preserves the initial ready-map screenshot instead; it is the screenshot inspected above. Existing Vite large-chunk and SwiftShader quality/performance limitations remain. The editor's final diagnostics report one return-type error in untouched `node_modules/@cesium/engine/Source/Core/Credit.js:160` (function lacks an ending return); application typecheck/build pass, and no dependency source was changed to silence it. The historical four retry suites were preserved but not all rerun for this change.

## License audit method and actual scope

`vite.config.ts` records only dependency modules with rendered output in `artifacts/bundle-modules.json`. `scripts/distribution_licenses.mjs`, invoked after each supported npm build, combines that evidence with source labels in the matching installed Cesium **unminified worker distribution** and the explicitly copied zip worker/WASM. It does not label all npm transitives as shipped. It verifies installed package versions against the lockfile, copies applicable installed license/notice files, preserves relevant source-comment terms, checks SHA-256 of supplemental upstream license material, and checks every copied Cesium file against its source. It generates identical public/output notices without network access. Normal builds also fail on acceptance identifiers in output.

26 evidenced package names, installed/locked versions:

| Scope | Packages |
|---|---|
| React runtime | react 19.2.8; react-dom 19.2.8; scheduler 0.27.0 |
| Cesium | cesium 1.145.0; @cesium/engine 26.3.0; @cesium/widgets 16.2.0 |
| Runtime / worker evidence | @spz-loader/core 0.3.1; @tweenjs/tween.js 25.0.0; bitmap-sdf 1.0.4; dompurify 3.4.14; earcut 3.0.2; grapheme-splitter 1.0.4; jsep 1.4.0; kdbush 4.1.0; mersenne-twister 1.1.0; meshoptimizer 1.2.0; nosleep.js 0.12.0; quickselect 3.0.0; rbush 4.0.1; urijs 1.19.11 |
| Additional prebuilt worker/binary evidence | @cesium/wasm-splats 0.1.0-alpha.2; @zip.js/zip.js 2.11.1; draco3d 1.5.7; ktx-parse 1.1.0; lerc 2.0.0; pako 3.0.1 |

The last group's **installed versions are not proof of the versions used by Cesium's prebuilt workers**. In particular, Cesium `ThirdParty.json` lists zip.js 2.9.0 while the lock has 2.11.1, has older kdbush metadata, and omits newer dependencies. The generated provenance explicitly distinguishes rendered application modules from upstream worker source-label evidence.

### Included terms and source evidence

- Entire installed Cesium `LICENSE.md` files: Apache-2.0, copyrights, patent statements, shaders, Knockout/ES5, image/icon attributions and separately licensed code. No standalone upstream `NOTICE` exists in these installed Cesium packages; the official 1.145 root NOTICE URL also returned 404. `public/NOTICE.txt` is explicitly our distribution notice, not a fabricated upstream notice. Full upstream attribution text is retained, even where it mentions examples not copied.
- React/React DOM/Scheduler MIT notices; installed MIT, ISC, BSD and Apache texts for evidenced dependencies. DOMPurify's **Apache-2.0 alternative** is selected rather than MPL. `mersenne-twister`'s actual BSD-style source notice is preserved despite misleading MIT package metadata. URI.js's embedded Punycode notice is also retained.
- Pako's installed source map contains zlib copyright/permission notices missing from its standalone MIT LICENSE; these are extracted into the notices (the source map itself is not shipped). Babel's MIT license is supplemented because Pako's prebuilt output contains Babel helper code.
- Four copied WASMs: Basis, Draco, zip, and splat. Basis v1_15 / Draco 1.5.7 upstream licenses supplement Cesium's terms. No NOTICE was found at Basis v1_15 (the modern branch has one, which is not assumed applicable to the older binary).
- Splat WASM is byte-identical to installed `@cesium/wasm-splats`. Its npm archive has no license file. The upstream repository commit `96a2fbae7ab1d117dd533fe558f0e061bed6762b` declares 0.1.0-alpha.2; its full Apache license is included. Binary strings identify `dlmalloc 0.2.7`, `js-sys 0.3.77`, `once_cell 1.21.3`, `wasm-bindgen 0.2.100`, and rustc commit `05f9846f893b09a1be1fc8560e33fc3c815cfecb`. Their published license texts are included. `console_error_panic_hook 0.1.7` is included conservatively from upstream Cargo's default dependency, not claimed as independently version-proven from the binary.
- All copied assets, including unused ones, count as redistributed. Natural Earth, JHT moon imagery, NASA sky images, Mapbox Maki CC0, and Freepik/Flaticon CC BY 3.0 attribution/terms are retained. Maki CC0 and CC BY 3.0 legal text are included. No `.woff`, `.woff2`, `.ttf`, `.otf` or `.eot` files, or widget `@font-face`, were found; Source Sans Pro is a Cesium **documentation** font, not shipped here. Its upstream reference remains in the unabridged notices, without claiming that the font is distributed.
- `docs/license-sources/sources.json` records source URLs and hashes (crate archives also have archive hashes). `docs/license-sources/` holds the exact downloaded material. These are reviewed inputs, not dynamically fetched build dependencies. `main` URLs for Maki/Babel are identified as such, with captured hashes, not misrepresented as exact historical releases.

### Earlier evidence gaps (superseded by the focused follow-up below)

1. No reproducible source-to-binary build or complete linked SBOM was available for the prebuilt WASMs. Identified Rust notices are supplied, but binary strings are not a complete dependency inventory. Zip's compression backend, compiler/runtime support and all embedded codec subcomponents cannot be fully attributed from npm/worker metadata alone. Obtain upstream build manifests/third-party notices for these exact binary hashes before treating license compliance as complete.
2. Exact historical revisions and license-to-file mappings for every legacy texture/icon and map-provider thumbnail are not established. In particular `Widgets/Images/ImageryProviders/` contains third-party map previews/logos even though the picker is disabled. Cesium's umbrella notices do not independently prove each provider's redistribution/trademark permission. Confirm these rights with upstream or separately approve a narrowly scoped unused-asset exclusion; no assets were silently removed in this task.
3. Basis metadata says 1.15, but does not establish a specific subrelease/build or all linked components. The supplied v1_15 text is evidence, not independent binary verification. Supplemental current Maki/Babel terms likewise do not prove the exact legacy code/image revision.

The license work therefore resolves missing distribution of the collected known terms and exposes the remaining evidence gaps; it does **not** assert every third-party obligation is conclusively fulfilled. Preserve all notices/disclaimers, do not imply endorsement, and mark any future upstream source modifications as required by the applicable licenses.

## Focused license/distribution follow-up — 2026-09-06

This section supersedes the earlier publication holds above, without claiming blanket legal clearance.

- Added the exact Niantic SPZ MIT copyright/permission text from commit `cc5671d716740e02d57816d4a4a38d164926e695`, with URL, SHA-256 and acquisition date in `docs/license-sources/`. `@spz-loader/core 0.3.1` embeds SPZ in the map chunk; the wrapper's Apache license is not a substitute. The embedded-component provenance is now included in both generated distribution documents.
- `scripts/cesium-excluded-assets.json` lists exactly the previously reviewed 22 provider previews and nine NavigationHelp images. Vite excludes these files during copying, without modifying node_modules or deleting files manually. The post-build generator compares the complete source/output file sets, permitting only these 31 omissions, and verifies every retained asset byte-for-byte. All WASMs, workers, moon/sky textures and runtime credit images remain.
- NASA sky attribution now uses `NASA/Goddard Space Flight Center Scientific Visualization Studio`, with `https://svs.gsfc.nasa.gov/3572/`.
- The preceding investigation matched zip-module.wasm to official zip.js v2.9.0/zlib-streams and found the known BSD/zlib binary terms covered. A complete binary SBOM/reproducible build is not itself a universal MIT/BSD/Apache/zlib requirement. Remaining build/revision granularity is an evidence limitation, not an identified missing notice or an automatic publication blocker. Retained image notices and trademark/non-endorsement limitations still apply.

Focused local verification: ordinary `npm run build` (including typecheck and distribution assertions) passed; 358 unchanged Cesium assets retained, 31 excluded, 369 output files. The known >500 KB Cesium chunk warning remains. `node scripts/browser_smoke.mjs preview --stage mvp` passed against ordinary `dist`: real map/buildings/terrain ready, initial 2050 and 2020/2070 UI changes, two selected meshes checked against real population values, selected-mesh navigation, zero requests for the excluded images, no console/page/UI errors during interaction. The existing safe initialization-error check also passed. The screenshot was visually reviewed. No all-692-cells × 11-years geometry revalidation was run.

Evidence: `artifacts/browser-security-production-mvp-preview.json` and `.png`. The output map JS/CSS filenames stayed unchanged; changes are distribution assets/notices, configuration and verification only.

## Local versus post-deployment

No remote environment was tested or changed. After a separately authorized deployment of **ordinary `dist` only**, verify header/MIME/SPA behavior at the real hostname (including cache/CDN behavior), public UI map/year/selection, notice URL availability, and hook absence with `?acceptance=1`. The local `_headers` result is not a deployed-header claim. The focused follow-up resolves the identified SPZ notice omission and avoids distributing the 31 reviewed unused images; other evidence limitations are not blanket legal clearance. No CSP, framing hardening, general UI redesign, or unrelated performance refactor is included here.
