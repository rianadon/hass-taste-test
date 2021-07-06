#!/usr/bin/env node
import { HomeAssistant } from './'
;(async () => {
    console.log('Ensuring Home Assistant packages are installed...')
    const hass = await HomeAssistant.create('', {})
    await hass.close()
    console.log('All set!')
})()
