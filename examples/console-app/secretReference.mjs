// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
dotenv.config();

/**
 * Before you run it, please add a Key Vault reference with key "app.secret" in your App Configuration store.
 * This example uses the same identity to authenticate with both App Configuration and Key Vault. Make sure that this identity has access to read secrets from Key Vault.
 * Value of secret "app.secret" will be printed.
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
    keyVaultOptions: {
        credential: credential
    }
});
const secretKey = "app.secret";
const value = settings.get(secretKey);

console.log(`Get the secret from keyvault key: ${secretKey}, value: ${value}`);
