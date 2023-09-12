// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { AzureAppConfiguration } from "./AzureAppConfiguration";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions";
import { KeyFilter } from "./KeyFilter";
import { LabelFilter } from "./LabelFilter";
import { SecretClient, parseKeyVaultSecretIdentifier } from "@azure/keyvault-secrets";

export class AzureAppConfigurationImpl extends Map<string, unknown> implements AzureAppConfiguration {
    /**
     * Map vault hostname to corresponding secret client.
     */
    private secretClients: Map<string, SecretClient>;
    /**
     * Trim key prefixes sorted in descending order.
     * Since multiple prefixes could start with the same characters, we need to trim the longest prefix first.
     */
    private sortedTrimKeyPrefixes: string[] | undefined;

    constructor(
        private client: AppConfigurationClient,
        private options: AzureAppConfigurationOptions | undefined
    ) {
        super();
        if (options?.trimKeyPrefixes) {
            this.sortedTrimKeyPrefixes = [...options.trimKeyPrefixes].sort((a, b) => b.localeCompare(a));
        }
    }

    public async load() {
        const keyValues: [key: string, value: unknown][] = [];
        const selectors = this.options?.selectors ?? [{ keyFilter: KeyFilter.Any, labelFilter: LabelFilter.Null }];
        for (const selector of selectors) {
            const settings = this.client.listConfigurationSettings({
                keyFilter: selector.keyFilter,
                labelFilter: selector.labelFilter
            });

            for await (const setting of settings) {
                if (setting.key && setting.value) {
                    const trimmedKey = this.keyWithPrefixesTrimmed(setting.key);
                    const value = await this.processKeyValue(setting);
                    keyValues.push([trimmedKey, value]);
                }
            }
        }
        for (const [k, v] of keyValues) {
            this.set(k, v);
        }
    }

    private async processKeyValue(setting: ConfigurationSetting<string>) {
        // TODO: should process different type of values
        // feature flag, json, others
        if (isSecretReference(setting)) {
            return this.resolveKeyVaultReference(setting);
        }
        return setting.value;
    }

    private async resolveKeyVaultReference(setting: ConfigurationSetting<string>) {
        // TODO: cache results to save requests.
        if (!this.options?.keyVaultOptions) {
            throw new Error("Configure keyVaultOptions to resolve Key Vault Reference(s).");
        }

        // precedence: secret clients > credential > secret resolver
        const { name: secretName, vaultUrl, sourceId } = parseKeyVaultSecretIdentifier(
            parseSecretReference(setting).value.secretId
        );

        const client = this.getSecretClient(new URL(vaultUrl));
        if (client) {
            // TODO: what if error occurs when reading a key vault value? Now it breaks the whole load.
            const secret = await client.getSecret(secretName);
            return secret.value;
        }

        if (this.options.keyVaultOptions.secretResolver) {
            return await this.options.keyVaultOptions.secretResolver(new URL(sourceId))
        }

        throw new Error("No key vault credential or secret resolver callback configured, and no matching secret client could be found.");
    }

    private getSecretClient(vaultUrl: URL): SecretClient | undefined {
        if (this.secretClients === undefined) {
            this.secretClients = new Map();
            for (const c of this.options?.keyVaultOptions?.secretClients ?? []) {
                this.secretClients.set(getHost(c.vaultUrl), c);
            }
        }

        let client: SecretClient | undefined;
        client = this.secretClients.get(vaultUrl.host);
        if (client !== undefined) {
            return client;
        }

        if (this.options?.keyVaultOptions?.credential) {
            client = new SecretClient(vaultUrl.toString(), this.options.keyVaultOptions.credential);
            this.secretClients.set(vaultUrl.host, client);
            return client;
        }

        return undefined;
    }

    private keyWithPrefixesTrimmed(key: string): string {
        if (this.sortedTrimKeyPrefixes) {
            for (const prefix of this.sortedTrimKeyPrefixes) {
                if (key.startsWith(prefix)) {
                    return key.slice(prefix.length);
                }
            }
        }
        return key;
    }
}

function getHost(url: string) {
    return new URL(url).host;
}