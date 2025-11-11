// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as dotenv from "dotenv";
dotenv.config();

/**
 * This example demonstrates how to construct a configuration object from settings loaded from Azure App Configuration.
 * If you are using configuration object instead of Map-styled settings, it would minimize the code changes required to use Azure App Configuration in your application.
 *
 * When you import configuration into Azure App Configuration from a local .json file, the keys are automatically flattened with a separator if specified.
 * E.g. if you import the following .json file, specifying the separator as ".":
 * {
 *   "app": {
 *     "settings": {
 *       "message": "Hello, Azure!"
 *     }
 *   }
 * }
 *
 * In the configuration explorer, the key-values will be:
 *  - Key: "app.settings.message", Value: "Hello, Azure!"
 *
 * With the API `constructConfigurationObject`, you can construct a configuration object with the same shape as the original .json file.
 * The separator is used to split the keys and construct the object.
 * The constructed object will be: { app: { settings: { message: "Hello, Azure!" } } }
 *
 * Below environment variables are required for this example:
 * - APPCONFIG_CONNECTION_STRING
 */

import { load } from "@azure/app-configuration-provider";
const connectionString = process.env.APPCONFIG_CONNECTION_STRING;
const settings = await load(connectionString, {
    selectors: [{
        keyFilter: "app.settings.*"
    }]
});

/**
 * Construct configuration object based on Map-styled data structure and hierarchical keys.
 * The default separator is ".", you can specify a custom separator by constructConfigurationObject({separator: "<custom_separator>"}).
 */
const config = settings.constructConfigurationObject();

console.log("Constructed object 'config': ", config);
console.log(`Message from Azure App Configuration: ${config.app.settings.message}`);
