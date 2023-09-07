// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";

export interface AzureAppConfigurationOptions {
    selectors?: { keyFilter: string, labelFilter: string }[];
    trimKeyPrefixes?: string[];
    clientOptions?: AppConfigurationClientOptions;
}