import HassTest from './hass-test'
import playwright from 'playwright'

// @ts-ignore
import { selectCards, shadowHTML } from './integrations/playwright'

let browser: playwright.Browser
const hass = new HassTest(`
input_number:
  slider1:
    name: Slider
    initial: 30
    min: -20
    max: 35
    step: 1
`)

;(async () => {
    await hass.start()

    browser = await playwright.firefox.launch({ headless: false }) //, slowMo: 100 })
    const context = await browser.newContext()
    const page = await context.newPage()
    console.log('new page')

    page.on('console', msg => console.log(msg.text()))

    const dashboard = await hass.createDashboard()
    await hass.setDashboardView(dashboard, [
        {type:"entities",entities:["binary_sensor.bedroom_occupancy","binary_sensor.theater_room_occupancy","binary_sensor.updater"],title:"Binary sensor"},
        {type:"thermostat",entity:"climate.upstairs"},
        {type:"entities",entities:["sensor.bedroom_temperature","sensor.theater_room_temperature","sensor.upstairs_humidity","sensor.upstairs_temperature"],title:"Sensor"}
    ])
    console.log('created dashboard')

    await page.goto(hass.customDashboard(dashboard))

    try {
        const cards = await selectCards(page)
        console.log(cards)
        const html = await shadowHTML(page, cards[0])
        console.log(html)
    } catch (e) {
        console.log(e)
        await new Promise(r => setTimeout(r, 500000))
    }

    await browser!.close()
})().finally(() => {
    return hass.close()
})
