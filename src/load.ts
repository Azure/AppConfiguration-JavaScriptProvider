// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, AppConfigurationClientOptions } from "@azure/app-configuration";
import { TokenCredential } from "@azure/identity";
import { AzureAppConfiguration } from "./AzureAppConfiguration";
import { AzureAppConfigurationImpl } from "./AzureAppConfigurationImpl";
import { AzureAppConfigurationOptions, MaxRetries, MaxRetryDelayInMs } from "./AzureAppConfigurationOptions";
import * as RequestTracing from "./requestTracing/constants";

export async function load(connectionString: string, options?: AzureAppConfigurationOptions): Promise<AzureAppConfiguration>;
export async function load(endpoint: URL | string, credential: TokenCredential, options?: AzureAppConfigurationOptions): Promise<AzureAppConfiguration>;
export async function load(
    connectionStringOrEndpoint: string | URL,
    credentialOrOptions?: TokenCredential | AzureAppConfigurationOptions,
    appConfigOptions?: AzureAppConfigurationOptions
): Promise<AzureAppConfiguration> {
    let client: AppConfigurationClient;
    let options: AzureAppConfigurationOptions | undefined;
    if (typeof connectionStringOrEndpoint === "string" && !instanceOfTokenCredential(credentialOrOptions)) {
        const connectionString = connectionStringOrEndpoint;
        options = credentialOrOptions as AzureAppConfigurationOptions;
        const clientOptions = getClientOptions(options);
        client = new AppConfigurationClient(connectionString, clientOptions);
    } else if ((connectionStringOrEndpoint instanceof URL || typeof connectionStringOrEndpoint === "string") && instanceOfTokenCredential(credentialOrOptions)) {
        let endpoint = connectionStringOrEndpoint;
        // ensure string is a valid URL.
        if (typeof endpoint === "string") {
            try {
                endpoint = new URL(endpoint);
            } catch (error) {
                if (error.code === "ERR_INVALID_URL") {
                    throw new Error("Invalid Endpoint URL.", { cause: error });
                } else {
                    throw error;
                }
            }
        }
        const credential = credentialOrOptions as TokenCredential;
        options = appConfigOptions;
        const clientOptions = getClientOptions(options);
        client = new AppConfigurationClient(endpoint.toString(), credential, clientOptions);
    } else {
        throw new Error("A connection string or an endpoint with credential must be specified to create a client.");
    }

    const appConfiguration = new AzureAppConfigurationImpl(client, options);
    await appConfiguration.load();
    return appConfiguration;
}

function instanceOfTokenCredential(obj: unknown) {
    return obj && typeof obj === "object" && "getToken" in obj && typeof obj.getToken === "function";
}

function getClientOptions(options?: AzureAppConfigurationOptions): AppConfigurationClientOptions | undefined {
    // user-agent
    let userAgentPrefix = RequestTracing.UserAgentPrefix; // Default UA for JavaScript Provider
    const userAgentOptions = options?.clientOptions?.userAgentOptions;
    if (userAgentOptions?.userAgentPrefix) {
        userAgentPrefix = `${userAgentOptions.userAgentPrefix} ${userAgentPrefix}`; // Prepend if UA prefix specified by user
    }

    // retry options
    const defaultRetryOptions = {
        maxRetries: MaxRetries,
        maxRetryDelayInMs: MaxRetryDelayInMs,
    }
    const retryOptions = Object.assign({}, defaultRetryOptions, options?.clientOptions?.retryOptions);

    return Object.assign({}, options?.clientOptions, {
        retryOptions,
        userAgentOptions: {
            userAgentPrefix
        }
    });
}
