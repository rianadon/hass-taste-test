import { spawn, ChildProcess, execFile } from 'child_process'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, writeFile, rm, mkdir, copyFile, stat, symlink } from 'fs/promises'
import fetch from 'node-fetch'
import { createConnection as createTCPConnection, createServer as createTCPServer } from 'net'
import { Auth, callService, Connection, createConnection as createHAConnection, HassServiceTarget } from 'home-assistant-js-websocket'
import { createSocket } from './socket'
import { BrowserPage, DiffOptions, LovelaceDashboardCreateParams, LovelaceResourceType } from './types'
import { BrowserIntegration } from './types'
import lockfile from 'proper-lockfile'
import { promisify } from 'util'

interface HassTestOptions<E> {
    python: string
    hassArgs: string[]
    host: string
    port: number | null
    username: string
    password: string
    userLanguage: string
    userDisplayName: string
    customComponents: string[]
    integration?: BrowserIntegration<E>
}

const DEFAULT_CONFIG = (options: HassTestOptions<any>, port: number) => `
frontend:
http:
  server_host: ${options.host}
  server_port: ${port}
`

// Global port to start search from
// When multiple HassTest instances are created, they will all increment this port
// Hopefully this stops them from colliding with one another
let startPort = 8130

const exec = (command: string, args: string[]) => new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' })
    proc.on('error', err => reject(err))
    proc.on('close', code => resolve(code))
})

export default class HassTest<E> {

    private venvDir!: string
    private configDir!: string

    private chosenPort!: number
    private process!: ChildProcess
    private accessCode!: string
    private accessToken!: string
    private options: HassTestOptions<E>
    private dashboards = 0

    public ws!: Connection

    constructor(private config: string, options?: Partial<HassTestOptions<E>>) {
        this.venvDir = join(tmpdir(), 'hasstest-venv')
        this.options = {
            python: 'python3',
            hassArgs: [],
            host: '127.0.0.1',
            port: null,
            username: 'dev',
            password: 'dev',
            userLanguage: 'en',
            userDisplayName: 'Developer',
            customComponents: [],
            ...options
        }
    }

    private get path_confFile() { return join(this.configDir, 'configuration.yaml') }
    private get path_componentsDir() { return join(this.configDir, 'custom_components') }
    private get path_wwwDir() { return join(this.configDir, 'www') }
    private get path_hass() { return join(this.venvDir, 'bin/hass') }
    private get path_pip() { return join(this.venvDir, 'bin/pip') }

    /** Start the HomeAssistant server and connect to its websocket */
    public async start() {
        this.configDir = await mkdtemp(join(tmpdir(), 'hasstest-'))

        await mkdir(this.path_wwwDir)
        await mkdir(this.path_componentsDir)
        await this.linkComponents()

        const releaseLock = await this.acquireLock()
        await Promise.all([this.findPort(), this.setupVenv()])

        await writeFile(this.path_confFile , DEFAULT_CONFIG(this.options, this.chosenPort) + this.config)
        this.process = spawn(this.path_hass, ['-c', this.configDir, ...this.options.hassArgs], {
            stdio: 'inherit'
        })
        while (!(await this.isUp())) { /* wait */ }
        await releaseLock() // Release lock once the process is up, so other instances can select a different port

        await this.onboard()
    }

    /** Symlink custom component directories to the configuration directory */
    private async linkComponents() {
        await Promise.all(this.options.customComponents.map(component =>
            symlink(component, join(this.path_componentsDir, basename(component)), 'junction')
        ))
    }

    /** Wait for lockfile to become released. Forces HassTest instances to start up one at a time */
    private async acquireLock() {
        for (let iterations = 0; iterations < 50; iterations++)
            try {
                return await lockfile.lock(tmpdir(), { lockfilePath: 'hasstest.lock' })
            } catch (e) {
                if (e.code !== 'ELOCKED') throw e
                await new Promise(resolve => setTimeout(resolve, 100))
            }

        throw new Error('Timed out waiting for lockfile')
    }

     /** Find an open port to launch Home Assistant */
    private async findPort() {
        this.chosenPort = startPort++
        const server = createTCPServer()
        server.listen(this.chosenPort, this.options.host)
        const success = await new Promise((resolve, reject) => {
            server.on('error', (e: NodeJS.ErrnoException) => {
                if (e.code === 'EADDRINUSE' || e.code === 'EACCESS') resolve(false)
                else reject(e)
            })
            server.on('listening', () => {
                server.close()
                resolve(true)
            })
        })
        if (!success) await this.findPort()
    }

    /** Creates a python virtual environment and installs Home Assistant */
    private async setupVenv() {
        // Create virtual environment if it does not already exist
        if (!(await stat(this.venvDir)).isDirectory())
            await exec(this.options.python, ['-m', 'venv', this.venvDir])

        // Check if homeassistant needs an upgrade; saves a bit of time if it doesn't need one
        const latest = await fetch('https://pypi.org/pypi/homeassistant/json').then(r => r.json())
        const { stdout } = await promisify(execFile)(this.path_pip, ['freeze'])
        const installed = stdout.split('\n').find(v => v.startsWith('homeassistant=='))

        if (!installed || installed.split('==')[1] !== latest.info.version) {
            await exec(this.path_pip, ['install', '--upgrade', 'homeassistant'])
        }
    }

    /** Checks if Home Assistant is listening on its TCP port */
    private isUp = () => new Promise(resolve => {
        createTCPConnection(this.chosenPort, this.options.host).on('connect', () => {
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

    get url() { return `http://${this.options.host}:${this.chosenPort}` }
    get clientId() { return this.url + '/' }
    get link() { return this.customDashboard('') }

    public customDashboard(name: string, code=this.accessCode) {
        if (!code) throw new Error("You haven't logged into Home Assistant yet. Have you called hasstest.start()?")
        const state = Buffer.from(JSON.stringify({ hassUrl: this.url, clientId: this.clientId })).toString('base64')
        return this.url + '/' + name + `?auth_callback=1&code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
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

    private async launchWebsocket(code: string) {
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

    public async addIntegration(name: string) {
        const response = await this.post('/api/config/config_entries/flow', {
            handler: name,
            show_advanced_options: false
        }, true)
        if (!response.result) throw new Error('Multi-step integration flows are not yet suppoted')
        return response.result
    }

    public async addResource(filename: string, resourceType: LovelaceResourceType) {
        if (resourceType === 'module') {
            await copyFile(filename, join(this.path_wwwDir, basename(filename)))
        } else {
            throw new Error('Only the module type is supported for now')
        }
        await this.ws.sendMessagePromise({
            type: "lovelace/resources/create",
            res_type: resourceType,
            url: '/local/' + basename(filename)
        })
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

    async callService(domain: string, service: string, serviceData?: object, target?: HassServiceTarget) {
        return await callService(this.ws, domain, service, serviceData, target)
    }

    async Dashboard(config: object[]) {
        if (!this.options.integration) throw new Error('Cannot launch a dashboard without a browser integration. Make sure to specify options.integration')
        const dashboard = await this.createDashboard()
        await this.setDashboardView(dashboard, config)
        const code = await this.fetchLoginCode()
        const page = await this.options.integration.open(this.customDashboard(dashboard, code))
        return new this.HassDashboard(this, dashboard, config, page)
    }

    /** Clean up connections and stop the HomeAssistant server */
    async close() {
        if (this.options.integration) await this.options.integration.close()
        if (this.ws) this.ws.close()
        if (this.process) {
            this.process.kill('SIGINT')
            await new Promise(resolve => this.process.on('exit', resolve))
        }
        if (this.configDir) await rm(this.configDir, { recursive: true })
    }

    public HassDashboard = class {

        public cards: HassCard<E>[] = []

        constructor (public parent: HassTest<E>, public name: string, config: object[], page: BrowserPage<E>) {
            for (let i = 0; i < config.length; i++) {
                this.cards.push(new HassCard(i, page))
            }
        }

        async link() {
            const code = await this.parent.fetchLoginCode()
            return this.parent.customDashboard(this.name, code)
        }

        async openInBrowser() {
            await this.parent.options.integration!.openInHeaded(await this.link())
        }
    }
}

export class HassCard<E> {
    private selectors: string[]

    constructor (private n: number, private page: BrowserPage<E>, selectors?: string[]) {
        this.selectors = selectors || []
    }

    private async element() {
        let el = await this.page.getNthCard(this.n)
        for (const sel of this.selectors) {
            const element = await this.page.find(el, sel)
            if (!element) throw new Error('Could not find selector ' + sel)
            el = element
        }
        return el
    }

    public narrow(selector: string) {
        return new HassCard<E>(this.n, this.page, [...this.selectors, selector])
    }

    public async html(options?: DiffOptions) {
        return await this.page.shadowHTML(await this.element(), options)
    }

    public async text() {
        return (await this.page.textContent(await this.element())).trim()
    }

    public async screenshot() {
        return await this.page.screenshot(await this.element())
    }

}

export function multiply(n: number, configFn: (i: number) => string) {
    let config = '';
    for (let i = 1; i <= n; i++) {
        config += configFn(i) + '\n';
    }
    return config
}
