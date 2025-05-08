// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { WatchedSetting } from "../WatchedSetting.js";

export const DEFAULT_REFRESH_INTERVAL_IN_MS = 30_000;
export const MIN_REFRESH_INTERVAL_IN_MS = 1_000;

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
     * Any modifications to watched settings will refresh all settings loaded by the configuration provider when refresh() is called.
     *
     * @remarks
     * If no watched setting is specified, all configuration settings will be watched.
     */
    watchedSettings?: WatchedSetting[];
}

export interface FeatureFlagRefreshOptions {
    /**
     * Specifies whether the provider should automatically refresh all feature flags if any feature flag changes.
     */
    enabled: boolean;

    /**
     * Specifies the minimum time that must elapse before checking the server for any new changes.
     * Default value is 30 seconds. Must be greater than 1 second.
     * Any refresh operation triggered will not update the value for a key until after the interval.
     */
    refreshIntervalInMs?: number;
}
