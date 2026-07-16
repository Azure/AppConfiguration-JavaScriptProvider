// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../keyValueAdapter.js";
import { AzureKeyVaultSecretProvider } from "./keyVaultSecretProvider.js";
import { KeyVaultOptions } from "./keyVaultOptions.js";
import { RefreshTimer } from "../refresh/refreshTimer.js";
import { ArgumentError, KeyVaultReferenceError } from "../common/errors.js";
import { KeyVaultReferenceErrorMessages, buildKeyVaultReferenceErrorMessage } from "../common/errorMessages.js";
import { KeyVaultSecretIdentifier, parseKeyVaultSecretIdentifier } from "@azure/keyvault-secrets";

export class AzureKeyVaultKeyValueAdapter implements IKeyValueAdapter {
    #keyVaultOptions: KeyVaultOptions | undefined;
    #keyVaultSecretProvider: AzureKeyVaultSecretProvider;

    constructor(keyVaultOptions?: KeyVaultOptions, refreshTimer?: RefreshTimer) {
        this.#keyVaultOptions = keyVaultOptions;
        this.#keyVaultSecretProvider = new AzureKeyVaultSecretProvider(keyVaultOptions, refreshTimer);
    }

    canProcess(setting: ConfigurationSetting): boolean {
        return isSecretReference(setting);
    }

    async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
        if (!this.#keyVaultOptions) {
            throw new ArgumentError(KeyVaultReferenceErrorMessages.KEY_VAULT_OPTIONS_UNDEFINED);
        }
        let secretIdentifier: KeyVaultSecretIdentifier;
        try {
            secretIdentifier = parseKeyVaultSecretIdentifier(
                parseSecretReference(setting).value.secretId
            );
        } catch (error) {
            throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Invalid Key Vault reference.", undefined, setting), { cause: error });
        }

        const secretValue = await this.#keyVaultSecretProvider.getSecretValue(secretIdentifier);
        return [setting.key, secretValue];
    }

    async preload(settings: ConfigurationSetting[]): Promise<void> {
        if (!this.#keyVaultOptions) {
            return; // no-op when keyVaultOptions is not configured
        }
        // Deduplicate references by secret identifier (sourceId).
        const uniqueSecrets = new Map<string, KeyVaultSecretIdentifier>();
        for (const setting of settings) {
            if (!this.canProcess(setting)) {
                continue;
            }
            let secretIdentifier: KeyVaultSecretIdentifier;
            try {
                secretIdentifier = parseKeyVaultSecretIdentifier(
                    parseSecretReference(setting).value.secretId
                );
            } catch (error) {
                throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Invalid Key Vault reference.", undefined, setting), { cause: error });
            }
            if (!uniqueSecrets.has(secretIdentifier.sourceId)) {
                uniqueSecrets.set(secretIdentifier.sourceId, secretIdentifier);
            }
        }

        // Resolve failures surface as KeyVaultReferenceError from the provider, identified by secret identifier.
        const uniqueSecretIdentifiers = [...uniqueSecrets.values()];
        if (this.#keyVaultOptions.parallelSecretResolutionEnabled) {
            await Promise.all(uniqueSecretIdentifiers.map(secretIdentifier => this.#keyVaultSecretProvider.loadSecretValue(secretIdentifier)));
        } else {
            for (const secretIdentifier of uniqueSecretIdentifiers) {
                await this.#keyVaultSecretProvider.loadSecretValue(secretIdentifier);
            }
        }
    }

    async onChangeDetected(): Promise<void> {
        this.#keyVaultSecretProvider.clearCache();
        return;
    }
}
