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
} & IGettable & IHierarchicalData;

interface IHierarchicalData {
    /**
     * Convert the Map-styled data structure to hierarchical object properties.
     * @param options - The options to control the conversion behavior.
     */
    toHierarchicalData(options?: HierarchicalDataConversionOptions): Record<string, any>;
}

export interface HierarchicalDataConversionOptions {
    /**
     * The separator to use when converting hierarchical keys to object properties.
     * Default is '.'.
     */
    separator?: string;

    /**
     * The prefix of hierarchical keys to be converted object properties, usefull when converting a subset of the keys.
     * Default is '', representing the root of the object.
     */
    prefix?: string;

    /**
     * The behavior when error or amibiguity occurs on converting hierarchical keys.
     * Default is 'error'.
     */
    onError?: "error" | "ignore";
}

interface IGettable {
    /**
     * Get the value of a key-value from the Map-styled data structure.
     * @param key - The key of the key-value to be retrieved.
     */
    get<T>(key: string): T | undefined;
}
