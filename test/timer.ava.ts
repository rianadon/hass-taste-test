import HassTest, { multiply } from '../src/hass-test'
import PlaywrightIntegration, { Element } from '../src/integrations/playwright'
import anyTest, { TestInterface } from 'ava'

const test = anyTest as TestInterface<{ hass: HassTest<Element> }>

const CONFIGURATION_YAML = `
timer:
  basic:
    duration: "00:01:00"
  laundry:
    duration: "00:01:00"
`

test.before(async (t) => {
    t.context.hass = new HassTest(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox'),
    })
    await t.context.hass.start()
})

test.after.always(async (t) => await t.context.hass.close())

test('Timer element', async (t) => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'entities', entities: ['timer.basic'] },
    ])
    t.snapshot(await dashboard.cards[0].narrow('hui-timer-entity-row').html())
})

test('Timer states', async (t) => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'entities', entities: ['timer.laundry'] },
    ])
    // This is merely a reference to the element, so it can be reused
    const entityRow = dashboard.cards[0].narrow('.text-content')

    t.snapshot(await entityRow.text(), 'Idle state')

    await t.context.hass.callService('timer', 'start', {}, { entity_id: 'timer.laundry' })
    t.snapshot(await entityRow.text(), 'Active state')

    await t.context.hass.callService('timer', 'pause', {}, { entity_id: 'timer.laundry' })
    t.snapshot(await entityRow.text(), 'Paused state')

    await t.context.hass.callService(
        'timer',
        'cancel',
        {},
        { entity_id: 'timer.laundry' }
    )
    t.snapshot(await entityRow.text(), 'Idle state')
})
