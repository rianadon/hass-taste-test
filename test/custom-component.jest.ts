import HassTest from '../src/hass-test'
import PlaywrightIntegration, { Element } from '../src/integrations/playwright'
import { toMatchImageSnapshot } from 'jest-image-snapshot'
import { execFileSync } from 'child_process'

expect.extend({ toMatchImageSnapshot });

const stdout = execFileSync('python3', [__dirname+'/resources/download-scheduler.py'])
const [componentDir, cardFile] = stdout.toString().trim().split(' ')

const CONFIGURATION_YAML = ``

let hass: HassTest<Element>;

beforeAll(async () => {
    hass = new HassTest(CONFIGURATION_YAML, {
        customComponents: [componentDir],
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox')
    })
    await hass.start()
    await hass.addIntegration('scheduler')
    await hass.addResource(cardFile, 'module')
}, 10000)
afterAll(async () => await hass.close())

it('Custom Component Card', async () => {
    const dashboard = await hass.Dashboard([
        { type: 'custom:scheduler-card' }
    ])
    const card = dashboard.cards[0]
    expect(await card.html()).toMatchSnapshot();
    expect(await card.screenshot()).toMatchImageSnapshot();
}, 10000000)
