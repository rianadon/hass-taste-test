import { spawn, ChildProcess, execFile } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, writeFile, rm } from 'fs'
import { promisify } from 'util'
import fetch from 'node-fetch'
import { createConnection as createTCPConnection } from 'net'
import { Auth, Connection, createConnection as createHAConnection } from 'home-assistant-js-websocket'
import { createSocket } from './socket'
import { LovelaceDashboardCreateParams } from './types'
import { BrowserIntegration, Page } from './types'

interface HassTestOptions {
    python: string
    hassArgs: string[]
    host: string
    port: number
    username: string
    password: string
    userLanguage: string
    userDisplayName: string
    integration?: BrowserIntegration
}

const DEFAULT_CONFIG = (options: HassTestOptions) => `
frontend:
http:
  server_host: ${options.host}
  server_port: ${options.port}
`

const exec = (command: string, args: string[]) => new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' })
    proc.on('error', err => reject(err))
    proc.on('close', code => resolve(code))
})

export default class HassTest {

    private venvDir!: string
    private configDir!: string
    private configFile!: string

    private process!: ChildProcess
    private accessCode!: string
    private accessToken!: string
    private options: HassTestOptions
    private dashboards = 0

    public ws!: Connection

    constructor(private config: string, options?: Partial<HassTestOptions>) {
        this.venvDir = join(tmpdir(), 'hasstest-venv')
        this.options = {
            python: 'python3',
            hassArgs: [],
            host: '127.0.0.1',
            port: 8091,
            username: 'dev',
            password: 'dev',
            userLanguage: 'en',
            userDisplayName: 'Developer',
            ...options
        }
    }

    /** Start the HomeAssistant server and connect to its websocket */
    public async start() {
        this.configDir = await promisify(mkdtemp)(join(tmpdir(), 'hasstest-'))
        this.configFile = join(this.configDir, 'configuration.yaml')
        await promisify(writeFile)(this.configFile, DEFAULT_CONFIG(this.options) + this.config)

        await this.setupVenv()
        this.process = spawn(join(this.venvDir, 'bin/hass'), ['-c', this.configDir, ...this.options.hassArgs], {
            stdio: 'inherit'
        })

        while (!(await this.isUp())) { /* wait */ }
        await this.onboard()
    }

    /** Creates a python virtual environment and installs Home Assistant */
    private async setupVenv() {
        await exec(this.options.python, ['-m', 'venv', this.venvDir])

        // Check if homeassistant needs an upgrade; saves a bit of time if it doesn't need one
        const latest = await fetch('https://pypi.org/pypi/homeassistant/json').then(r => r.json())
        const { stdout } = await promisify(execFile)(join(this.venvDir, 'bin/pip'), ['freeze'])
        const installed = stdout.split('\n').find(v => v.startsWith('homeassistant=='))

        if (!installed || installed.split('==')[1] !== latest.info.version) {
            await exec(join(this.venvDir, 'bin/pip'), ['install', '--upgrade', 'homeassistant'])
        }
    }

    /** Checks if Home Assistant is listening on its TCP port */
    private isUp = () => new Promise(resolve => {
        createTCPConnection(this.options.port, this.options.host).on('connect', () => {
            resolve(true)
        }).on("error", () => {
            setTimeout(() => resolve(false), 300)
        })
    })

    /** Complete onboarding and fetch short-lived access token */
    async onboard() {
        const login = await this.post('/api/onboarding/users', {
            language: this.options.userLanguage,
            name: this.options.userDisplayName,
            username: this.options.username,
            password: this.options.password
        })
        this.accessCode = login.auth_code
        await this.launchWebsocket(this.accessCode)

        // Step through the onboarding pages
        await this.post('/api/onboarding/core_config', {}, true)
        await this.post('/api/onboarding/analytics', {}, true)
        const response = await this.post('/api/onboarding/integration', {
            redirect_uri: this.url + '/?auth_callback=1'
        }, true)
        this.accessCode = response.auth_code
    }

    get url() { return `http://${this.options.host}:${this.options.port}` }
    get clientId() { return this.url + '/' }
    get dashboard() { return this.customDashboard('') }

    public customDashboard(name: string, code=this.accessCode) {
        if (!code) throw new Error("You haven't logged into Home Assistant yet. Have you called hasstest.start()?")
        const state = Buffer.from(JSON.stringify({ hassUrl: this.url, clientId: this.clientId })).toString('base64')
        return this.url + '/' + name + `?auth_callback=1&code=${encodeURIComponent(this.accessCode)}&state=${encodeURIComponent(state)}`
    }

    async post(url: string, body: any, authorize=false) {
        const response = await fetch(this.url + url, {
            method: 'post',
            headers: {'Content-Type': 'application/json', ...(authorize ? {'Authorization': 'Bearer ' + this.accessToken } : undefined)},
            body: JSON.stringify({ client_id: this.clientId, ...body })
        })
        return await response.json()
    }

    /** Fetch a access code from username and password */
    async fetchLoginCode() {
        const login = await this.post('/auth/login_flow', {
            handler: ["homeassistant", null],
            redirect_uri: this.url + '/?auth_callback=1'
        })
        const response = await this.post('/auth/login_flow/' + login.flow_id, {
            username: this.options.username,
            password: this.options.password
        })
        return response.result
    }

    /** Login and create tokens and websocket */
    async login() {
        this.accessCode = await this.fetchLoginCode()
        await this.launchWebsocket(this.accessCode)
    }

    async launchWebsocket(code: string) {
        const params = new URLSearchParams()
        params.append('client_id', this.clientId)
        params.append('code', code)
        params.append('grant_type', 'authorization_code')
        const response = await fetch(this.url + '/auth/token', {
            method: 'post', body: params
        })
        const tokens = await response.json()
        this.accessToken = tokens.access_token

        const auth = new Auth({
            ...tokens,
            hassUrl: this.url,
            clientId: this.clientId,
        })

        this.ws = await createHAConnection({ auth, createSocket: async () => createSocket(auth, false), })
    }

    async createDashboard(options?: Partial<LovelaceDashboardCreateParams>) {
        if (!this.ws) throw new Error('Hass-test has not yet been initialized. Did you call hass.start()?')
        const id = ++this.dashboards
        const args = {
            type: "lovelace/dashboards/create",
            url_path: `lovelace-${id}`,
            mode: 'storage',
            require_admin: false,
            show_in_sidebar: true,
            title: `Dashboard ${id}`,
            ...options
        }
        await this.ws.sendMessagePromise(args)
        return args.url_path
    }

    async setDashboardView(dashboard_path: string, config: object[]) {
        if (!this.ws) throw new Error('Hass-test has not yet been initialized. Did you call hass.start()?')
        await this.ws.sendMessagePromise({
            type:"lovelace/config/save",
            url_path: dashboard_path,
            config: {
                title: "View",
                views: [ {
                    path:"default_view",
                    title:"View",
                    cards: config
                } ]
            }
        })
    }

    async Dashboard(config: object[]) {
        if (!this.options.integration) throw new Error('Cannot launch a dashboard without a browser integration. Make sure to specify options.integration')
        const dashboard = await this.createDashboard()
        await this.setDashboardView(dashboard, config)
        const code = await this.fetchLoginCode()
        const page = await this.options.integration.open(this.customDashboard(dashboard, code))
        return new HassDashboard(this, config, page)
    }

    /** Clean up connections and stop the HomeAssistant server */
    async close() {
        if (this.options.integration) await this.options.integration.close()
        if (this.ws) this.ws.close()
        if (this.process) {
            this.process.kill('SIGINT')
            await new Promise(resolve => this.process.on('exit', resolve))
        }
        if (this.configDir) await promisify(rm)(this.configDir, { recursive: true })
    }
}

export class HassDashboard {

    public cards: HassCard[] = []

    constructor (private parent: HassTest, config: object[], page: Page) {
        for (let i = 0; i < config.length; i++) {
            this.cards.push(new HassCard(i, page))
        }
    }

}

export class HassCard {

    constructor (private n: number, private page: Page) {}

    async html() {
        const card = await this.page.getNthCard(this.n);
        return this.page.shadowHTML(card);
    }

}
