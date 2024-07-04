// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { ConfigurationSetting } from "@azure/app-configuration";

export interface IKeyValueAdapter {
    /**
     * Determine whether the adapter applies to a configuration setting.
     */
    canProcess(setting: ConfigurationSetting): boolean;

    /**
     * This method process the original configuration setting in place.
     */
    processKeyValue(setting: ConfigurationSetting): Promise<void>;
}