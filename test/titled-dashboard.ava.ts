import { HomeAssistant, PlaywrightBrowser, type PlaywrightElement } from '../src/index.ts'
import anyTest, { type TestFn } from 'ava'
import type { PlaywrightPage } from '../src/integrations/playwright.ts'

const test = anyTest as TestFn<{ hass: HomeAssistant<PlaywrightElement> }>

test.before(async (t) => {
    t.context.hass = await HomeAssistant.create('', {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
})

test.after.always(async (t) => await t.context.hass.close())

test('Dashboard with custom title', async (t) => {
    const dashboard = await t.context.hass.Dashboard([], { title: 'Custom' })
    const page = (dashboard.page as PlaywrightPage).playwright
    // The frontend sets the title once the dashboard loads; wait for it rather than sleeping
    await page.waitForFunction(() => document.title.startsWith('Custom')).catch(() => {})
    const title = await page.title()
    t.is(title, 'Custom – Home Assistant')
})
