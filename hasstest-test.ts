import HassTest from './hass-test';
import playwright from 'playwright';

// @ts-ignore
import { selectorEngine } from "query-selector-shadow-dom/plugins/playwright";

const hass = new HassTest(`
input_number:
  slider1:
    name: Slider
    initial: 30
    min: -20
    max: 35
    step: 1
`);

(async () => {
    await hass.start();
    await playwright.selectors.register('shadow', selectorEngine);

    const browser = await playwright.firefox.launch({ headless: false, slowMo: 100 });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(hass.dashboard);

    const elementHandle = await page.waitForSelector('shadow=hui-input-number-entity-row');
    await elementHandle!.screenshot({ path: 'example.png' });

    await new Promise(resolve => setTimeout(resolve, 5000));

    await browser.close();
})().finally(() => {
    return hass.close();
});
