import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import anyTest, { TestInterface } from 'ava'

const test = anyTest as TestInterface<{ hass: HomeAssistant<PlaywrightElement> }>

const CONFIGURATION_YAML = `
input_boolean:
  test:
`

test.before(async (t) => {
    t.context.hass = new HomeAssistant(CONFIGURATION_YAML, {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
    await t.context.hass.start()
    await t.context.hass.addResource(__dirname + '/resources/custom-card.js', 'module')
})

test.after.always(async (t) => await t.context.hass.close())

test('Custom Card', async (t) => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'custom:content-card-example', entity: 'input_boolean.test' },
    ])
    const card = dashboard.cards[0]
    t.snapshot(await card.html())
})
