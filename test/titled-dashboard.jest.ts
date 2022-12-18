import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import { PlaywrightPage } from '../src/integrations/playwright'

let hass: HomeAssistant<PlaywrightElement>

beforeAll(async () => {
    hass = await HomeAssistant.create('', {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
}, 30000)

afterAll(async () => await hass.close())

it('Dashboard with custom title', async () => {
    const dashboard = await hass.Dashboard([], { title: 'Custom' })
    const title = await (dashboard.page as PlaywrightPage).playwright.title()
    expect(title).toBe('Custom – Home Assistant')
})
