// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";
import { AzureAppConfigurationKeyVaultOptions } from "./keyvault/AzureAppConfigurationKeyVaultOptions";

export interface AzureAppConfigurationOptions {
    selectors?: { keyFilter: string, labelFilter: string }[];
    trimKeyPrefixes?: string[];
    clientOptions?: AppConfigurationClientOptions;
    keyVaultOptions?: AzureAppConfigurationKeyVaultOptions;
}