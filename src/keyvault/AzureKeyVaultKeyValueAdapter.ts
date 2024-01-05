// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../IKeyValueAdapter";
import { KeyVaultOptions } from "./KeyVaultOptions";
import { SecretClient, parseKeyVaultSecretIdentifier } from "@azure/keyvault-secrets";

export class AzureKeyVaultKeyValueAdapter implements IKeyValueAdapter {
    /**
     * Map vault hostname to corresponding secret client.
    */
    private secretClients: Map<string, SecretClient>;

    constructor(
        private keyVaultOptions: KeyVaultOptions | undefined
    ) { }

    public canProcess(setting: ConfigurationSetting): boolean {
        return isSecretReference(setting);
    }

    public async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
        // TODO: cache results to save requests.
        if (!this.keyVaultOptions) {
            throw new Error("Configure keyVaultOptions to resolve Key Vault Reference(s).");
        }

        // precedence: secret clients > credential > secret resolver
        const { name: secretName, vaultUrl, sourceId, version } = parseKeyVaultSecretIdentifier(
            parseSecretReference(setting).value.secretId
        );

        const client = this.getSecretClient(new URL(vaultUrl));
        if (client) {
            // TODO: what if error occurs when reading a key vault value? Now it breaks the whole load.
            const secret = await client.getSecret(secretName, { version });
            return [setting.key, secret.value];
        }

        if (this.keyVaultOptions.secretResolver) {
            return [setting.key, await this.keyVaultOptions.secretResolver(new URL(sourceId))];
        }

        throw new Error("No key vault credential or secret resolver callback configured, and no matching secret client could be found.");
    }

    private getSecretClient(vaultUrl: URL): SecretClient | undefined {
        if (this.secretClients === undefined) {
            this.secretClients = new Map();
            for (const c of this.keyVaultOptions?.secretClients ?? []) {
                this.secretClients.set(getHost(c.vaultUrl), c);
            }
        }

        let client: SecretClient | undefined;
        client = this.secretClients.get(vaultUrl.host);
        if (client !== undefined) {
            return client;
        }

        if (this.keyVaultOptions?.credential) {
            client = new SecretClient(vaultUrl.toString(), this.keyVaultOptions.credential);
            this.secretClients.set(vaultUrl.host, client);
            return client;
        }

        return undefined;
    }
}

function getHost(url: string) {
    return new URL(url).host;
}