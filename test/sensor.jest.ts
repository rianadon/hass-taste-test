import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import { toMatchImageSnapshot } from 'jest-image-snapshot'

expect.extend({ toMatchImageSnapshot })

const CONFIGURATION_YAML = `
template:
 - sensor:
   - name: "Test sensor"
     state: 42
`

let hass: HomeAssistant<PlaywrightElement>

beforeAll(async () => {
    hass = await HomeAssistant.create(CONFIGURATION_YAML, {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
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
