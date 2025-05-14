// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TokenCredential } from "@azure/identity";
import { SecretClient, SecretClientOptions } from "@azure/keyvault-secrets";

export const MIN_SECRET_REFRESH_INTERVAL_IN_MS = 60_000;

/**
 * Options used to resolve Key Vault references.
 */
export interface KeyVaultOptions {
    /**
     * Specifies the Key Vault secret client used for resolving Key Vault references.
     */
    secretClients?: SecretClient[];

    /**
     * Specifies the credentials used to authenticate to key vaults that have no applied SecretClient.
     */
    credential?: TokenCredential;

    /**
     * * Configures the client options used when connecting to key vaults that have no registered SecretClient.
     *
     * @remarks
     * The client options will not affect the registered SecretClient instances.
     */
    clientOptions?: SecretClientOptions;

    /**
     * Specifies the callback used to resolve key vault references that have no applied SecretClient.
     * @param keyVaultReference The Key Vault reference to resolve.
     * @returns The secret value.
     */
    secretResolver?: (keyVaultReference: URL) => string | Promise<string>;

    /**
     * Specifies whether to resolve the secret value in parallel.
     *
     * @remarks
     * If not specified, the default value is false.
     */
    parallelSecretResolutionEnabled?: boolean;

    /**
     * Specifies the refresh interval in milliseconds for periodically reloading secret from Key Vault.
     *
     * @remarks
     * If specified, the value must be greater than 60 seconds.
     */
    secretRefreshIntervalInMs?: number;
}
