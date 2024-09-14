// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient } from "@azure/app-configuration";

export class ConfigurationClientWrapper {
    endpoint: string;
    client: AppConfigurationClient;
    backoffEndTime: number;
    failedAttempts: number = 0;

    constructor(endpoint: string, client: AppConfigurationClient) {
        this.endpoint = endpoint;
        this.client = client;
    }
}