// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TokenCredential } from "@azure/identity";
import { AzureAppConfiguration } from "./AzureAppConfiguration.js";
import { AzureAppConfigurationImpl } from "./AzureAppConfigurationImpl.js";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions.js";
import { ConfigurationClientManager } from "./ConfigurationClientManager.js";

const MIN_DELAY_FOR_UNHANDLED_ERROR: number = 5000; // 5 seconds

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
    let clientManager: ConfigurationClientManager;

    // input validation
    if (typeof connectionStringOrEndpoint === "string" && !instanceOfTokenCredential(credentialOrOptions)) {
        const connectionString = connectionStringOrEndpoint;
        options = credentialOrOptions as AzureAppConfigurationOptions;
        clientManager = new ConfigurationClientManager(connectionString, options);
    } else if ((connectionStringOrEndpoint instanceof URL || typeof connectionStringOrEndpoint === "string") && instanceOfTokenCredential(credentialOrOptions)) {
        let endpoint = connectionStringOrEndpoint;
        // ensure string is a valid URL.
        if (typeof endpoint === "string") {
            try {
                endpoint = new URL(endpoint);
            } catch (error) {
                if (error.code === "ERR_INVALID_URL") {
                    throw new Error("Invalid endpoint URL.", { cause: error });
                } else {
                    throw error;
                }
            }
        }
        const credential = credentialOrOptions as TokenCredential;
        options = appConfigOptions;
        clientManager = new ConfigurationClientManager(endpoint, credential, options);
    } else {
        throw new Error("A connection string or an endpoint with credential must be specified to create a client.");
    }

    try {
        const appConfiguration = new AzureAppConfigurationImpl(clientManager, options);
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

function instanceOfTokenCredential(obj: unknown) {
    return obj && typeof obj === "object" && "getToken" in obj && typeof obj.getToken === "function";
}
