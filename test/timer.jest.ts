import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import { toMatchImageSnapshot } from 'jest-image-snapshot'

const CONFIGURATION_YAML = `
timer:
  basic:
    duration: "00:01:00"
  laundry:
    duration: "00:01:00"
`

let hass: HomeAssistant<PlaywrightElement>

expect.extend({ toMatchImageSnapshot })

beforeAll(async () => {
    hass = await HomeAssistant.create(CONFIGURATION_YAML, {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
}, 30000)

afterAll(async () => await hass.close())

it('Timer element', async () => {
    const dashboard = await hass.Dashboard([{ type: 'entities', entities: ['timer.basic'] }])

    const row = dashboard.cards[0].narrow('hui-timer-entity-row')
    expect(await row.html()).toMatchSnapshot()
    expect(await row.screenshot()).toMatchImageSnapshot()
})

it('Timer states', async () => {
    const dashboard = await hass.Dashboard([{ type: 'entities', entities: ['timer.laundry'] }])
    // This is merely a reference to the element, so it can be reused
    const entityRow = dashboard.cards[0].narrow('.text-content')
    expect(await entityRow.text()).toMatchInlineSnapshot(`"Idle"`)

    await hass.callService('timer', 'start', {}, { entity_id: 'timer.laundry' })
    expect(await entityRow.text()).toMatchInlineSnapshot(`"59"`)

    await hass.callService('timer', 'pause', {}, { entity_id: 'timer.laundry' })
    expect(await entityRow.text()).toMatch('(Paused)')

    await hass.callService('timer', 'cancel', {}, { entity_id: 'timer.laundry' })
    expect(await entityRow.text()).toMatchInlineSnapshot(`"Idle"`)
})
