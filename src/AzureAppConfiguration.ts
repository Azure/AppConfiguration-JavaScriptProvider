// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Disposable } from "./common/disposable";

export type AzureAppConfiguration = {
    /**
     * API to trigger refresh operation.
     */
    refresh(): Promise<void>;

    /**
     * API to register callback listeners, which will be called only when a refresh operation successfully updates key-values.
     *
     * @param listener - Callback funtion to be registered.
     * @param thisArg - Optional. Value to use as `this` when executing callback.
     */
    onRefresh(listener: () => any, thisArg?: any): Disposable;
} & IGettable & AppConfigurationData;

interface AppConfigurationData {
    data: { [key: string]: any };
}

interface IGettable {
    get<T>(key: string): T | undefined;
}
