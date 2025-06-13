// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TokenCredential } from "@azure/identity";
import { AzureAppConfiguration } from "./AzureAppConfiguration.js";
import { AzureAppConfigurationImpl } from "./AzureAppConfigurationImpl.js";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions.js";
import { ConfigurationClientManager } from "./ConfigurationClientManager.js";
import { CdnTokenPipelinePolicy } from "./cdnTokenPipelinePolicy.js";
import { instanceOfTokenCredential } from "./common/utils.js";
import { ArgumentError } from "./common/error.js";

const MIN_DELAY_FOR_UNHANDLED_ERROR: number = 5_000; // 5 seconds

// Empty token credential to be used when loading from CDN
const emptyTokenCredential: TokenCredential = {
    getToken: async () => ({ token: "", expiresOnTimestamp: 0 })
};

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
        const isCdnUsed: boolean = credentialOrOptions === emptyTokenCredential;
        const appConfiguration = new AzureAppConfigurationImpl(clientManager, options, isCdnUsed);
        await appConfiguration.load();
        return appConfiguration;
    } catch (error) {
        // load() method is called in the application's startup code path.
        // Unhandled exceptions cause application crash which can result in crash loops as orchestrators attempt to restart the application.
        // Knowing the intended usage of the provider in startup code path, we mitigate back-to-back crash loops from overloading the server with requests by waiting a minimum time to propagate fatal errors.
        const delay = MIN_DELAY_FOR_UNHANDLED_ERROR - (Date.now() - startTimestamp);
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        throw error;
    }
}

/**
 * Loads the data from Azure Front Door (CDN) and returns an instance of AzureAppConfiguration.
 * @param endpoint  The URL to the Azure Front Door.
 * @param appConfigOptions  Optional parameters.
 */
export async function loadFromAzureFrontDoor(endpoint: URL | string, options?: AzureAppConfigurationOptions): Promise<AzureAppConfiguration>;

export async function loadFromAzureFrontDoor(
    endpoint: string | URL,
    appConfigOptions?: AzureAppConfigurationOptions
): Promise<AzureAppConfiguration> {
    if (appConfigOptions === undefined) {
        appConfigOptions = {
            replicaDiscoveryEnabled: false // replica discovery will be enabled by default, disable it for CDN manually
        };
    }
    if (appConfigOptions.replicaDiscoveryEnabled) {
        throw new ArgumentError("Replica discovery is not supported when loading from Azure Front Door.");
    }
    if (appConfigOptions.loadBalancingEnabled) {
        throw new ArgumentError("Load balancing is not supported when loading from Azure Front Door.");
    }

    appConfigOptions.clientOptions = {
        ...appConfigOptions.clientOptions,
        // Add etag url policy to append etag to the request url for breaking CDN cache
        additionalPolicies: [
            ...(appConfigOptions.clientOptions?.additionalPolicies || []),
            { policy: new CdnTokenPipelinePolicy(), position: "perCall" }
        ]
    };

    return await load(endpoint, emptyTokenCredential, appConfigOptions);
}
