// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";
import { AzureAppConfigurationKeyVaultOptions } from "./keyvault/AzureAppConfigurationKeyVaultOptions";

export const MaxRetries = 2;
export const MaxRetryDelayInMs = 60000;

export interface AzureAppConfigurationOptions {
    /**
     * Specify what key-values to include in the configuration provider.  include multiple sets of key-values
     *
     * @property keyFilter:
     * The key filter to apply when querying Azure App Configuration for key-values.
     * An asterisk `*` can be added to the end to return all key-values whose key begins with the key filter.
     * e.g. key filter `abc*` returns all key-values whose key starts with `abc`.
     * A comma `,` can be used to select multiple key-values. Comma separated filters must exactly match a key to select it.
     * Using asterisk to select key-values that begin with a key filter while simultaneously using comma separated key filters is not supported.
     * E.g. the key filter `abc*,def` is not supported. The key filters `abc*` and `abc,def` are supported.
     * For all other cases the characters: asterisk `*`, comma `,`, and backslash `\` are reserved. Reserved characters must be escaped using a backslash (\).
     * e.g. the key filter `a\\b\,\*c*` returns all key-values whose key starts with `a\b,*c`.
     *
     * @property labelFilter:
     * The label filter to apply when querying Azure App Configuration for key-values.
     * By default, the "null label" will be used, matching key-values without a label.
     * The characters asterisk `*` and comma `,` are not supported.
     * Backslash `\` character is reserved and must be escaped using another backslash `\`.
     */
    selectors?: { keyFilter: string, labelFilter?: string }[];
    trimKeyPrefixes?: string[];
    clientOptions?: AppConfigurationClientOptions;
    keyVaultOptions?: AzureAppConfigurationKeyVaultOptions;
}