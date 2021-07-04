import { chromium, webkit, firefox, Browser, ElementHandle, Page, LaunchOptions } from 'playwright'
import { readFileSync } from 'fs'
import { BrowserIntegration, BrowserPage, DiffOptions } from '../types'

const htmlScript = readFileSync(__dirname + '/../../lib/integrations/get-diffable-html.js', 'utf-8')

export type Element = ElementHandle<Node>

export default class PlaywrightIntegration implements BrowserIntegration<Element> {
    private static browsers = { chromium, webkit, firefox }
    private browserName: keyof typeof PlaywrightIntegration.browsers
    private browserPromise: Promise<Browser>

    constructor(browserName: string, options?: LaunchOptions) {
        if (browserName !== 'chromium' && browserName !== 'webkit' && browserName !== 'firefox')
            throw new Error(
                `Browser name ${browserName} must be one of chromium, webkit, or firefox`
            )
        this.browserName = browserName
        this.browserPromise = PlaywrightIntegration.browsers[browserName].launch(options)
    }

    async open(url: string) {
        const browser = await this.browserPromise
        const page = await browser.newPage()
        await page.goto(url)
        return new PlaywrightPage(page)
    }

    async openInHeaded(url: string) {
        const browser = await PlaywrightIntegration.browsers[this.browserName].launch({
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

export class PlaywrightPage implements BrowserPage<Element> {
    constructor(private page: Page) {}

    async getNthCard(n: number) {
        return await this.page.waitForSelector(`.column>*:nth-child(${n + 1})`)
    }

    async shadowHTML(element: Element, options?: DiffOptions) {
        if (!element) throw new Error('shadowHTML expects a non-null element')
        const func = new Function('args', htmlScript + 'return getDiffableHTML(args[0], args[1])')
        return (await this.page.evaluate(func as any, [element, options])) as string
    }

    async screenshot(element: Element) {
        return await element.screenshot()
    }

    async find(element: Element, selector: string) {
        return await element.$(selector)
    }

    async textContent(element: Element) {
        const content = await element.textContent()
        if (content === null) throw new Error('Element has no textcontent')
        return content
    }
}
