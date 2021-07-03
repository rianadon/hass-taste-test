import { chromium, webkit, firefox, Browser, ElementHandle, Page } from "playwright"
import { readFileSync } from 'fs'
import { BrowserIntegration, BrowserPage } from "../types"

const htmlScript = readFileSync(__dirname + '/../../lib/integrations/get-diffable-html.js', 'utf-8')

export default class PlaywrightIntegration implements BrowserIntegration {

    private static browsers = {chromium, webkit, firefox}
    private browserPromise: Promise<Browser>

    constructor(browsername: 'chromium' | 'webkit' | 'firefox') {
        this.browserPromise = PlaywrightIntegration.browsers[browsername].launch()
    }

    async open(url: string) {
        const browser = await this.browserPromise
        const page = await browser.newPage()
        await page.goto(url)
        return new PlaywrightPage(page)
    }

    async close() {
        const browser = await this.browserPromise
        await browser.close()
    }
}

export class PlaywrightPage implements BrowserPage<ElementHandle> {

    constructor(private page: Page) { }

    async getNthCard(n: number) {
        return await this.page.waitForSelector(`.column>*:nth-child(${n+1})`)
    }

    async shadowHTML(element: ElementHandle) {
        if (!element) throw new Error('shadowHTML expects a non-null element')
        const func = new Function('card', htmlScript + 'return getDiffableHTML(card)')
        return await this.page.evaluate(func as any, element) as string
    }

}
