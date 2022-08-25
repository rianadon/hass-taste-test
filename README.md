<p align="center">
  <a href="http://badge.fury.io/js/hass-taste-test"><img src="https://badge.fury.io/js/hass-taste-test.svg?color=brightgreen" alt="npm version"></a>
  <a href="https://github.com/rianadon/hass-taste-test/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL_3.0-brightgreen.svg" alt="Hass Taste Test is released under the AGPL 3.0 license." />
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

_Hass Taste Test is not developed or maintained by the authors of Home Assistant, and it is currently in prerelease so the API may change. Use at your own risk._

Jump to: [Quickstart](#quickstart) | [Visual Regression Testing](#why-visual-regression-testing) | [Concepts](#important-concepts) | [Best Practices](#best-practices-and-advice) | [Reference](#reference)

## Quickstart

This guide will walk you through setting up tests for visual regression testing. This is a [fun and easy](#why-visual-regression-testing) way to quickly test your card responds how it's supposed to, and ensures that if you add a bug (regression) to your code that messes up the card, you'll catch it before you deploy!

I recommend using either [Jest](https://jestjs.io) or [AVA](https://avajs.dev) for writing tests and [Playwright](https://playwright.dev) for browser automation. Both Jest and AVA run test files in parallel, and Playwright allows you to test on Chromium, Firefox, and WebKit. Since Jest has great support for [image snapshots](https://github.com/americanexpress/jest-image-snapshot), this guide will use Jest.

1. Install dependencies

```bash
npm install --save-dev hass-taste-test jest jest-image-snapshot playwright
```

2. Verify that Hass Taste Test can download and run Home Assistant:

```bash
npx hass-taste-test
```

3. Create a tests directory `__tests__` and create a file within it: `__tests__/card.test.js`. Add this code:

```javascript
const { HomeAssistant, PlaywrightBrowser } = require('hass-taste-test')
const { toMatchImageSnapshot } = require('jest-image-snapshot')

expect.extend({ toMatchImageSnapshot })

const CONFIGURATION_YAML = `
input_boolean:
  test:
`

let hass // Global Home Assistant for this test file

beforeAll(async () => {
    hass = await HomeAssistant.create(CONFIGURATION_YAML, {
        browser: new PlaywrightBrowser(process.env.BROWSER || 'firefox'),
    })
    // Add your card's JavaScript bundle to Lovelace
    await hass.addResource(__dirname + '/../dist/boilerplate-card.js', 'module')
}, 30000) // 30 second timeout in case Home Assistant needs to install

afterAll(async () => await hass.close())

it('Custom Card', async () => {
    // Change type to your card type, and add whatever configuration you need
    const dashboard = await hass.Dashboard([
        { type: 'custom:boilerplate-card', entity: 'input_boolean.test' },
    ])
    // await hass.callService() is how you can call a service
    expect(await dashboard.cards[0].screenshot()).toMatchImageSnapshot()
})
```

4. Run your tests with `npx jest`! You can also run Jest in watch mode (`npx jest --watch`)

5. When you change the interface of your card, update your snapshots using `npx jest -u`. Even better, install Jest globally (`npm install -g jest`)—then you don't need to use `npx` and can run `jest -u`.

You may now consider customizing your Jest configuration using (`npx jest --init`), [learning more about Jest](https://jestjs.io/docs/getting-started), and browsing through the [examples](https://github.com/rianadon/hass-taste-test/tree/main/test)

## Developing

If you wish to make changes to this repository, follow these instructions. Tests are run with `ts-node`, so no recompilation of typescript is necessary.

1. Install dependencies

```bash
npm install
```

2. Run tests

```bash
npm run test
```

### But I want to write my tests in TypeScript

Install [`ts-jest`](https://kulshekhar.github.io/ts-jest/docs/getting-started/installation/), `@types/jest`, and `@types/jest-image-snapshot` along with the other dependencies, then run `npx ts-jest config:init` to configure Jest for Typescript. Browse the [examples](https://github.com/rianadon/hass-taste-test/tree/main/test) for example tests; they are all written in TypeScript.

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

## Important concepts

-   **Home Assistant objects**: The `HomeAssistant` class creates a new Home Assistant Core instance. Each of these is fully isolated, so you can write multiple tests files each doing wildly different things without worrying about conflicts. They start up in parallel, except for about <100ms when multiple instances coordinate amongst themselves sequentially to choose unique ports and ensure Home Assistant is installed and upgraded.

    Each instance creates a configuration directory in your [temporary directory](https://en.wikipedia.org/wiki/Temporary_folder), and these are deleted when `hass.close()` is called. The Home Assistant Core virtual environment is also stored in the temp directory, but is kept around for reuse.

-   **Dashboards**: Individual tests are isolated by using unique Lovelace Dashboards. This isolation is good for tracking down which test broke and for, if you are using AVA, running tests within a file in parallel. The name and id for dashboards are automatically generated.

    You can grab references to cards and elements using `dashboard.cards[0]` or `dashboards.cards[1].narrow('.text-content')`. These are merely references; the test will not look for these elements inside the page until you call `.screenshot()`, `.html()`, or `.text()`, which all return [Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).

-   **Browser Integrations**: Hass Taste Test only requires a browser for working with cards in the dashboard; Home Assistant is configured entirely through the REST API. If you'd like to use the Dashboard card methods, you'll need to pass a browser integration instance to the `browser` option when configuring a `HomeAssistant` object.

    Currently only [Playwright](https://playwright.dev) is supported, but you can write your own for other tools.

## Best practices and advice

1. Use a unique entity in each test function. Rather than turn on `input_boolean.test` in test function #1 then screenshot the card with the same entity in test function #2, combine both into one function or create two inputs and turn on `input_boolean.test1` in test function #1 then screenshot the card with `input_boolean.test2` in test function #2.

    If you need an easy way of creating multiple copies of entities, use [YAML anchors](https://support.atlassian.com/bitbucket-cloud/docs/yaml-anchors/) or the `multiply` function:

    ```javascript
    const { multiply, HomeAssistant, PlaywrightBrowser } = require('hass-taste-test')

    const CONFIGURATION_YAML = `
    input_boolean:
    ${multiply(10, (i) => `
      test${i}:
        name: Test number ${i}
    1)}
    `

    // Now you have `test1`, `test2`, … `test10`
    ```

2. Use `await dashboard.openInBrowser()` for debugging. This method opens a browser on the current page and pauses your test until you close the browser.

    To inspect network requests as the page first loads, use the snippet below. Make sure to either comment out `hass.close()` so Home Assistant doesn't quit, or provide a suitable delay and increase the test timeout.

    ```javascript
    console.log(await dashboard.link()) // Print dashboard url
    await new Promise((resolve) => setTimeout(resolve, 5000)) // Wait 5 seconds
    ```

3. The `dashboard.cards` and `dashboard.cards[0].narrow()` properties return references, and you should treat them as such. You can assign the card element to a variable and reuse it:

    ```javascript
    const entityRow = dashboard.cards[0].narrow('.text-content')

    t.snapshot(await entityRow.text(), 'Idle state')
    await t.context.hass.callService('timer', 'start', {}, { entity_id: 'timer.laundry' })
    t.snapshot(await entityRow.text(), 'Active state')
    ```

4. If you need access to a custom component, download it in a separate script. I chose not to implement something like HACS because Node.js does not have any unzipping standard tools in its standard library, and I'd like to keep as few dependencies as possible. Besides, if you need a custom component to integrate service floof, you need to be running service floof; and if service floof is not written in Node.js then you are running a script anyways.

    For an example, see the custom component example in the [tests](https://github.com/rianadon/hass-taste-test/tree/main/test) folder.

5. The quickstart provided will work well for testing locally on your computer, but the screenshots are not consistent across browsers and even different operating systems. So if you set up a CI job for your tests, your `toMatchImageSnapshot()` assertions will likeley fail.

    I recommend considerably increasing the threshold for accepting two images as the same (5% is good) as well as adding blur. These measures ignore browser quirks but miss small textual changes. To ensure your text remains consistent, I use a [custom matcher](https://github.com/rianadon/timer-bar-card/blob/d02982f09ca809195d9c6dbff08201a19b24c9d1/test/util.ts#L53-L73) in my components to test check the HTML and the screenshot at once, and recommend you do the same.

6. If you are running on a CI server, setting up Home Assistant can take some time. To avoid having to set your test timeouts higher than the sky, set your `npm test` script to `hass-taste-test && jest` or ensure `npx hass-taste-test` is run before `npm test`.

## Reference

To see examples of these methods in action, see the [tests](https://github.com/rianadon/hass-taste-test/tree/main/test) folder, which has many great examples.

### `HomeAssistant`

#### `static async create(config, options) -> HomeAssistant`

Configures, starts, and connects to a new Home Assistant instance. Appends the string `config` to the contents of `configuration.yaml`. You can use the following properties of `options` to configure the instance:

| Option             | Description                                                                              | Default     |
| ------------------ | ---------------------------------------------------------------------------------------- | ----------- |
| `python`           | Python executable used to create virtual environment                                     | `python3`   |
| `hassArgs`         | Arguments to pass to the `hass` binary                                                   | `[]`        |
| `host`             | Host to which the Home Assistant frontend and api will be bound                          | `127.0.0.1` |
| `port`             | Port used to host the Home Assistant instance. If `null`, an unused port will be chosen. | `null`      |
| `username`         | Username of the default account                                                          | `dev`       |
| `password`         | Password of the default account                                                          | `dev`       |
| `userLanguage`     | Frontend language (specifically, langage of the default account)                         | `en`        |
| `userDisplayName`  | The default account's name, displayed in the frontend                                    | `Developer` |
| `customComponents` | Paths to components to place in the `custom_components` folder                           | `[]`        |
| `browser`          | Browser integration to use for interacting with dashboard cards                          | `undefined` |

#### `static async connect(options) -> HomeAssistant`

UNTESTED! Connects to an existing Home Assistant instance. The `option` argument is the same as the `create` method: You might wish to set `host`, `port`, `username`, and `password`.

#### `ws`

The Home Assistant websocket. This is an instance of [`home-assistant-js-websocket`](https://github.com/home-assistant/home-assistant-js-websocket). Of interest might be `await ws.sendMessagePromise(message)`, which sends a message over the websocket api and returns the response.

#### `link`

Returns an authenticated link (i.e. it will log you in when you visit) to the Home Assistant default dashboard. You can log this url to the console and open it yourself, which may be useful for debugging. Just make sure your test doesn't quit too quickly on you!

#### `customDashboard(path) -> string`

Returns an authenticated link (i.e. it will log you in when you visit) to a custom dashboard, given its path (looks something like `lovelace-test`).

#### `async post(url, body, authorize=false) -> json response`

Sends a JSON POST request over the REST API. Really only useful internally, but if you need this method you'll likeley want to set `authorize` to `true` so you send requests as an authenticated user.

#### `async addIntegration(name)`

Adds / configures an integration.

#### `async addResource(filename, resourceType)`

Adds a Lovelace resource. For a custom card, `resourceType` should be `module`.

#### `async callService(domain, service, serviceData, target)`

Self-explanatory. Calls a service. This is the method you're looking for.

#### `async createDashboard(options)`

(More for internal use) Create a dashboards, and you can manually specify the name, icon, path, and title. Returns the dashboard path.

#### `async setDashboardView(path, config)`

(More for internal use) Configure a dashboard. Pass in the cards you'd like to add in config. Path should look something like `lovelace-test`.

#### `async Dashboard(config, options) -> HomeAssistant.HassDashboard`

Creates and configures a dashboard using `createDashboard` and `setDashboardView`, then opens the page in the browser and returns a Dashboard object.

Cards should be listed in `config`, and options allows you to set:

-   `colorScheme`: Can be `light` or `dark` to use the page's light or dark theme
-   That's all!

#### `async close()`

Cleans up connections and stops the Home Asssistant server.

### `HomeAsssistant.HassDashboard`

#### `async link() -> string`

Generates a link to the dashboard that will log you in. You can log this url to the console and open it yourself, which may be useful for debugging. Just make sure your test doesn't quit too quickly on you!

#### `async openInBrowser()`

Opens the dashboard in a non-headless version of the browser you configured the `HomeAssistant` to use. **Very useful for debugging**, especially if you like using the developer tools. The returned promise will resolve once you close the browser tab.

#### `async cards[n].element() -> element type`

Returns the browser element for the card. In the case of Playwright, this is a `ElementHandle`, which allows you to simulate clicks, listen for events, etc.

#### `async cards[n].text() -> string`

Returns the card element's trimmed `textContent`

#### `async cards[n].screenshot() -> Buffer`

Returns a Buffer containing image data for the card's screenshot.

#### `async cards[n].html(options) -> string`

Returns normalized HTML for of the card. This differs from `outerHTML` in that:

-   Traversal crosses Shadow DOM boundaries
-   Polymer and Lit properties are included as attributes
-   Indentation is normalized
-   Attributes are sorted by name, and you can ignore attributes (`options.ignoreAttributes`)
-   Script and style tags are not included (`options.ignoreTags`)
-   The children of Common Home Assistant elements are not included (`options.ignoreChildren` for descendants, `options.ignoreShadowChildren` for Shadow DOM children)
-   Empty and undefined attributes are not included
