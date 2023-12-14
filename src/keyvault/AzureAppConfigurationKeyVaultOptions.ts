// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TokenCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

/**
 * Options used to resolve Key Vault references.
 */
export interface AzureAppConfigurationKeyVaultOptions {
    /**
     * Specifies the Key Vault secret client used for resolving Key Vault references.
     */
    secretClients?: SecretClient[];

    /**
     * Specifies the credentials used to authenticate to key vaults that have no applied SecretClient.
     */
    credential?: TokenCredential;

    /**
     * Specifies the callback used to resolve key vault references that have no applied SecretClient.
     * @param keyVaultReference The Key Vault reference to resolve.
     * @returns The secret value.
     */
    secretResolver?: (keyVaultReference: URL) => string | Promise<string>;
}