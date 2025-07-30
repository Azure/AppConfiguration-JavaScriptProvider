// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
import { promisify } from "util";
dotenv.config();
const sleepInMs = promisify(setTimeout);

/**
 * This example retrives all settings with key following pattern "app.settings.*", i.e. starting with "app.settings.".
 * With the option `trimKeyPrefixes`, it trims the prefix "app.settings." from keys for simplicity.
 * Value of config "app.settings.message" will be printed.
 *
 * Below environment variables are required for this example:
 * - APPCONFIG_CONNECTION_STRING
 */

import { loadFromAzureFrontDoor } from "@azure/app-configuration-provider";
const endpoint = process.env.AZURE_FRONT_DOOR_ENDPOINT;
const settings = await loadFromAzureFrontDoor(endpoint, {
    selectors: [{
        keyFilter: "CDN.*"
    }],
    trimKeyPrefixes: ["CDN."],
    refreshOptions: {
        enabled: true,
        refreshIntervalInMs: 15_000
    }
});

while (true) {
    await settings.refresh();
    console.log(`Message from Azure Front Door: ${settings.get("Message")}`);
    // wait for 30 seconds
    await sleepInMs(30_000);
}