import HassTest from '../src/hass-test'
import PlaywrightIntegration, { Element } from '../src/integrations/playwright'
import anyTest, {TestInterface} from 'ava'
import { execFileSync } from 'child_process'

const test = anyTest as TestInterface<{ hass: HassTest<Element> }>

const stdout = execFileSync('python3', [__dirname+'/resources/download-scheduler.py'])
const [componentDir, cardFile] = stdout.toString().trim().split(' ')

const CONFIGURATION_YAML = ``

test.before(async t => {
    t.context.hass = new HassTest(CONFIGURATION_YAML, {
        customComponents: [componentDir],
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox')
    })
    await t.context.hass.start()
    await t.context.hass.addIntegration('scheduler')
    await t.context.hass.addResource(cardFile, 'module')
})

test.after.always(async t => await t.context.hass.close())

test('Custom Card', async t => {
    const dashboard = await t.context.hass.Dashboard([
        { type: 'custom:scheduler-card' }
    ])
    const card = dashboard.cards[0]
    t.snapshot(await card.html())
})
