import { spawn, execFile, ChildProcess } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, writeFile, rm } from 'fs'
import { promisify } from 'util'
import fetch from 'node-fetch'

interface HassTestOptions {
    hassArgs: string[]
    host: string
    port: number
    username: string
    password: string
}

const DEFAULT_CONFIG = (options: HassTestOptions) => `
frontend:
http:
  server_host: ${options.host}
  server_port: ${options.port}
`

export default class HassTestLauncher {

    private configDir!: string
    private configFile!: string

    private hassBinary: string
    private process!: ChildProcess
    private accessToken!: string
    private options: HassTestOptions

    constructor(private venv: string, private config: string, options?: Partial<HassTestOptions>) {
        this.hassBinary = join(this.venv, 'bin/hass')
        this.options = {
            host: '127.0.0.1',
            port: 8091,
            hassArgs: [],
            username: 'dev',
            password: 'dev',
            ...options
        }
    }

    /** Start the HomeAssistant server and connect to its websocket */
    public async start() {
        this.configDir = await promisify(mkdtemp)(join(tmpdir(), 'hasstest-'))
        this.configFile = join(this.configDir, 'configuration.yaml')
        console.log(this.configFile)
        await promisify(writeFile)(this.configFile, DEFAULT_CONFIG(this.options) + this.config)

        await this.createUser(this.options.username, this.options.password)
        await this.bypassOnboarding()
        this.process = spawn(this.hassBinary, ['-c', this.configDir, ...this.options.hassArgs], {
            stdio: 'inherit'
        })

        while (true) {
            try {
                await this.fetchToken()
                break
            } catch (e) {
                if (e.code !== 'ECONNREFUSED') throw e
                await new Promise(resolve => setTimeout(resolve, 2000))
            }
        }
    }

    /** Create a user account */
    async createUser(user: string, password: string) {
        await promisify(execFile)(this.hassBinary, ['--script', 'auth', '-c', this.configDir, 'add', user, password])
    }

    /** Mark onboarding as completed, so it no longer shows up */
    async bypassOnboarding() {
        await promisify(writeFile)(join(this.configDir, '.storage/onboarding'), JSON.stringify({
            data: { done: [ "user", "core_config", "integration" ] },
            key: "onboarding",
            version: 3
        }))
    }

    get url() { return `http://${this.options.host}:${this.options.port}` }

    async post(url: string, body: any) {
        const response = await fetch(this.url + url, {
            method: 'post',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ client_id: this.url + '/', ...body })
        })
        return await response.json()
    }

    /** Fetch a short-lived access token from username and password */
    async fetchToken() {
        const login = await this.post('/auth/login_flow', {
            handler: ["homeassistant", null],
            redirect_uri: this.url + '/?auth_callback=1'
        })
        const response = await this.post('/auth/login_flow/' + login.flow_id, {
            username: this.options.username,
            password: this.options.password
        })
        const params = new URLSearchParams()
        params.append('client_id', this.url + '/')
        params.append('code', response.result)
        params.append('grant_type', 'authorization_code')
        const resp = await fetch(this.url + '/auth/token', {
            method: 'post', body: params
        })
        const token = await resp.json()
        this.accessToken = token.access_token
    }

    /** Clean up connections and stop the HomeAssistant server */
    async close() {
        this.process.kill('SIGINT')
        await new Promise(resolve => this.process.on('exit', resolve))
        await promisify(rm)(this.configDir, { recursive: true })
    }

}
