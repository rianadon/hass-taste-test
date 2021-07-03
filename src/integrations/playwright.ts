import { ElementHandle, Page } from "playwright"
import { readFileSync } from 'fs'

const htmlScript = readFileSync(__dirname + '/util/get-diffable-html.js', 'utf-8')

export async function waitForHA(page: Page) {
    await page.waitForSelector('home-assistant-main', { state: 'attached' })
    await new Promise(r => setTimeout(r, 100))
}

export async function selectCards(page: Page) {
    await waitForHA(page)
    const columns = await page.$$('.column')
    const cards = await Promise.all(columns.map(c => c.$$('xpath=child::*')))
    return cards.flat()
}

export async function shadowHTML(page: Page, element: ElementHandle) {
    if (!element) throw new Error('shadowHTML expects a non-null element')
    const func = new Function('card', htmlScript + 'return getDiffableHTML(card)')
    return await page.evaluate(func as any, element) as string
}
