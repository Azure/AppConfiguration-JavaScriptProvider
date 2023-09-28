// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
dotenv.config()

/**
 * This example retrives all settings with key following pattern "app.settings.*", i.e. starting with "app.settings.".
 * With the option `trimKeyPrefixes`, it trims the prefix "app.settings." from keys for simplicity.
 * Value of config "app.settings.message" will be printed.
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
    trimKeyPrefixes: ["app.settings."]
});
const message = settings.get("message");

console.log(`Message from Azure App Configuration: ${message}`);