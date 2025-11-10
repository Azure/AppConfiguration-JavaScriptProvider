// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TokenCredential } from "@azure/identity";
import { AzureAppConfiguration } from "./appConfiguration.js";
import { AzureAppConfigurationImpl } from "./appConfigurationImpl.js";
import { AzureAppConfigurationOptions } from "./appConfigurationOptions.js";
import { ConfigurationClientManager } from "./configurationClientManager.js";
import { AnonymousRequestPipelinePolicy, RemoveSyncTokenPipelinePolicy } from "./afd/afdRequestPipelinePolicy.js";
import { instanceOfTokenCredential } from "./common/utils.js";
import { ArgumentError } from "./common/errors.js";
import { ErrorMessages } from "./common/errorMessages.js";

const MIN_DELAY_FOR_UNHANDLED_ERROR_IN_MS: number = 5_000;

// Empty token credential to be used when loading from Azure Front Door
const emptyTokenCredential: TokenCredential = {
    getToken: async () => ({ token: "", expiresOnTimestamp: Number.MAX_SAFE_INTEGER })
};

/**
 * Loads the data from Azure App Configuration service and returns an instance of AzureAppConfiguration.
 * @param connectionString  The connection string for the App Configuration store.
 * @param options  Optional parameters.
 */
export async function load(connectionString: string, options?: AzureAppConfigurationOptions): Promise<AzureAppConfiguration>;

/**
 * Loads the data from Azure App Configuration service and returns an instance of AzureAppConfiguration.
 * @param endpoint  The App Configuration store endpoint.
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
        const isAfdUsed: boolean = credentialOrOptions === emptyTokenCredential;
        const appConfiguration = new AzureAppConfigurationImpl(clientManager, options, isAfdUsed);
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

/**
 * Loads the data from Azure Front Door and returns an instance of AzureAppConfiguration.
 * @param endpoint  The Azure Front Door endpoint.
 * @param appConfigOptions  Optional parameters.
 */
export async function loadFromAzureFrontDoor(endpoint: URL | string, options?: AzureAppConfigurationOptions): Promise<AzureAppConfiguration>;

export async function loadFromAzureFrontDoor(
    endpoint: string | URL,
    appConfigOptions: AzureAppConfigurationOptions = {}
): Promise<AzureAppConfiguration> {
    if (appConfigOptions.replicaDiscoveryEnabled) {
        throw new ArgumentError(ErrorMessages.REPLICA_DISCOVERY_NOT_SUPPORTED);
    }
    if (appConfigOptions.loadBalancingEnabled) {
        throw new ArgumentError(ErrorMessages.LOAD_BALANCING_NOT_SUPPORTED);
    }
    if (appConfigOptions.refreshOptions?.watchedSettings && appConfigOptions.refreshOptions.watchedSettings.length > 0) {
        throw new ArgumentError(ErrorMessages.WATCHED_SETTINGS_NOT_SUPPORTED);
    }

    appConfigOptions.replicaDiscoveryEnabled = false; // Disable replica discovery when loading from Azure Front Door

    appConfigOptions.clientOptions = {
        ...appConfigOptions.clientOptions,
        additionalPolicies: [
            ...(appConfigOptions.clientOptions?.additionalPolicies || []),
            { policy: new AnonymousRequestPipelinePolicy(), position: "perRetry" },
            { policy: new RemoveSyncTokenPipelinePolicy(), position: "perRetry" }
        ]
    };

    return await load(endpoint, emptyTokenCredential, appConfigOptions);
}
