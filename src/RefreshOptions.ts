// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { WatchedSetting } from "./WatchedSetting";

export const DefaultRefreshIntervalInMs = 30 * 1000;
export const MinimumRefreshIntervalInMs = 1 * 1000;

export interface RefreshOptions {
    /**
     * Specifies whether the provider should automatically refresh when the configuration is changed.
     */
    enabled: boolean;

    /**
     * Specifies the minimum time that must elapse before checking the server for any new changes.
     * Default value is 30 seconds. Must be greater than 1 second.
     * Any refresh operation triggered will not update the value for a key until after the interval.
     */
    refreshIntervalInMs?: number;

    /**
     * One or more configuration settings to be watched for changes on the server. 
     * Any modifications to watched settings will refresh all settings loaded by the configuration provider.
     */
    watchedSettings?: WatchedSetting[];
}