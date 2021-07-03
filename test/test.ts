import HassTest from '../src/hass-test'
import { Browser, firefox, Page } from 'playwright'

// @ts-ignore
import { selectCards, shadowHTML } from '../src/integrations/playwright'

import anyTest, {TestInterface} from 'ava'

const test = anyTest as TestInterface<{ hass: HassTest, browser: Browser, page: Page }>

test.before(async t => {
    t.context.hass = new HassTest(`
input_number:
  slider1:
    name: Slider
    initial: 30
    min: -20
    max: 35
    step: 1
`)
    await t.context.hass.start()
    t.context.browser = await firefox.launch({ headless: false })
    const context = await t.context.browser.newContext()
    t.context.page = await context.newPage()
    t.context.page.on('console', msg => console.log(msg.text()))
})

test.after(async t => {
    await t.context.browser.close()
    await t.context.hass.close()
})

test('fn() returns foo', async t => {
    const { page, hass } = t.context
    const dashboard = await hass.createDashboard()
    await hass.setDashboardView(dashboard, [
        {type:"entities",entities:["binary_sensor.bedroom_occupancy","binary_sensor.theater_room_occupancy","binary_sensor.updater"],title:"Binary sensor"},
        {type:"thermostat",entity:"climate.upstairs"},
        {type:"entities",entities:["sensor.bedroom_temperature","sensor.theater_room_temperature","sensor.upstairs_humidity","sensor.upstairs_temperature"],title:"Sensor"}
    ])
    await page.goto(hass.customDashboard(dashboard))

    const cards = await selectCards(page)
    const html = await shadowHTML(page, cards[0])
    console.log(html)
    t.snapshot(html)
})
