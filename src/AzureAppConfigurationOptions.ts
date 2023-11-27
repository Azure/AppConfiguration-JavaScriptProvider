// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";
import { AzureAppConfigurationKeyVaultOptions } from "./keyvault/AzureAppConfigurationKeyVaultOptions";
import { SettingSelector } from "./types";

export const MaxRetries = 2;
export const MaxRetryDelayInMs = 60000;

export interface AzureAppConfigurationOptions {
    /**
     * Specify what key-values to include in the configuration provider.
     * If no selectors are specified then all key-values with no label will be included.
     */
    selectors?: SettingSelector[];
    trimKeyPrefixes?: string[];
    clientOptions?: AppConfigurationClientOptions;
    keyVaultOptions?: AzureAppConfigurationKeyVaultOptions;
}