// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient } from "./appConfigurationClient.js";
import { getExponentialBackoffDuration } from "./common/backoffUtils.js";

export class AppConfigurationClientWrapper {
    endpoint: string;
    client: AppConfigurationClient;
    backoffEndTime: number = 0; // Timestamp
    #failedAttempts: number = 0;

    constructor(endpoint: string, client: AppConfigurationClient) {
        this.endpoint = endpoint;
        this.client = client;
    }

    updateBackoffStatus(successfull: boolean) {
        if (successfull) {
            this.#failedAttempts = 0;
            this.backoffEndTime = Date.now();
        } else {
            this.#failedAttempts += 1;
            this.backoffEndTime = Date.now() + getExponentialBackoffDuration(this.#failedAttempts);
        }
    }
}
