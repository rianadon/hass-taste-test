import { HomeAssistant, PlaywrightIntegration, PlaywrightElement } from '../src'
import { toMatchImageSnapshot } from 'jest-image-snapshot'

expect.extend({ toMatchImageSnapshot })

const CONFIGURATION_YAML = `
input_boolean:
  test:
`

let hass: HomeAssistant<PlaywrightElement>

beforeAll(async () => {
    hass = new HomeAssistant(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox'),
    })
    await hass.start()
    await hass.addResource(__dirname + '/resources/custom-card.js', 'module')
}, 30000)
afterAll(async () => await hass.close())

it('Custom Card', async () => {
    const dashboard = await hass.Dashboard([
        { type: 'custom:content-card-example', entity: 'input_boolean.test' },
    ])
    const card = dashboard.cards[0]
    expect(await card.html()).toMatchSnapshot()
    expect(await card.screenshot()).toMatchImageSnapshot()
})
