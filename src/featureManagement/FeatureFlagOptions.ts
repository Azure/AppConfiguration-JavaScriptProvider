// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { FeatureFlagRefreshOptions } from "../RefreshOptions";
import { SettingSelector } from "../types";

/**
 * Options used to configure feature flags.
 */
export interface FeatureFlagOptions {
    /**
     * Specifies whether feature flags will be loaded from Azure App Configuration.

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
     * Specifies how feature flag refresh is configured. All selected feature flags will be watched for changes.
     */
    refresh?: FeatureFlagRefreshOptions;
}