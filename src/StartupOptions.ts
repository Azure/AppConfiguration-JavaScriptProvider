// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export interface StartupOptions {
    /**
     * Specifies whether to enable retry on startup or not.
     *
     * @remarks
     * If not specified, the default value is false.
     */
    retryEnabled?: boolean;

    /**
     * The amount of time allowed to load data from Azure App Configuration on startup.
     *
     * @remarks
     * If not specified, the default value is 100 seconds.
     */
    timeoutInMs?: number;
}
