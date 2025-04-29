// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Disposable } from "./common/disposable.js";

/**
 * Azure App Configuration provider.
 */
export type AzureAppConfiguration = {
    /**
     * API to trigger refresh operation.
     */
    refresh(): Promise<void>;

    /**
     * API to register callback listeners, which will be called only when a refresh operation successfully updates key-values or feature flags.
     *
     * @param listener - Callback function to be registered.
     * @param thisArg - Optional. Value to use as `this` when executing callback.
     */
    onRefresh(listener: () => any, thisArg?: any): Disposable;
} & IGettable & ReadonlyMap<string, any> & IConfigurationObject;

interface IConfigurationObject {
    /**
     * Construct configuration object based on Map-styled data structure and hierarchical keys.
     * @param options - The options to control the conversion behavior.
     */
    constructConfigurationObject(options?: ConfigurationObjectConstructionOptions): Record<string, any>;
}

export interface ConfigurationObjectConstructionOptions {
    /**
     * The separator to use when converting hierarchical keys to object properties.
     * Supported values: '.', ',', ';', '-', '_', '__', '/', ':'.
     * If separator is undefined, '.' will be used by default.
     */
    separator?: "." | "," | ";" | "-" | "_" | "__" | "/" | ":";
}

interface IGettable {
    /**
     * Get the value of a key-value from the Map-styled data structure.
     * @param key - The key of the key-value to be retrieved.
     */
    get<T>(key: string): T | undefined;
}
