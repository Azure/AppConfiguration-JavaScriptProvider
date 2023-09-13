// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TokenCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

export interface AzureAppConfigurationKeyVaultOptions {
    secretClients?: SecretClient[];
    credential?: TokenCredential;
    secretResolver?: (keyVaultReference: URL) => string | Promise<string>;
}