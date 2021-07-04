import HassTest, { multiply } from '../src/hass-test'
import PlaywrightIntegration, { Element } from '../src/integrations/playwright'
import { toMatchImageSnapshot } from 'jest-image-snapshot'

const CONFIGURATION_YAML = `
timer:
  basic:
    duration: "00:01:00"
  laundry:
    duration: "00:01:00"
`

let hass: HassTest<Element>;

expect.extend({ toMatchImageSnapshot });

beforeAll(async () => {
    hass = new HassTest(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox')
    })
    await hass.start()
}, 10000)

afterAll(async () => await hass.close())

it('Timer element', async () => {
    const dashboard = await hass.Dashboard([
        { type: 'entities', entities: ['timer.basic'] }
    ])
    expect(await dashboard.cards[0].narrow('hui-timer-entity-row').html()).toMatchSnapshot();
    expect(await dashboard.cards[0].narrow('hui-timer-entity-row').screenshot()).toMatchImageSnapshot();
})

it('Timer states', async () => {
    const dashboard = await hass.Dashboard([
        { type: 'entities', entities: ['timer.laundry'] }
    ])
    // This is merely a reference to the element, so it can be reused
    const entityRow = dashboard.cards[0].narrow('.text-content')

    expect(await entityRow.text()).toMatchInlineSnapshot(`"Idle"`)

    await hass.callService('timer', 'start', {}, { entity_id: 'timer.laundry' })
    expect(await entityRow.text()).toMatchInlineSnapshot(`"59"`)

    await hass.callService('timer', 'pause', {}, { entity_id: 'timer.laundry' })
    expect(await entityRow.text()).toMatchInlineSnapshot(`"1:00 (Paused)"`)

    await hass.callService('timer', 'cancel', {}, { entity_id: 'timer.laundry' })
    expect(await entityRow.text()).toMatchInlineSnapshot(`"Idle"`)
})
