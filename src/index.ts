import { spawn, type ChildProcess } from 'child_process'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import * as fs from 'fs/promises'
import * as net from 'net'
import * as hass from 'home-assistant-js-websocket'
import { createSocket } from './socket.ts'
import type {
    BrowserIntegration,
    BrowserPage,
    DashboardOptions,
    DiffOptions,
    LovelaceDashboardCreateParams,
    LovelaceResourceType,
} from './types.ts'
import lockfile from 'proper-lockfile'
import { subscribeEntityStates, type HassEntityStates } from 'home-assistant-js-websocket'
export {
    PlaywrightBrowser,
    PlaywrightPage,
    type PlaywrightElement,
} from './integrations/playwright.ts'

interface HassOptions<E> {
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

type Installer = 'uv' | 'pip'

interface CacheConf {
    latestHass: string
    requiresPython: string
    startPort: number
}

/** Sleeps for 100 ms */
const sleep = () => new Promise((r) => setTimeout(r, 100))

/** Runs a command, rejecting if it cannot be started or exits with a non-zero code */
const exec = (command: string, args: string[], quiet = false) =>
    new Promise<void>((resolve, reject) => {
        const proc = spawn(command, args, { stdio: quiet ? 'ignore' : 'inherit' })
        proc.on('error', (err) => reject(err))
        proc.on('close', (code) => {
            if (code === 0) resolve()
            else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
        })
    })

const exists = (path: string) =>
    fs.access(path).then(
        () => true,
        () => false,
    )

/** Whether uv (https://docs.astral.sh/uv/) is available on the PATH */
let uvAvailable: Promise<boolean> | undefined
const hasUv = () =>
    (uvAvailable ??= exec('uv', ['--version'], true).then(
        () => true,
        () => false,
    ))

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
    private entities: HassEntityStates = {}

    public ws!: hass.Connection

    private constructor(options?: Partial<HassOptions<E>>) {
        this.venvDir = join(tmpdir(), 'hasstest-venv')
        this.options = {
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
    private path_storageDir = () => join(this.configDir, '.storage')
    private path_hass = () => join(this.venvDir, 'bin/hass')
    private path_python = () => join(this.venvDir, 'bin/python')
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
        try {
            this.cache = await this.readCache()
            await Promise.all([this.findPort(), this.setupVenv()])
            await fs.writeFile(this.path_cache(), JSON.stringify(this.cache))
        } finally {
            await releaseLock()
        }
        await this.writeConfiguration(config)

        // Step 3: Start Home Assistant and onboard
        this.process = spawn(this.path_hass(), ['-c', this.configDir, ...this.options.hassArgs], {
            stdio: 'pipe',
        })
        this.process.stderr!.pipe(process.stderr)
        await new Promise<void>((resolve, reject) => {
            let exited = false
            this.process.on('error', (e) => {
                exited = true
                console.error(
                    `----\nHome Assistant is having trouble starting. This is likely due to a problem with your virtual environment; try removing the venv folder at ${this.venvDir} and re-running hass-taste-test\n---`,
                )
                reject(e)
            })
            // Wait for Home Assistant to start, but quit early if the process exits
            this.process.on('close', (code) => {
                exited = true
                reject(new Error(`Home Assistant exited with code ${code}`))
            })
            ;(async () => {
                while (!exited && !(await this.isUp())) await sleep()
                resolve()
            })()
        })
        await this.onboard()
        await this.waitUntilRunning()
    }

    /** Write configuration.yaml, plus HTTP settings in whichever form this Home Assistant expects */
    private async writeConfiguration(additionalConfig: string) {
        // Only the frontend: its dependencies cover everything Hass Taste Test uses (auth, onboarding,
        // config entries, lovelace, repairs, websocket API). default_config would also start ~20 more
        // integrations (bluetooth, zeroconf, cloud, ...) that slow startup and fill the logs.
        const config = ['frontend:']
        // Keep test output readable: only log errors, unless the caller configures logging themselves
        if (!/^logger:/m.test(additionalConfig)) config.push('logger:', '  default: error')
        if (await this.usesHttpStorage()) {
            await this.writeHttpStorage()
        } else {
            config.push(
                'http:',
                `  server_host: ${this.options.host}`,
                `  server_port: ${this.chosenPort}`,
            )
        }
        config.push(additionalConfig)
        await fs.writeFile(this.path_confFile(), config.join('\n'))
        await this.writeOnboardingStorage()
    }

    /**
     * Newer Home Assistant versions keep HTTP settings in `.storage/http` and only import the
     * `http:` YAML block once. That import is applied as an unconfirmed trial configuration,
     * which pops up a confirmation dialog in the frontend and reverts (restarting Home
     * Assistant) after 5 minutes. Detect these versions so we can skip the YAML entirely.
     */
    private async usesHttpStorage() {
        const configModule = join(
            await this.sitePackages(),
            'homeassistant/components/http/config.py',
        )
        const source = await fs.readFile(configModule, 'utf-8').catch(() => '')
        return source.includes('yaml_migration_done')
    }

    /**
     * Seed the HTTP config store so Home Assistant boots straight into our host and port.
     * This uses the original (version 1) storage format, which Home Assistant migrates on load
     * into a confirmed ("stable") config with all defaults filled in.
     */
    private async writeHttpStorage() {
        await fs.mkdir(this.path_storageDir(), { recursive: true })
        await fs.writeFile(
            join(this.path_storageDir(), 'http'),
            JSON.stringify({
                version: 1,
                minor_version: 1,
                key: 'http',
                data: { server_host: [this.options.host], server_port: this.chosenPort },
            }),
        )
    }

    /**
     * Seed the onboarding store so the core config and analytics steps start out done. Finishing
     * the core config step kicks off config flows for shopping_list, met, google_translate, and
     * radio_browser, which are never needed for tests and log errors when Home Assistant is closed
     * before they finish setting up. Storage version 2 predates both steps, so every Home Assistant
     * release since then migrates this file by marking them done, leaving only the user and
     * integration steps (which hand us auth codes) for onboard() to complete.
     */
    private async writeOnboardingStorage() {
        await fs.mkdir(this.path_storageDir(), { recursive: true })
        await fs.writeFile(
            join(this.path_storageDir(), 'onboarding'),
            JSON.stringify({ version: 2, minor_version: 1, key: 'onboarding', data: { done: [] } }),
        )
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
        for (;;) {
            this.chosenPort = this.cache.startPort++
            const server = net.createServer()
            const success = await new Promise<boolean>((resolve, reject) => {
                server.on('error', (e: NodeJS.ErrnoException) => {
                    if (e.code === 'EADDRINUSE' || e.code === 'EACCES') resolve(false)
                    else reject(e)
                })
                server.on('listening', () => server.close(() => resolve(true)))
                server.listen(this.chosenPort, this.options.host)
            })
            if (success) return
        }
    }

    /** Creates a python virtual environment and installs Home Assistant (using uv if available) */
    private async chooseInstaller(): Promise<Installer> {
        const requested = process.env.HASS_TASTE_TEST_INSTALLER
        if (requested === 'pip') return 'pip'
        if (requested === 'uv') {
            if (!(await hasUv()))
                throw new Error('The uv installer was requested, but uv is not on the PATH')
            return 'uv'
        }
        if (requested) throw new Error(`Unknown installer "${requested}"; expected "uv" or "pip"`)
        if (await hasUv()) return 'uv'
        console.warn(
            'uv was not found on your PATH; falling back to pip. Install uv (https://docs.astral.sh/uv/) for much faster installs.',
        )
        return 'pip'
    }

    private async setupVenv() {
        const uv = (await this.chooseInstaller()) === 'uv'
        const python = this.cache.requiresPython
        const clearFlag = (clear: boolean) => (clear ? ['--clear'] : [])
        const createVenv = (clear: boolean) =>
            uv
                ? exec('uv', ['venv', ...clearFlag(clear), '--python', python, this.venvDir])
                : exec('python3', ['-m', 'venv', ...clearFlag(clear), this.venvDir])
        const install = () => {
            // Pin the version so an outdated interpreter fails loudly instead of resolving an old release
            const pkg = `homeassistant==${this.cache.latestHass}`
            return uv
                ? exec('uv', ['pip', 'install', '--python', this.path_python(), pkg])
                : exec(this.path_python(), ['-m', 'pip', 'install', pkg])
        }

        // Create virtual environment if it does not already exist
        if (!(await exists(this.path_python()))) await createVenv(false)

        // Check if homeassistant needs an upgrade; saves a bit of time if it doesn't need one
        if ((await this.hassVersion()) === this.cache.latestHass) return
        try {
            await install()
        } catch (e) {
            // Most likely the venv's Python is too old for the latest Home Assistant, or the venv
            // was created by uv (which does not include pip) and pip is now being used. Rebuild it.
            console.warn(`Installing Home Assistant failed (${e}). Recreating ${this.venvDir}`)
            await createVenv(true)
            await install()
        }
    }

    private async readCache(): Promise<CacheConf> {
        try {
            const versionFile = await fs.stat(this.path_cache())
            if (Date.now() - versionFile.mtimeMs < 2000) {
                const cache = JSON.parse(await fs.readFile(this.path_cache(), 'utf-8'))
                if (cache.requiresPython) return cache
            }
        } catch (e) {}
        return {
            ...(await this.latestHAVersion()),
            startPort: 8130,
        }
    }

    /** Fetch the latest hass version, and the Python versions it supports, from pypi */
    private async latestHAVersion() {
        const response = await fetch('https://pypi.org/pypi/homeassistant/json')
        if (!response.ok) throw new Error(`Could not query PyPI: HTTP ${response.status}`)
        const latest = (await response.json()) as any
        return {
            latestHass: latest.info.version as string,
            requiresPython: (latest.info.requires_python as string) || '3',
        }
    }

    /** Path to the venv's site-packages directory */
    private async sitePackages() {
        const libFolders = await fs.readdir(join(this.venvDir, 'lib')).catch(() => [])
        const python = libFolders.find((f) => f.startsWith('python'))
        if (!python) throw new Error(`Could not find a Python installation in ${this.venvDir}`)
        return join(this.venvDir, 'lib', python, 'site-packages')
    }

    /** Finds the version of Home Assistant installed, if any */
    private async hassVersion(): Promise<string | null> {
        // An interrupted install can leave package metadata behind without the entry point
        if (!(await exists(this.path_hass()))) return null
        const files = await this.sitePackages()
            .then((dir) => fs.readdir(dir))
            .catch(() => [] as string[])
        const homeAssistant = files
            .map((f) => f.match(/^homeassistant-(.*)\.dist-info/))
            .find((f) => f !== null)
        return homeAssistant ? homeAssistant[1] : null
    }

    /** Checks if Home Assistant is serving the onboarding API, which onboard() starts with */
    private isUp = () =>
        fetch(this.url + '/api/onboarding')
            .then((response) => response.ok)
            .catch(() => false)

    /**
     * Wait for Home Assistant to finish starting. Until then it has not installed its signal
     * handlers, so close() would interrupt startup and log a KeyboardInterrupt traceback.
     */
    private async waitUntilRunning() {
        while ((await hass.getConfig(this.ws)).state !== 'RUNNING') await sleep()
    }

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
                if (login?.auth_code) break
                else await sleep()
            } catch (e) {
                console.warn(e)
                await sleep()
            }
        }
        if (!login?.auth_code) throw new Error('Onboarding failed: no auth code found')
        this.accessCode = login.auth_code
        await this.launchWebsocket(this.accessCode)

        // Core config and analytics were already marked done (see writeOnboardingStorage)
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
        subscribeEntityStates(this.ws, (e) => (this.entities = { ...this.entities, ...e }))
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
                'Cannot launch a dashboard without a browser integration. Make sure to specify options.browser',
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
        const running =
            this.process?.pid !== undefined &&
            this.process.exitCode === null &&
            this.process.signalCode === null
        if (running) {
            const exited = new Promise((resolve) => this.process.once('exit', resolve))
            this.process.kill('SIGINT')
            await exited
        }
        if (this.configDir) await fs.rm(this.configDir, { recursive: true, force: true })
    }

    public HassDashboard = class {
        public cards: HassCard<E>[] = []
        public parent: HomeAssistant<E>
        public path: string
        public page: BrowserPage<E>

        constructor(
            parent: HomeAssistant<E>,
            path: string,
            config: object[],
            page: BrowserPage<E>,
        ) {
            this.parent = parent
            this.path = path
            this.page = page
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
    private n: number
    private page: BrowserPage<E>

    constructor(n: number, page: BrowserPage<E>, selectors?: string[]) {
        this.n = n
        this.page = page
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
