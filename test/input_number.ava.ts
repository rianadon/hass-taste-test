import HassTest, { multiply } from '../src/hass-test'
import PlaywrightIntegration, { Element } from '../src/integrations/playwright'
import anyTest, {TestInterface} from 'ava'

const test = anyTest as TestInterface<{ hass: HassTest<Element> }>

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

test.before(async t => {
    t.context.hass = new HassTest(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox')
    })
    await t.context.hass.start()
})

test.after.always(async t => await t.context.hass.close())

test('input_number slider', async t => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'entities', entities: ['input_number.slider1'] }
    ])
    t.snapshot(await dashboard.cards[0].html())
    await t.context.hass.callService('input_number', 'set_value', { value: 5 }, { entity_id: 'input_number.slider1' })
    t.snapshot(await dashboard.cards[0].html())
})

test('input_number box', async t => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'entities', entities: ['input_number.box1'] }
    ])
    t.snapshot(await dashboard.cards[0].html())
    await t.context.hass.callService('input_number', 'set_value', { value: 5 }, { entity_id: 'input_number.box1' })
    t.snapshot(await dashboard.cards[0].html())
})
