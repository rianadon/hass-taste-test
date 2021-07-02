import HassTest from './hass-test';
import playwright from 'playwright';

// @ts-ignore
import { selectorEngine } from "query-selector-shadow-dom/plugins/playwright";

const CONFIG = `
input_number:
  slider1:
    name: Slider
    initial: 30
    min: -20
    max: 35
    step: 1
`;

const hass = new HassTest('/Users/ryan/Documents/git/home-assistant-core/venv', CONFIG);
(async () => {
    await hass.start();
    await playwright.selectors.register('shadow', selectorEngine);

    const browser = await playwright.firefox.launch({ headless: false, slowMo: 100 });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(hass.dashboard);

    const elementHandle = await page.waitForSelector('shadow=hui-input-number-entity-row');
    await elementHandle!.screenshot({ path: `example.png` });

    await browser.close();
})().finally(() => {
    hass.close();
});
