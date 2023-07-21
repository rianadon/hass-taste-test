import { spawn, ChildProcess } from 'child_process'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import fetch from 'node-fetch'
import * as fs from 'fs/promises'
import * as net from 'net'
import * as hass from 'home-assistant-js-websocket'
import { createSocket } from './socket'
import {
    BrowserPage,
    DashboardOptions,
    DiffOptions,
    LovelaceDashboardCreateParams,
    LovelaceResourceType,
} from './types'
import { BrowserIntegration } from './types'
import lockfile from 'proper-lockfile'
import { Collection, subscribeEntities, HassEntities } from 'home-assistant-js-websocket'
export { PlaywrightBrowser, PlaywrightElement } from './integrations/playwright'

interface HassOptions<E> {
    python: string
    hassArgs: string[]
    host: string
    port: number | null
    username: string
    password: string
    userLanguage: string
    userDisplayName: string
    customComponents: string[]
    browser?: BrowserIntegration<E>
}

interface CacheConf {
    latestHass: string
    startPort: number
}

/** Sleeps for 100 ms */
const sleep = () => new Promise((r) => setTimeout(r, 100))

const exec = (command: string, args: string[]) =>
    new Promise((resolve, reject) => {
        const proc = spawn(command, args, { stdio: 'inherit' })
        proc.on('error', (err) => reject(err))
        proc.on('close', (code) => resolve(code))
    })

export class HomeAssistant<E> {
    private venvDir!: string
    private configDir!: string

    private cache!: CacheConf
    private chosenPort!: number
    private process!: ChildProcess
    private accessCode!: string
    private accessToken!: string
    private options: HassOptions<E>
    private dashboards = 0
    private entities: HassEntities = {}

    public ws!: hass.Connection

    private constructor(options?: Partial<HassOptions<E>>) {
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
            ...options,
        }
    }

    private path_confFile = () => join(this.configDir, 'configuration.yaml')
    private path_componentsDir = () => join(this.configDir, 'custom_components')
    private path_wwwDir = () => join(this.configDir, 'www')
    private path_hass = () => join(this.venvDir, 'bin/hass')
    private path_pip = () => join(this.venvDir, 'bin/pip')
    private path_cache = () => join(tmpdir(), 'hasstest-cache')

    /** Create and connect to an isolated Home Assistant instance */
    public static async create<E>(config: string, options?: Partial<HassOptions<E>>) {
        const hass = new HomeAssistant<E>(options)
        await hass.start(config)
        return hass
    }

    /** Log into an existing Home Assistant instance */
    public static async connect<E>(options?: Partial<HassOptions<E>>) {
        const hass = new HomeAssistant<E>(options)
        await hass.login()
        return hass
    }

    /** Start the Home Assistant server and connect to its websocket */
    private async start(config: string) {
        this.configDir = await fs.mkdtemp(join(tmpdir(), 'hasstest-'))

        // Step 1: Create necessary directories
        await Promise.all([
            fs.mkdir(this.path_wwwDir()),
            fs.mkdir(this.path_componentsDir()).then(() => this.linkComponents()),
        ])

        // Step 2: Create venv and sort out networking under lock
        const releaseLock = await this.acquireLock()
        this.cache = await this.readCache()
        await Promise.all([
            this.findPort().then(() => this.writeYAMLConfiguration(config)),
            this.setupVenv(),
        ])
        await fs.writeFile(this.path_cache(), JSON.stringify(this.cache))
        await releaseLock()

        // Step 3: Start Home Assistant and onboard
        this.process = spawn(
            this.path_hass(),
            ['-c', this.configDir, '-v', ...this.options.hassArgs],
            {
                stdio: 'inherit',
            },
        )
        this.process.on('error', (e) => {
            console.error(
                `----\nHome Assistant is having trouble starting. This is likely due to a problem with your virtual environment; try removing the venv folder at ${this.venvDir} and re-running hass-taste-test\n---`,
            )
            throw e
        })
        await new Promise<void>(async (resolve, reject) => {
            // Wait for Home Assistant to start, but quit early if the process exits
            this.process.on('close', (code) => {
                if (code != 0) reject(new Error(`Home Assistant exited with code ${code}`))
            })
            while (!(await this.isUp())) await sleep()
            resolve()
        })
        await this.onboard()
    }

    /** Write configuration.yaml */
    private async writeYAMLConfiguration(additionalConfig: string) {
        const config = [
            'frontend:',
            'http:',
            `  server_host: ${this.options.host}`,
            `  server_port: ${this.chosenPort}`,
            additionalConfig,
        ].join('\n')
        fs.writeFile(this.path_confFile(), config)
    }

    /** Symlink custom component directories to the configuration directory */
    private async linkComponents() {
        await Promise.all(
            this.options.customComponents.map((component) =>
                fs.symlink(
                    component,
                    join(this.path_componentsDir(), basename(component)),
                    'junction',
                ),
            ),
        )
    }

    /** Wait for lockfile to become released. Forces HassTest instances to start up one at a time */
    private async acquireLock() {
        for (let iterations = 0; iterations < 600; iterations++)
            try {
                return await lockfile.lock(tmpdir(), { lockfilePath: 'hasstest.lock' })
            } catch (e: any) {
                if (e.code !== 'ELOCKED') throw e
                await sleep()
            }
        throw new Error('Timed out waiting for lockfile')
    }

    /** Find an open port to launch Home Assistant */
    private async findPort() {
        this.chosenPort = this.cache.startPort++
        const server = net.createServer()
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
        await fs
            .access(this.venvDir)
            .catch(() => exec(this.options.python, ['-m', 'venv', this.venvDir]))

        // Check if homeassistant needs an upgrade; saves a bit of time if it doesn't need one
        const installed = await this.hassVersion()

        if (!installed || installed !== this.cache.latestHass) {
            await exec(this.path_pip(), ['install', '--upgrade', 'wheel'])
            await exec(this.path_pip(), ['install', '--upgrade', 'mutagen', 'homeassistant'])
        }
    }

    private async readCache(): Promise<CacheConf> {
        try {
            const versionFile = await fs.stat(this.path_cache())
            if (Date.now() - versionFile.mtimeMs < 2000) {
                return await JSON.parse(await fs.readFile(this.path_cache(), 'utf-8'))
            }
        } catch (e) {}
        return {
            latestHass: await this.latestHAVersion(),
            startPort: 8130,
        }
    }

    /** Fetch the latest hass version from pypi */
    private async latestHAVersion(): Promise<string> {
        const latest = await fetch('https://pypi.org/pypi/homeassistant/json').then(
            (r) => r.json() as any,
        )
        return latest.info.version
    }

    /** Finds the version of Home Assistant installed, if any */
    private async hassVersion(): Promise<string | null> {
        const libFolders = await fs.readdir(join(this.venvDir, 'lib'))
        const libs = await Promise.all(
            libFolders.map((f) => fs.readdir(join(this.venvDir, 'lib', f, 'site-packages'))),
        )
        const homeAssistant = libs
            .flat()
            .map((f) => f.match(/^homeassistant-(.*)\.dist-info/))
            .find((f) => f !== null)
        return homeAssistant ? homeAssistant[1] : null
    }

    /** Checks if Home Assistant is listening on its TCP port */
    private isUp = () =>
        new Promise((resolve) => {
            net.createConnection(this.chosenPort, this.options.host)
                .on('connect', () => resolve(true))
                .on('error', () => resolve(false))
        })

    /** Complete onboarding and fetch short-lived access token */
    private async onboard() {
        let login
        for (let tries = 0; tries < 20; tries++) {
            try {
                login = await this.post('/api/onboarding/users', {
                    language: this.options.userLanguage,
                    name: this.options.userDisplayName,
                    username: this.options.username,
                    password: this.options.password,
                })
                if (login.auth_code) break
                else await sleep()
            } catch (e) {
                console.warn(e)
                await sleep()
            }
        }
        if (!login.auth_code) throw new Error('No auth code found')
        this.accessCode = login.auth_code
        await this.launchWebsocket(this.accessCode)

        // Step through the onboarding pages
        await this.post('/api/onboarding/core_config', {}, true)
        await this.post('/api/onboarding/analytics', {}, true)
        const response = await this.post(
            '/api/onboarding/integration',
            { redirect_uri: this.url + '/?auth_callback=1' },
            true,
        )
        this.accessCode = response.auth_code
    }

    private get url() {
        return `http://${this.options.host}:${this.chosenPort}`
    }
    private get clientId() {
        return this.url + '/'
    }
    public get link() {
        return this.customDashboard('')
    }

    public customDashboard(path: string, code = this.accessCode) {
        if (!code)
            throw new Error(
                'You have not logged into Home Assistant yet. Have you called hasstest.start()?',
            )
        const state = Buffer.from(
            JSON.stringify({ hassUrl: this.url, clientId: this.clientId }),
        ).toString('base64')
        return `${this.url}/${path}?auth_callback=1&code=${encodeURIComponent(
            code,
        )}&state=${encodeURIComponent(state)}`
    }

    public async post(url: string, body: any, authorize = false) {
        const response = await fetch(this.url + url, {
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                ...(authorize ? { Authorization: 'Bearer ' + this.accessToken } : undefined),
            },
            body: JSON.stringify({ client_id: this.clientId, ...body }),
        })
        return (await response.json()) as any
    }

    /** Fetch a access code from username and password */
    private async fetchLoginCode() {
        const login = await this.post('/auth/login_flow', {
            handler: ['homeassistant', null],
            redirect_uri: this.url + '/?auth_callback=1',
        })
        const response = await this.post('/auth/login_flow/' + login.flow_id, {
            username: this.options.username,
            password: this.options.password,
        })
        if (response.error) throw new Error(`Login code returned with error ${response.error}`)
        return response.result
    }

    /** Login and create tokens and websocket */
    public async login() {
        this.accessCode = await this.fetchLoginCode()
        await this.launchWebsocket(this.accessCode)
    }

    private async launchWebsocket(code: string) {
        const params = new URLSearchParams()
        params.append('client_id', this.clientId)
        params.append('code', code)
        params.append('grant_type', 'authorization_code')
        const response = await fetch(this.url + '/auth/token', {
            method: 'post',
            body: params,
        })
        const tokens = (await response.json()) as any
        if (tokens.error) throw new Error(`Tokens returned with error ${tokens.error}`)
        this.accessToken = tokens.access_token

        const auth = new hass.Auth({
            ...tokens,
            hassUrl: this.url,
            clientId: this.clientId,
        })

        this.ws = await hass.createConnection({
            auth,
            createSocket: async () => createSocket(auth, false),
        })
        subscribeEntities(this.ws, (e) => (this.entities = { ...this.entities, ...e }))
    }

    public async addIntegration(name: string) {
        const response = await this.post(
            '/api/config/config_entries/flow',
            {
                handler: name,
                show_advanced_options: false,
            },
            true,
        )
        if (response.message)
            throw new Error(
                `Error configuring ${name} integration. Check the logs: ${response.message}`,
            )
        if (!response.result) throw new Error('Multi-step integration flows are not yet suppoted')
        return response.result
    }

    public async addResource(filename: string, resourceType: LovelaceResourceType) {
        if (resourceType === 'module') {
            await fs.copyFile(filename, join(this.path_wwwDir(), basename(filename)))
        } else {
            throw new Error('Only the module type is supported for now')
        }
        await this.ws.sendMessagePromise({
            type: 'lovelace/resources/create',
            res_type: resourceType,
            url: '/local/' + basename(filename),
        })
    }

    public async createDashboard(options?: Partial<LovelaceDashboardCreateParams>) {
        if (!this.ws)
            throw new Error('Hass-test has not yet been initialized. Did you call hass.start()?')
        const id = ++this.dashboards
        const args = {
            type: 'lovelace/dashboards/create',
            url_path: `lovelace-${id}`,
            mode: 'storage',
            require_admin: false,
            show_in_sidebar: true,
            ...options,
            title: options?.title || `Dashboard ${id}`,
        }
        await this.ws.sendMessagePromise(args)
        return args.url_path
    }

    async setDashboardView(dashboard_path: string, config: object[]) {
        if (!this.ws)
            throw new Error('Hass-test has not yet been initialized. Did you call hass.start()?')
        await this.ws.sendMessagePromise({
            type: 'lovelace/config/save',
            url_path: dashboard_path,
            config: {
                title: 'View',
                views: [{ path: 'default_view', title: 'View', cards: config }],
            },
        })
    }

    async callService(
        domain: string,
        service: string,
        serviceData?: object,
        target?: hass.HassServiceTarget,
    ) {
        return await hass.callService(this.ws, domain, service, serviceData, target)
    }

    async Dashboard(config: object[], options?: DashboardOptions) {
        if (!this.options.browser)
            throw new Error(
                'Cannot launch a dashboard without a browser integration. Make sure to specify options.integration',
            )
        const dashboard = await this.createDashboard({ title: options?.title })
        await this.setDashboardView(dashboard, config)
        const code = await this.fetchLoginCode()
        const page = await this.options.browser.open(
            this.customDashboard(dashboard, code),
            options || {},
        )
        return new this.HassDashboard(this, dashboard, config, page)
    }

    async states() {
        return this.entities
    }

    /** Clean up connections and stop the HomeAssistant server */
    async close() {
        if (this.options.browser) await this.options.browser.close()
        if (this.ws) this.ws.close()
        if (this.process) {
            this.process.kill('SIGINT')
            await new Promise((resolve) => this.process.on('exit', resolve))
        }
        if (this.configDir) await fs.rm(this.configDir, { recursive: true })
    }

    public HassDashboard = class {
        public cards: HassCard<E>[] = []

        constructor(
            public parent: HomeAssistant<E>,
            public path: string,
            config: object[],
            public page: BrowserPage<E>,
        ) {
            for (let i = 0; i < config.length; i++) {
                this.cards.push(new HassCard(i, page))
            }
        }

        async link() {
            const code = await this.parent.fetchLoginCode()
            return this.parent.customDashboard(this.path, code)
        }

        async openInBrowser() {
            await this.parent.options.browser!.openInHeaded(await this.link())
        }
    }
}

export class HassCard<E> {
    private selectors: string[]

    constructor(
        private n: number,
        private page: BrowserPage<E>,
        selectors?: string[],
    ) {
        this.selectors = selectors || []
    }

    public async element() {
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

    public async html(options?: Partial<DiffOptions>) {
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
    let config = ''
    for (let i = 1; i <= n; i++) {
        config += configFn(i) + '\n'
    }
    return config
}
