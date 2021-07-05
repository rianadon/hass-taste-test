import { HomeAssistant, PlaywrightBrowser, PlaywrightElement } from '../src'
import { toMatchImageSnapshot } from 'jest-image-snapshot'
import { execFileSync } from 'child_process'

expect.extend({ toMatchImageSnapshot })

const stdout = execFileSync('python3', [__dirname + '/resources/download-scheduler.py'])
const [componentDir, cardFile] = stdout.toString().trim().split(' ')

const CONFIGURATION_YAML = ``

let hass: HomeAssistant<PlaywrightElement>

beforeAll(async () => {
    hass = new HomeAssistant(CONFIGURATION_YAML, {
        customComponents: [componentDir],
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
    await hass.start()
    await hass.addIntegration('scheduler')
    await hass.addResource(cardFile, 'module')
}, 30000)
afterAll(async () => await hass.close())

it('Custom Component Card', async () => {
    const dashboard = await hass.Dashboard([{ type: 'custom:scheduler-card' }])
    const card = dashboard.cards[0]
    expect(await card.html()).toMatchSnapshot()
    expect(await card.screenshot()).toMatchImageSnapshot()
})
