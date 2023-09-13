// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClientOptions } from "@azure/app-configuration";

export const MaxRetries = 2;
export const MaxRetryDelayInMs = 60000;

export interface AzureAppConfigurationOptions {
    selectors?: { keyFilter: string, labelFilter: string }[];
    trimKeyPrefixes?: string[];
    clientOptions?: AppConfigurationClientOptions;
}