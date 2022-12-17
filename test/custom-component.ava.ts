import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import anyTest, { TestFn } from 'ava'
import { execFileSync } from 'child_process'

const test = anyTest as TestFn<{ hass: HomeAssistant<PlaywrightElement> }>

const stdout = execFileSync('python3', [__dirname + '/resources/download-scheduler.py'])
const [componentDir, cardFile] = stdout.toString().trim().split(' ')

const CONFIGURATION_YAML = ``

test.before(async (t) => {
    t.context.hass = await HomeAssistant.create(CONFIGURATION_YAML, {
        customComponents: [componentDir],
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
    await t.context.hass.addIntegration('scheduler')
    await t.context.hass.addResource(cardFile, 'module')
})

test.after.always(async (t) => await t.context.hass.close())

test('Custom Card', async (t) => {
    const dashboard = await t.context.hass.Dashboard([{ type: 'custom:scheduler-card' }])
    const card = dashboard.cards[0]
    t.snapshot(await card.html())
})
