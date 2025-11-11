// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export const DEFAULT_STARTUP_TIMEOUT_IN_MS = 100_000;

export interface StartupOptions {
    /**
     * The amount of time allowed to load data from Azure App Configuration on startup.
     *
     * @remarks
     * If not specified, the default value is 100 seconds.
     */
    timeoutInMs?: number;
}
