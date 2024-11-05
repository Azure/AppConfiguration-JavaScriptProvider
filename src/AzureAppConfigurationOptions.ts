// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";
import { KeyVaultOptions } from "./keyvault/KeyVaultOptions.js";
import { RefreshOptions } from "./RefreshOptions.js";
import { SettingSelector } from "./types.js";
import { FeatureFlagOptions } from "./featureManagement/FeatureFlagOptions.js";

export const MaxRetries = 2;
export const MaxRetryDelayInMs = 60000;

export interface AzureAppConfigurationOptions {
    /**
     * Specify what key-values to include in the configuration provider.
     *
     * @remarks
     * If no selectors are specified then all key-values with no label will be included.
     */
    selectors?: SettingSelector[];

    /**
     * Specifies prefixes to be trimmed from the keys of all key-values retrieved from Azure App Configuration.
     *
     * @remarks
     * This is useful when you want to remove a common prefix from all keys to avoid repetition.
     * The provided prefixes will be sorted in descending order and the longest matching prefix will be trimmed first.
     */
    trimKeyPrefixes?: string[];

    /**
     * Specifies custom options to be used when creating the AppConfigurationClient.
     */
    clientOptions?: AppConfigurationClientOptions;

    /**
     * Specifies options used to resolve Vey Vault references.
     */
    keyVaultOptions?: KeyVaultOptions;

    /**
     * Specifies options for dynamic refresh key-values.
     */
    refreshOptions?: RefreshOptions;

    /**
     * Specifies options used to configure feature flags.
     */
    featureFlagOptions?: FeatureFlagOptions;
}
