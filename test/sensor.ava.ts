import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import anyTest, { TestFn } from 'ava'

const test = anyTest as TestFn<{ hass: HomeAssistant<PlaywrightElement> }>

const CONFIGURATION_YAML = `
template:
 - sensor:
   - name: "Test sensor"
     state: 42
`

test.before(async (t) => {
    t.context.hass = await HomeAssistant.create(CONFIGURATION_YAML, {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
})

test.after.always(async (t) => await t.context.hass.close())

test('light theme', async (t) => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'sensor', entity: 'sensor.test_sensor' },
    ])

    t.is((await t.context.hass.states())['sensor.test_sensor'].state, '42')
    t.snapshot(await dashboard.cards[0].html())
})

test('dark theme', async (t) => {
    const dashboard = await t.context.hass.Dashboard(
        [{ type: 'sensor', entity: 'sensor.test_sensor' }],
        { colorScheme: 'dark' }
    )

    t.is((await t.context.hass.states())['sensor.test_sensor'].state, '42')
    t.snapshot(await dashboard.cards[0].html())
})
