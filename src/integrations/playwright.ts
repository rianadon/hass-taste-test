import { Browser, ElementHandle, Page, LaunchOptions, BrowserContext } from 'playwright'
import { chromium, webkit, firefox } from 'playwright'
import { readFileSync } from 'fs'
import { BrowserIntegration, BrowserPage, DashboardOptions, DiffOptions } from '../types'

const htmlScript = readFileSync(__dirname + '/../../lib/integrations/get-diffable-html.js', 'utf-8')

export type PlaywrightElement = ElementHandle<Node>

export class PlaywrightBrowser implements BrowserIntegration<PlaywrightElement> {
    private static browsers = { chromium, webkit, firefox }
    private browserName: keyof typeof PlaywrightBrowser.browsers
    private browserPromise: Promise<Browser>

    constructor(browserName: string, options?: LaunchOptions) {
        if (browserName !== 'chromium' && browserName !== 'webkit' && browserName !== 'firefox')
            throw new Error(
                `Browser name ${browserName} must be one of chromium, webkit, or firefox`
            )
        this.browserName = browserName
        this.browserPromise = PlaywrightBrowser.browsers[browserName].launch(options)
    }

    async open(url: string, options: DashboardOptions) {
        let browser: Browser | BrowserContext = await this.browserPromise
        if (options) {
            browser = await browser.newContext({
                colorScheme: options.colorScheme,
            })
        }
        const page = await browser.newPage()
        await page.goto(url)
        return new PlaywrightPage(page)
    }

    async openInHeaded(url: string) {
        const browser = await PlaywrightBrowser.browsers[this.browserName].launch({
            headless: false,
        })
        const page = await browser.newPage()
        await page.goto(url)
        await page.waitForEvent('close', { timeout: 0 })
    }

    async close() {
        const browser = await this.browserPromise
        await browser.close()
    }
}

export class PlaywrightPage implements BrowserPage<PlaywrightElement> {
    constructor(private page: Page) {}

    async getNthCard(n: number) {
        return await this.page.waitForSelector(`.column>*:nth-child(${n + 1})`)
    }

    async shadowHTML(element: PlaywrightElement, options?: DiffOptions) {
        if (!element) throw new Error('shadowHTML expects a non-null element')
        const func = new Function('args', htmlScript + 'return getDiffableHTML(args[0], args[1])')
        return (await this.page.evaluate(func as any, [element, options])) as string
    }

    async screenshot(element: PlaywrightElement) {
        return await element.screenshot()
    }

    async find(element: PlaywrightElement, selector: string) {
        return await element.$(selector)
    }

    async textContent(element: PlaywrightElement) {
        const content = await element.textContent()
        if (content === null) throw new Error('Element has no textcontent')
        return content
    }
}
