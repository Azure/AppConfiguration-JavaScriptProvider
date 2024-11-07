// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, AppConfigurationClientOptions } from "@azure/app-configuration";
import { TokenCredential } from "@azure/identity";
import { AzureAppConfiguration } from "./AzureAppConfiguration.js";
import { AzureAppConfigurationImpl } from "./AzureAppConfigurationImpl.js";
import { AzureAppConfigurationOptions, MaxRetries, MaxRetryDelayInMs } from "./AzureAppConfigurationOptions.js";
import * as RequestTracing from "./requestTracing/constants.js";

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
    let client: AppConfigurationClient;
    let clientEndpoint: string | undefined;
    let options: AzureAppConfigurationOptions | undefined;

    // input validation
    if (typeof connectionStringOrEndpoint === "string" && !instanceOfTokenCredential(credentialOrOptions)) {
        const connectionString = connectionStringOrEndpoint;
        options = credentialOrOptions as AzureAppConfigurationOptions;
        const clientOptions = getClientOptions(options);
        client = new AppConfigurationClient(connectionString, clientOptions);
        clientEndpoint = getEndpoint(connectionStringOrEndpoint);
    } else if ((connectionStringOrEndpoint instanceof URL || typeof connectionStringOrEndpoint === "string") && instanceOfTokenCredential(credentialOrOptions)) {
        // ensure string is a valid URL.
        if (typeof connectionStringOrEndpoint === "string") {
            try {
                const endpointUrl = new URL(connectionStringOrEndpoint);
                clientEndpoint = endpointUrl.toString();
            } catch (error) {
                if (error.code === "ERR_INVALID_URL") {
                    throw new Error("Invalid endpoint URL.", { cause: error });
                } else {
                    throw error;
                }
            }
        } else {
            clientEndpoint = connectionStringOrEndpoint.toString();
        }
        const credential = credentialOrOptions as TokenCredential;
        options = appConfigOptions;
        const clientOptions = getClientOptions(options);
        client = new AppConfigurationClient(clientEndpoint, credential, clientOptions);
    } else {
        throw new Error("A connection string or an endpoint with credential must be specified to create a client.");
    }

    try {
        const appConfiguration = new AzureAppConfigurationImpl(client, clientEndpoint, options);
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
 * Loads the data from a CDN and returns an instance of AzureAppConfiguration.
 * @param cdnEndpoint  The URL to the CDN.
 * @param appConfigOptions  Optional parameters.
 */
export async function loadFromCdn(cdnEndpoint: URL | string, options?: AzureAppConfigurationOptions): Promise<AzureAppConfiguration>;

export async function loadFromCdn(
    cdnEndpoint: string | URL,
    appConfigOptions?: AzureAppConfigurationOptions
): Promise<AzureAppConfiguration> {
    const emptyTokenCredential: TokenCredential = {
        getToken: async () => ({ token: "", expiresOnTimestamp: 0 })
    };

    if (appConfigOptions === undefined) {
        appConfigOptions = { clientOptions: {}};
    }
    // Specify the api version that supports sas token authentication
    appConfigOptions.clientOptions = { ...appConfigOptions.clientOptions, apiVersion: "2024-09-01-preview"};

    return await load(cdnEndpoint, emptyTokenCredential, appConfigOptions);
}

function instanceOfTokenCredential(obj: unknown) {
    return obj && typeof obj === "object" && "getToken" in obj && typeof obj.getToken === "function";
}

function getClientOptions(options?: AzureAppConfigurationOptions): AppConfigurationClientOptions | undefined {
    // user-agent
    let userAgentPrefix = RequestTracing.USER_AGENT_PREFIX; // Default UA for JavaScript Provider
    const userAgentOptions = options?.clientOptions?.userAgentOptions;
    if (userAgentOptions?.userAgentPrefix) {
        userAgentPrefix = `${userAgentOptions.userAgentPrefix} ${userAgentPrefix}`; // Prepend if UA prefix specified by user
    }

    // retry options
    const defaultRetryOptions = {
        maxRetries: MaxRetries,
        maxRetryDelayInMs: MaxRetryDelayInMs,
    };
    const retryOptions = Object.assign({}, defaultRetryOptions, options?.clientOptions?.retryOptions);

    return Object.assign({}, options?.clientOptions, {
        retryOptions,
        userAgentOptions: {
            userAgentPrefix
        }
    });
}

function getEndpoint(connectionString: string): string | undefined {
    const parts = connectionString.split(";");
    const endpointPart = parts.find(part => part.startsWith("Endpoint="));

    if (endpointPart) {
        let endpoint = endpointPart.split("=")[1];
        if (!endpoint.endsWith("/")) {
            endpoint += "/";
        }
        return endpoint;
    }

    return undefined;
}
