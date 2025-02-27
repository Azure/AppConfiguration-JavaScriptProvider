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
 * It also watches for changes to the key "app.settings.sentinel" and refreshes the configuration when it changes.
 *
 * Below environment variables are required for this example:
 * - APPCONFIG_CONNECTION_STRING
 */

import { load } from "@azure/app-configuration-provider";
const connectionString = process.env.APPCONFIG_CONNECTION_STRING;
const settings = await load(connectionString, {
    selectors: [{
        keyFilter: "app.settings.*"
    }],
    trimKeyPrefixes: ["app.settings."],
    refreshOptions: {
        enabled: true,
        watchedSettings: [{ key: "app.settings.sentinel" }]
        // By default, the refresh interval is 30 seconds. You can change it by setting refreshIntervalInMs.
    }
});

console.log("Using Azure portal or CLI, update the `app.settings.message` value, and then update the `app.settings.sentinel` value in your App Configuration store.")

// eslint-disable-next-line no-constant-condition
while (true) {
    console.log(settings.get("message"));
    // this is a blocking call and you can remove await to make the refresh operation asynchronous
    await settings.refresh();
    // wait for 5 seconds
    await sleepInMs(5_000);
}
