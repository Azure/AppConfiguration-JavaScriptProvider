// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
dotenv.config()

/**
 * This example retrives all settings starting with "app.settings.".
 * Value of config "app.settings.message" will be printed.
 *
 * Below environment variables are required for this example:
 * - APPCONFIG_ENDPOINT
 * - AZURE_TENANT_ID
 * - AZURE_CLIENT_ID
 * - AZURE_CLIENT_SECRET
 */

import { load } from "@azure/app-configuration-provider";
import { getDefaultAzureCredential } from "@azure/identity";
const endpoint = process.env.APPCONFIG_ENDPOINT;
const credential = getDefaultAzureCredential();
const settings = await load(endpoint, credential, {
    selectors: [{
        keyFilter: "app.settings.*"
    }],
    trimKeyPrefixes: ["app.settings."]
});
const message = settings.get("message");

console.log(`Message from Azure App Configuration: ${message}`);