import { HomeAssistant, PlaywrightBrowser, type PlaywrightElement } from '../src/index.ts'
import type { PlaywrightPage } from '../src/integrations/playwright.ts'

let hass: HomeAssistant<PlaywrightElement>

beforeAll(async () => {
    hass = await HomeAssistant.create('', {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
}, 30000)

afterAll(async () => await hass.close())

it('Dashboard with custom title', async () => {
    const dashboard = await hass.Dashboard([], { title: 'Custom' })
    const page = (dashboard.page as PlaywrightPage).playwright
    // The frontend sets the title once the dashboard loads; wait for it rather than sleeping
    await page.waitForFunction(() => document.title.startsWith('Custom')).catch(() => {})
    const title = await page.title()
    expect(title).toBe('Custom – Home Assistant')
})
