import HassTest, { multiply } from '../src/hass-test'
import PlaywrightIntegration from '../src/integrations/playwright'
import anyTest, {TestInterface} from 'ava'

const test = anyTest as TestInterface<{ hass: HassTest }>

const CONFIGURATION_YAML = `
input_number:
${multiply(2, i => `
  slider${i}:
    name: Slider
    initial: 30
    min: -20
    max: 35
    step: 1
`)}`

test.before(async t => {
    t.context.hass = new HassTest(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration('firefox')
    })
    await t.context.hass.start()
})

test.after.always(async t => await t.context.hass.close())

test('entity card with slider', async t => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'entities', entities: ['input_number.slider1'] }
    ])
    t.snapshot(await dashboard.cards[0].html())
})

test('entity with value 5', async t => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'entities', entities: ['input_number.slider2'] }
    ])
    await t.context.hass.callService('input_number', 'set_value', { value: 5 }, { entity_id: 'input_number.slider2' })
    t.snapshot(await dashboard.cards[0].html())
})
