import HassTest from '../src/hass-test'
import PlaywrightIntegration from '../src/integrations/playwright'
import anyTest, {TestInterface} from 'ava'

const test = anyTest as TestInterface<{ hass: HassTest }>

const CONFIGURATION_YAML = `
input_number:
  slider1:
    name: Slider
    initial: 30
    min: -20
    max: 35
    step: 1
`

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

// test('fn() returns foo', async t => {
//     const dashboard = await t.context.hass.Dashboard([
//         {type:"entities",entities:["binary_sensor.bedroom_occupancy","binary_sensor.theater_room_occupancy","binary_sensor.updater"],title:"Binary sensor"},
//         {type:"thermostat",entity:"climate.upstairs"},
//         {type:"entities",entities:["sensor.bedroom_temperature","sensor.theater_room_temperature","sensor.upstairs_humidity","sensor.upstairs_temperature"],title:"Sensor"}
//     ])

//     t.snapshot(await dashboard.cards[0].html())
// })
