import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import { toMatchImageSnapshot } from 'jest-image-snapshot'

expect.extend({ toMatchImageSnapshot })

const CONFIGURATION_YAML = `
input_number:
  slider1:
    name: Slider
    initial: 30
    min: -20
    max: 35
    step: 1
  box1:
    name: Numeric Input Box
    initial: 30
    min: -20
    max: 35
    step: 1
    mode: box
`

let hass: HomeAssistant<PlaywrightElement>

beforeAll(async () => {
    hass = await HomeAssistant.create(CONFIGURATION_YAML, {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
}, 30000)

afterAll(async () => await hass.close())

it('input_number slider', async () => {
    const dashboard = await hass.Dashboard([
        { type: 'entities', entities: ['input_number.slider1'] },
    ])
    expect(await dashboard.cards[0].html()).toMatchSnapshot()
    await hass.callService(
        'input_number',
        'set_value',
        { value: 5 },
        { entity_id: 'input_number.slider1' }
    )
    expect(await dashboard.cards[0].html()).toMatchSnapshot()

    // BONUS: Image snapshot!
    expect(await dashboard.cards[0].screenshot()).toMatchImageSnapshot()
})

it('input_number box', async () => {
    const dashboard = await hass.Dashboard([{ type: 'entities', entities: ['input_number.box1'] }])
    expect(await dashboard.cards[0].html()).toMatchSnapshot()
    await hass.callService(
        'input_number',
        'set_value',
        { value: 5 },
        { entity_id: 'input_number.box1' }
    )
    expect(await dashboard.cards[0].html()).toMatchSnapshot()
})
