import { HomeAssistant } from '../src/index.ts'
import anyTest, { type TestFn } from 'ava'

const test = anyTest as TestFn<{ hass: HomeAssistant<unknown> }>

test.before(async (t) => {
    t.context.hass = await HomeAssistant.create('')
})

test.after.always(async (t) => await t.context.hass.close())

// Home Assistant treats a newly imported `http:` YAML block as an unconfirmed trial config, which
// shows a confirmation popup in the frontend and reverts (restarting Home Assistant) after 5
// minutes. Hass Taste Test should boot straight into a confirmed config instead.
test('HTTP config is not an unconfirmed trial', async (t) => {
    const ws = t.context.hass.ws
    const config: any = await ws.sendMessagePromise({ type: 'http/config' }).catch(() => null)
    if (config) {
        t.is(config.active_config_type, 'stable')
        t.is(config.pending, null)
        t.is(config.revert_at, null)
    }
    const { issues }: any = await ws.sendMessagePromise({ type: 'repairs/list_issues' })
    t.deepEqual(
        issues.filter((i: any) => i.domain === 'http').map((i: any) => i.issue_id),
        [],
    )
})
