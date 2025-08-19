// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";
import { KeyVaultOptions } from "./keyvault/keyVaultOptions.js";
import { RefreshOptions } from "./refresh/refreshOptions.js";
import { SettingSelector } from "./types.js";
import { FeatureFlagOptions } from "./featureManagement/FeatureFlagOptions.js";
import { StartupOptions } from "./startupOptions.js";

export interface AzureAppConfigurationOptions {
    /**
     * Specifies what key-values to include in the configuration provider.
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

    /**
     * Specifies options used to configure provider startup.
     */
    startupOptions?: StartupOptions;

    /**
     * Specifies whether to enable replica discovery or not.
     *
     * @remarks
     * If not specified, the default value is true.
     */
    replicaDiscoveryEnabled?: boolean;

    /**
     * Specifies whether to enable load balance or not.
     *
     * @remarks
     * If not specified, the default value is false.
     */
    loadBalancingEnabled?: boolean;
}
