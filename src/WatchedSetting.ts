// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Fields that uniquely identify a watched configuration setting.
 */
export interface WatchedSetting {
    /**
     * The key for this setting.
     */
    key: string;

    /**
     * The label for this setting.
     * Leaving this undefined means this setting does not have a label.
     */
    label?: string;
}
