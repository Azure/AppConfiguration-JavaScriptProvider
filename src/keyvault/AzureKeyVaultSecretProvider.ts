// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { KeyVaultOptions } from "./KeyVaultOptions.js";
import { RefreshTimer } from "../refresh/RefreshTimer.js";
import { getUrlHost } from "../common/utils.js";
import { ArgumentError } from "../error.js";
import { SecretClient,  KeyVaultSecretIdentifier } from "@azure/keyvault-secrets";

export class AzureKeyVaultSecretProvider {
    #keyVaultOptions: KeyVaultOptions | undefined;
    #secretClients: Map<string, SecretClient>; // map key vault hostname to corresponding secret client

    constructor(keyVaultOptions: KeyVaultOptions | undefined, refreshTimer?: RefreshTimer) {
        if (keyVaultOptions?.secretRefreshIntervalInMs !== undefined) {
            if (refreshTimer === undefined) {
                throw new ArgumentError("Refresh timer must be specified when Key Vault secret refresh is enabled.");
            }
            if (refreshTimer.interval !== keyVaultOptions.secretRefreshIntervalInMs) {
                throw new ArgumentError("Refresh timer does not match the secret refresh interval.");
            }
        }
        this.#keyVaultOptions = keyVaultOptions;
        this.#secretClients = new Map();
        for (const client of this.#keyVaultOptions?.secretClients ?? []) {
            this.#secretClients.set(getUrlHost(client.vaultUrl), client);
        }
    }

    async getSecretValue(secretIdentifier: KeyVaultSecretIdentifier): Promise<unknown> {
        if (!this.#keyVaultOptions) {
            throw new ArgumentError("Failed to get secret value. The keyVaultOptions is not configured.");
        }
        const { name: secretName, vaultUrl, sourceId, version } = secretIdentifier;
        // precedence: secret clients > custom secret resolver
        const client = this.#getSecretClient(new URL(vaultUrl));
        if (client) {
            const secret = await client.getSecret(secretName, { version });
            return secret.value;
        }
        if (this.#keyVaultOptions.secretResolver) {
            return await this.#keyVaultOptions.secretResolver(new URL(sourceId));
        }
        // When code reaches here, it means that the key vault reference cannot be resolved in all possible ways.
        throw new ArgumentError("Failed to get secret value. No key vault secret client, credential or secret resolver callback is available to resolve the secret.");
    }

    #getSecretClient(vaultUrl: URL): SecretClient | undefined {
        let client = this.#secretClients.get(vaultUrl.host);
        if (client !== undefined) {
            return client;
        }
        if (this.#keyVaultOptions?.credential) {
            client = new SecretClient(vaultUrl.toString(), this.#keyVaultOptions.credential);
            this.#secretClients.set(vaultUrl.host, client);
            return client;
        }

        return undefined;
    }
}
