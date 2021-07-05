import HassTest from '../src/hass-test'
import PlaywrightIntegration, { Element } from '../src/integrations/playwright'
import anyTest, { TestInterface } from 'ava'

const test = anyTest as TestInterface<{ hass: HassTest<Element> }>

const CONFIGURATION_YAML = `
template:
 - sensor:
   - name: "Test sensor"
     state: 42
`

test.before(async (t) => {
    t.context.hass = new HassTest(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox'),
    })
    await t.context.hass.start()
})

test.after.always(async (t) => await t.context.hass.close())

test('light theme', async (t) => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'sensor', entity: 'sensor.test_sensor' },
    ])

    t.snapshot(await dashboard.cards[0].html())
})

test('dark theme', async (t) => {
    const dashboard = await t.context.hass.Dashboard(
        [{ type: 'sensor', entity: 'sensor.test_sensor' }],
        { colorScheme: 'dark' }
    )

    t.snapshot(await dashboard.cards[0].html())
})