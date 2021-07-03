import HassTest from '../src/hass-test'
import PlaywrightIntegration from '../src/integrations/playwright'

const CONFIGURATION_YAML = `
input_number:
  slider1:
    name: Slider
    initial: 30
    min: -20
    max: 35
    step: 1
`

let hass: HassTest;

beforeAll(async () => {
    hass = new HassTest(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration('firefox')
    })
    await hass.start()
})

afterAll(async () => await hass.close())

it('entity card with slider', async () => {
    const dashboard = await hass.Dashboard([
        { type: 'entities', entities: ['input_number.slider1'] }
    ])
    expect(await dashboard.cards[0].html()).toMatchSnapshot();
})
