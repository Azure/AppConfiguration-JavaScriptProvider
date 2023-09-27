// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
dotenv.config()

/**
 * This example retrives all settings and resolve secret value from keyvault.
 * Before you run it, please add a sample keyvault secret reference "app.secret".
 * Value of secret "app.secret" will be printed.
 *
 * Below environment variables are required for this example:
 * - APPCONFIG_CONNECTION_STRING
 * - APPCONFIG_ENDPOINT
 * - AZURE_TENANT_ID
 * - AZURE_CLIENT_ID
 * - AZURE_CLIENT_SECRET
 */

import { load } from "@azure/app-configuration-provider";
import { getDefaultAzureCredential } from "@azure/identity";
const connectionString = process.env.APPCONFIG_CONNECTION_STRING;
const settings = await load(connectionString, {
    keyVaultOptions: {
        credential: getDefaultAzureCredential()
    }
});
const secretKey = "app.secret";
const value = settings.get(secretKey);

console.log(`Get the secret from keyvault key: ${secretKey}, value: ${value}`);