// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { ConfigurationSetting } from "@azure/app-configuration";

export interface IKeyValueAdapter {
    /**
     * Determine whether the adapter applies to a configuration setting.
     * Note: A setting is expected to be processed by at most one adapter.
     */
    canProcess(setting: ConfigurationSetting): boolean;

    /**
     * This method process the original configuration setting, and returns processed key and value in an array.
     */
    processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]>;
}
