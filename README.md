<p align="center">
  <!-- <a href="http://badge.fury.io/js/hass-taste-test"><img src="https://badge.fury.io/js/hass-taste-test.svg" alt="npm version"></a> -->
  <a href="https://github.com/rianadon/hass-taste-test/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL-brightgreen.svg" alt="Hass Taste Test is released under the AGPL 3.0 license." />
  </a>
</p>

<!-- A spacer -->
<p>&nbsp;</p>

<p align="center"><img src=".github/hass-taste-test.png" width="50%" /></p>

<h1 align="center">End-to-end testing for Home Assistant cards</h1>

**Hass Taste Test** 🦎 helps you write end-to-end tests against [Home Assistant](https://www.home-assistant.io). It automates installing, configuring, and connecting to isolated Home Assistant instances—plus installing custom components, creating Lovelace layouts, and taking screenshots—so you can focus on writing your tests.

🔮 **Framework agnostic**: Use whichever test framework and browser automation tool you'd like.

💨 **Super speedy**: Tasks are cached and parallelized, and Hass is configured minimally.

🚢 **Deploy confidently**: Easily test many obtuse configurations and skip the manual QA testing.

## Quickstart

This guide will walk you through setting up tests for visual regression testing. This is a [fun and easy](#why-visual-regression-testing) way to quickly test your card responds how it's supposed to, and ensures that if you add a bug (regression) to your code that messes up the card, you'll catch it before you deploy!

I recommend using either [Jest](https://jestjs.io/) or [AVA](https://avajs.dev) for writing tests and [Playwright](playwright.dev/) for browser automation. Both Jest and AVA run test files in parallel, and Playwright allows you to test on Chromium, Firefox, and WebKit. Since Jest has great support for [visual snapshots](https://github.com/americanexpress/jest-image-snapshot), this guide will use Jest.

1. Install dependencies

```bash
npm install --save-dev hass-taste-test jest jest-image-snapshot playwright
```

2. Create a tests directory `__tests__` and create a file within it: `__tests__/card.test.js`. Add this code:

```javascript
const { HomeAssistant, PlaywrightIntegration } = require('hass-taste-test')
const { toMatchImageSnapshot } = require('jest-image-snapshot')

expect.extend({ toMatchImageSnapshot })

const CONFIGURATION_YAML = `
input_boolean:
  test:
`

let hass // Global Home Assistant for this test file

beforeAll(async () => {
    hass = new HomeAssistant(CONFIGURATION_YAML, {
        integration: new PlaywrightIntegration(process.env.BROWSER || 'firefox'),
    })
    await hass.start()
    // Add your card's JavaScript bundle to Lovelace
    await hass.addResource(__dirname + '/../dist/boilerplate-card.js', 'module')
}, 30000) // 30 second timeout in case Home Assistant needs to install

afterAll(async () => await hass.close())

it('Custom Card', async () => {
    // Change type to your card type, and add whatever configuration you need
    const dashboard = await hass.Dashboard([
        { type: 'custom:boilerplate-card', entity: 'input_boolean.test' },
    ])
    expect(await dashboard.cards[0].screenshot()).toMatchImageSnapshot()
})
```

3. Run your tests with `npx jest`! You can also run Jest in watch mode (`npx jest --watch`)

4. When you change the interface of your card, update your snapshots using `npx jest -u`. Even better, install Jest globally (`npm install -g jest`)—then you don't need to use `npx` and can run `jest -u`.

You may now consider customizing your Jest configuration using (`npx jest --init`), [learning more about Jest](https://jestjs.io/docs/getting-started), and browsing through the [examples](test/)

## Why visual regression testing?

I could've shown off how you can check that the text in the selectors you care about has the right substrings, or how to check that the correct number of `div`s got added to the special container. Here's why I didn't:

-   **These tests are a pain to write**: Home Assistant is very complex, so your card may run into many edge cases that require tests. I believe test quantity is better than test quality for this domain.
-   **Styles don't change much**: Most of the time, you are likely adding additonal features to the card rather than giving it a new paint job; so you won't be needing to update snapshots often. Testing visual regressions ensures that the card will remain stable for the features you've already added.
-   **Cards are small and simple**: Small cards make for small visual diffs, which makes it easy to spot what regressed.

What if visual regression testing is not for me?

-   Grab the card's HTML and [snapshot](https://jestjs.io/docs/snapshot-testing) [it](https://github.com/avajs/ava/blob/main/docs/04-snapshot-testing.md). This works similar to visual regression tests but does not catch CSS changes.

    ```javascript
    expect(await dashboard.cards[0].hmtl()).toMatchSnapshot() // Jest
    t.snapshot(await dashboard.cards[0].hmtl()) // AVA
    ```

-   Narrow the card to an important selector and check the text.

    ```javascript
    expect(await dashboard.cards[0].narrow('.text-content').text()).to… // Jest
    t.assert(await dashboard.cards[0].narrow('.text-content').text()… ) // AVA
    ```
