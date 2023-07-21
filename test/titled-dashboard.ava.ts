import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import anyTest, { TestFn } from 'ava'
import { PlaywrightPage } from '../src/integrations/playwright'

const test = anyTest as TestFn<{ hass: HomeAssistant<PlaywrightElement> }>

test.before(async (t) => {
    t.context.hass = await HomeAssistant.create('', {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
})

test.after.always(async (t) => await t.context.hass.close())

test('Dashboard with custom title', async (t) => {
    const dashboard = await t.context.hass.Dashboard([], { title: 'Custom' })
    await new Promise((r) => setTimeout(r, 1000)) // Give the page time
    const title = await (dashboard.page as PlaywrightPage).playwright.title()
    t.is(title, 'Custom – Home Assistant')
})
