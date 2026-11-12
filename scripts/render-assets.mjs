// Renders the listing images (assets/*.png) from assets/src/*.html with Playwright's Chromium.
// The panel captures they show come from `orca plugin shot` on the showcase scenarios:
//   orca plugin shot . --panel claude-memory --scenario showcase --width 400 --height 760 --out docs/images/verify.png
//   (and showcaseRecent → recent.png, showcaseAll → all.png), with Orca's window hidden.
// Run: npm run assets (installs Playwright without saving it, then renders)
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const src = (name) => new URL(`../assets/src/${name}.html`, import.meta.url).href
const out = (name) => fileURLToPath(new URL(`../assets/${name}.png`, import.meta.url))
const images = [
  { name: 'icon', width: 256, height: 256, transparent: true },
  { name: 'cover', width: 1600, height: 1000 },
  { name: 'screenshot', width: 1600, height: 1000 }
]

const browser = await chromium.launch()
try {
  for (const { name, width, height, transparent } of images) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    await page.goto(src(name))
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: out(name), omitBackground: Boolean(transparent) })
    await page.close()
    console.log(`assets/${name}.png ${width}×${height}`)
  }
} finally {
  await browser.close()
}
