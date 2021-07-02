import { spawn, ChildProcess, execFile } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, writeFile, rm } from 'fs'
import { promisify } from 'util'
import fetch from 'node-fetch'
import { createConnection } from 'net'

interface HassTestOptions {
    python: string
    hassArgs: string[]
    host: string
    port: number
    username: string
    password: string
    userLanguage: string
    userDisplayName: string
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

export default class HassTestLauncher {

    private venvDir!: string
    private configDir!: string
    private configFile!: string

    private process!: ChildProcess
    private accessCode!: string
    private accessToken!: string
    private options: HassTestOptions

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
        createConnection(this.options.port, this.options.host).on('connect', () => {
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
        this.accessToken = (await this.fetchToken(this.accessCode)).access_token

        // Step through the onboarding pages
        await this.post('/api/onboarding/core_config', {}, true)
        await this.post('/api/onboarding/analytics', {}, true)
        const response = await this.post('/api/onboarding/integration', {
            redirect_uri: this.url + '/?auth_callback=1'
        }, true)
        this.accessCode = response.auth_code
    }

    get url() { return `http://${this.options.host}:${this.options.port}` }
    get dashboard() {
        if (!this.accessCode) throw new Error("You haven't logged into Home Assistant yet. Have you called hasstest.start()?")
        const state = Buffer.from(JSON.stringify({ hassUrl: this.url, clientId: this.url + '/' })).toString('base64')
        return this.url + `/?auth_callback=1&code=${encodeURIComponent(this.accessCode)}&state=${encodeURIComponent(state)}`
    }

    async post(url: string, body: any, authorize=false) {
        const response = await fetch(this.url + url, {
            method: 'post',
            headers: {'Content-Type': 'application/json', ...(authorize ? {'Authorization': 'Bearer ' + this.accessToken } : undefined)},
            body: JSON.stringify({ client_id: this.url + '/', ...body })
        })
        return await response.json()
    }

    /** Fetch a short-lived access token from username and password */
    async login() {
        const login = await this.post('/auth/login_flow', {
            handler: ["homeassistant", null],
            redirect_uri: this.url + '/?auth_callback=1'
        })
        const response = await this.post('/auth/login_flow/' + login.flow_id, {
            username: this.options.username,
            password: this.options.password
        })
        this.accessCode = response.result
        console.log(this.accessCode, response)
        this.accessToken = (await this.fetchToken(this.accessCode)).access_token
    }

    async fetchToken(code: string) {
        const params = new URLSearchParams()
        params.append('client_id', this.url + '/')
        params.append('code', code)
        params.append('grant_type', 'authorization_code')
        const response = await fetch(this.url + '/auth/token', {
            method: 'post', body: params
        })
        return await response.json()
    }

    /** Clean up connections and stop the HomeAssistant server */
    async close() {
        this.process.kill('SIGINT')
        await new Promise(resolve => this.process.on('exit', resolve))
        await promisify(rm)(this.configDir, { recursive: true })
    }

}
