// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TokenCredential } from "@azure/identity";
import { AzureAppConfiguration } from "./appConfiguration.js";
import { AzureAppConfigurationImpl } from "./appConfigurationImpl.js";
import { AzureAppConfigurationOptions } from "./appConfigurationOptions.js";
import { ConfigurationClientManager } from "./configurationClientManager.js";
import { instanceOfTokenCredential } from "./common/utils.js";

const MIN_DELAY_FOR_UNHANDLED_ERROR_IN_MS: number = 5_000;

/**
 * Loads the data from Azure App Configuration service and returns an instance of AzureAppConfiguration.
 * @param connectionString  The connection string for the App Configuration store.
 * @param options  Optional parameters.
 */
export async function load(connectionString: string, options?: AzureAppConfigurationOptions): Promise<AzureAppConfiguration>;

/**
 * Loads the data from Azure App Configuration service and returns an instance of AzureAppConfiguration.
 * @param endpoint  The URL to the App Configuration store.
 * @param credential  The credential to use to connect to the App Configuration store.
 * @param options  Optional parameters.
 */
export async function load(endpoint: URL | string, credential: TokenCredential, options?: AzureAppConfigurationOptions): Promise<AzureAppConfiguration>;

export async function load(
    connectionStringOrEndpoint: string | URL,
    credentialOrOptions?: TokenCredential | AzureAppConfigurationOptions,
    appConfigOptions?: AzureAppConfigurationOptions
): Promise<AzureAppConfiguration> {
    const startTimestamp = Date.now();
    let options: AzureAppConfigurationOptions | undefined;
    const clientManager = new ConfigurationClientManager(connectionStringOrEndpoint, credentialOrOptions, appConfigOptions);
    await clientManager.init();

    if (!instanceOfTokenCredential(credentialOrOptions)) {
        options = credentialOrOptions as AzureAppConfigurationOptions;
    } else {
        options = appConfigOptions;
    }

    try {
        const appConfiguration = new AzureAppConfigurationImpl(clientManager, options);
        await appConfiguration.load();
        return appConfiguration;
    } catch (error) {
        // load() method is called in the application's startup code path.
        // Unhandled exceptions cause application crash which can result in crash loops as orchestrators attempt to restart the application.
        // Knowing the intended usage of the provider in startup code path, we mitigate back-to-back crash loops from overloading the server with requests by waiting a minimum time to propagate fatal errors.
        const delay = MIN_DELAY_FOR_UNHANDLED_ERROR_IN_MS - (Date.now() - startTimestamp);
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        throw error;
    }
}
