// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";
import { AzureAppConfigurationKeyVaultOptions } from "./keyvault/AzureAppConfigurationKeyVaultOptions";

export const MaxRetries = 2;
export const MaxRetryDelayInMs = 60000;

export interface AzureAppConfigurationOptions {
    /**
     * Selectors used to control what key-values are retrieved from Azure App Configuration.
     *
     * @property keyFilter: A filter that determines the set of keys that are included in the configuration provider, cannot be omitted.
     * @property labelFilter: A filter that determines what label to use when selecting key-values for the the configuration provider, omitted for no label.
     */
    selectors?: { keyFilter: string, labelFilter?: string }[];
    trimKeyPrefixes?: string[];
    clientOptions?: AppConfigurationClientOptions;
    keyVaultOptions?: AzureAppConfigurationKeyVaultOptions;
}