import { chromium, webkit, firefox } from 'playwright'
import type { Browser, ElementHandle, Page, LaunchOptions, BrowserContext } from 'playwright'
import type { BrowserIntegration, BrowserPage, DashboardOptions, DiffOptions } from '../types.ts'
import { getDiffableHTML } from './get-diffable-html.ts'

export type PlaywrightElement = ElementHandle<Node>

export class PlaywrightBrowser implements BrowserIntegration<PlaywrightElement> {
    private static browsers = { chromium, webkit, firefox }
    private browserName: keyof typeof PlaywrightBrowser.browsers
    private browserPromise: Promise<Browser>

    constructor(browserName: string, options?: LaunchOptions) {
        if (browserName !== 'chromium' && browserName !== 'webkit' && browserName !== 'firefox')
            throw new Error(
                `Browser name ${browserName} must be one of chromium, webkit, or firefox`,
            )
        this.browserName = browserName
        this.browserPromise = PlaywrightBrowser.browsers[browserName].launch(options)
    }

    async newPage(browser: Browser | BrowserContext) {
        return await browser.newPage()
    }

    async open(url: string, options: DashboardOptions) {
        let browser: Browser | BrowserContext = await this.browserPromise
        if (options) {
            browser = await browser.newContext({
                colorScheme: options.colorScheme,
            })
        }
        const page = await this.newPage(browser)
        await page.goto(url)
        return new PlaywrightPage(page)
    }

    async openInHeaded(url: string) {
        const browser = await PlaywrightBrowser.browsers[this.browserName].launch({
            headless: false,
        })
        const page = await this.newPage(browser)
        await page.goto(url)
        await page.waitForEvent('close', { timeout: 0 })
    }

    async close() {
        const browser = await this.browserPromise
        await browser.close()
    }
}

export class PlaywrightPage implements BrowserPage<PlaywrightElement> {
    private page: Page

    constructor(page: Page) {
        this.page = page
    }

    async getNthCard(n: number) {
        return await this.page.waitForSelector(`.column>*:nth-child(${n + 1})`)
    }

    async shadowHTML(element: PlaywrightElement, options?: Partial<DiffOptions>) {
        if (!element) throw new Error('shadowHTML expects a non-null element')
        return await element.evaluate(getDiffableHTML, options)
    }

    async screenshot(element: PlaywrightElement) {
        // Playwright's `animations: 'disabled'` only finishes transitions that have already started.
        // In Firefox and Chromium it doesn't flush styles first, so a state change that was just rendered
        // may not have started its transition yet and gets captured on its first frame. Force a style
        // flush so it starts and is fast-forwarded to its final state.
        await element.evaluate((el: Element) => el.getBoundingClientRect())

        // The frontend fades the page in when a dashboard opens. Finish those animations first so
        // the screenshot doesn't depend on how far along the fade is.
        return await element.screenshot({ animations: 'disabled' })
    }

    async find(element: PlaywrightElement, selector: string) {
        return await element.$(selector)
    }

    async textContent(element: PlaywrightElement) {
        const content = await element.textContent()
        if (content === null) throw new Error('Element has no textcontent')
        return content
    }

    get playwright() {
        return this.page
    }
}
