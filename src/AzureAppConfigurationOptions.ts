// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";
import { AzureAppConfigurationKeyVaultOptions } from "./keyvault/AzureAppConfigurationKeyVaultOptions";

export const MaxRetries = 2;
export const MaxRetryDelayInMs = 60000;

export interface AzureAppConfigurationOptions {
    selectors?: { keyFilter: string, labelFilter: string }[];
    trimKeyPrefixes?: string[];
    clientOptions?: AppConfigurationClientOptions;
    keyVaultOptions?: AzureAppConfigurationKeyVaultOptions;
}