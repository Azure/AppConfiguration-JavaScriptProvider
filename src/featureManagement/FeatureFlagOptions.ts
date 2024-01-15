// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { SettingSelector } from "../types";

/**
 * Options used to configure feature flags.
 */
export interface FeatureFlagOptions {
    /**
     * Specifies whether feature flag support is enabled.
     */
    enabled: boolean;

    /**
     * Specifies the selectors used to filter feature flags.
     *
     * @remarks
     * keyFilter of selector will be prefixed with "appconfig.featureflag/" when request is sent.
     * If no selectors are specified then no feature flags will be retrieved.
     */
    selectors?: SettingSelector[];

    /**
     * Specifies whether feature flag refresh is enabled.
     */
    refreshEnabled?: boolean;

    /**
     * Specifies the interval in milliseconds to refresh feature flags. Defaults to 10 seconds.
     */
    refreshIntervalInMs?: number;
}