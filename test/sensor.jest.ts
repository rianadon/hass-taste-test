import HassTest from '../src/hass-test'
import PlaywrightIntegration, { Element } from '../src/integrations/playwright'
import { toMatchImageSnapshot } from 'jest-image-snapshot'

expect.extend({ toMatchImageSnapshot })

const CONFIGURATION_YAML = `
template:
 - sensor:
   - name: "Test sensor"
     state: 42
`

let hass: HassTest<Element>

beforeAll(async () => {
    hass = new HassTest(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox'),
    })
    await hass.start()
}, 30000)

afterAll(async () => await hass.close())

it('light theme', async () => {
    const dashboard = await hass.Dashboard([{ type: 'sensor', entity: 'sensor.test_sensor' }])

    expect(await dashboard.cards[0].screenshot()).toMatchImageSnapshot()
})

it('dark theme', async () => {
    const dashboard = await hass.Dashboard([{ type: 'sensor', entity: 'sensor.test_sensor' }], {
        colorScheme: 'dark',
    })

    expect(await dashboard.cards[0].screenshot()).toMatchImageSnapshot()
})
