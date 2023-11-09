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
     * Specifies the interval for refresh to really update the values.
     * Default value is 30 seconds. Must be greater than 1 second.
     * Any refresh operation triggered will not update the value for a key until after the interval.
     */
    refreshIntervalInMs?: number;

    /**
     * Specifies settings to be watched.
     * Only if any of the settings is updated, the refresh will acutally update loaded configuration settings.
     */
    watchedSettings?: WatchedSetting[];
}