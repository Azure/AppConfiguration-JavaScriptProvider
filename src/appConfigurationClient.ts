// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
    AppConfigurationClient as ConfigurationClient,
    AppConfigurationClientOptions as ConfigurationClientOptions,
    CheckConfigurationSettingsOptions,
    ConfigurationSettingId,
    FeatureFlagClient,
    FeatureFlagClientOptions,
    GetConfigurationSettingOptions,
    GetSnapshotOptions,
    KnownAppConfigurationApiVersion,
    ListConfigurationSettingsForSnapshotOptions,
    ListConfigurationSettingsOptions,
    ListFeatureFlagsOptions
} from "@azure/app-configuration";
import { TokenCredential } from "@azure/identity";
import { instanceOfTokenCredential } from "./common/utils.js";
import { ArgumentError } from "./common/errors.js";
import { ErrorMessages } from "./common/errorMessages.js";
import { RequestTracingOptions, applyRequestTracing } from "./requestTracing/utils.js";

/**
 * A client for the operations the provider needs from both the @see ConfigurationClient and
 * @see FeatureFlagClient SDK clients. Request tracing is applied before delegating each operation.
 */
export class AppConfigurationClient {
    #configurationClient: ConfigurationClient;
    #featureFlagClient: FeatureFlagClient;

    constructor(connectionString: string, options?: ConfigurationClientOptions);
    constructor(endpoint: string, credential: TokenCredential, options?: ConfigurationClientOptions);
    constructor(
        connectionStringOrEndpoint: string,
        credentialOrOptions?: TokenCredential | ConfigurationClientOptions,
        options?: ConfigurationClientOptions
    ) {
        const credentialPassed = instanceOfTokenCredential(credentialOrOptions);
        const configurationClientOptions = credentialPassed
            ? options
            : credentialOrOptions as ConfigurationClientOptions | undefined;
        const featureFlagClientOptions = getFeatureFlagClientOptions(configurationClientOptions);

        if (credentialPassed) {
            const credential = credentialOrOptions as TokenCredential;
            this.#configurationClient = new ConfigurationClient(connectionStringOrEndpoint, credential, configurationClientOptions);
            this.#featureFlagClient = new FeatureFlagClient(connectionStringOrEndpoint, credential, featureFlagClientOptions);
        } else {
            this.#configurationClient = new ConfigurationClient(connectionStringOrEndpoint, configurationClientOptions);
            this.#featureFlagClient = new FeatureFlagClient(connectionStringOrEndpoint, featureFlagClientOptions);
        }
    }

    listConfigurationSettings(listOptions: ListConfigurationSettingsOptions, tracingOptions: RequestTracingOptions) {
        return this.#configurationClient.listConfigurationSettings(applyRequestTracing(tracingOptions, listOptions));
    }

    checkConfigurationSettings(checkOptions: CheckConfigurationSettingsOptions, tracingOptions: RequestTracingOptions) {
        return this.#configurationClient.checkConfigurationSettings(applyRequestTracing(tracingOptions, checkOptions));
    }

    getConfigurationSetting(configurationSettingId: ConfigurationSettingId, getOptions: GetConfigurationSettingOptions | undefined, tracingOptions: RequestTracingOptions) {
        return this.#configurationClient.getConfigurationSetting(configurationSettingId, applyRequestTracing(tracingOptions, getOptions));
    }

    getSnapshot(snapshotName: string, getOptions: GetSnapshotOptions | undefined, tracingOptions: RequestTracingOptions) {
        return this.#configurationClient.getSnapshot(snapshotName, applyRequestTracing(tracingOptions, getOptions));
    }

    listConfigurationSettingsForSnapshot(snapshotName: string, listOptions: ListConfigurationSettingsForSnapshotOptions | undefined, tracingOptions: RequestTracingOptions) {
        return this.#configurationClient.listConfigurationSettingsForSnapshot(snapshotName, applyRequestTracing(tracingOptions, listOptions));
    }

    listFeatureFlags(listOptions: ListFeatureFlagsOptions, tracingOptions: RequestTracingOptions) {
        return this.#featureFlagClient.listFeatureFlags(applyRequestTracing(tracingOptions, listOptions));
    }
}

export function getFeatureFlagClientOptions(options?: ConfigurationClientOptions): FeatureFlagClientOptions | undefined {
    if (options === undefined) {
        return undefined;
    }
    if (options.apiVersion !== undefined &&
        options.apiVersion !== KnownAppConfigurationApiVersion.V20260501Preview) {
        throw new ArgumentError(ErrorMessages.API_VERSION_NOT_SUPPORTED);
    }

    return {
        ...options,
        ...(options.retryOptions && { retryOptions: { ...options.retryOptions } }),
        ...(options.proxyOptions && { proxyOptions: { ...options.proxyOptions } }),
        ...(options.tlsOptions && { tlsOptions: { ...options.tlsOptions } }),
        ...(options.userAgentOptions && { userAgentOptions: { ...options.userAgentOptions } }),
        ...(options.telemetryOptions && { telemetryOptions: { ...options.telemetryOptions } }),
        ...(options.additionalPolicies && { additionalPolicies: [...options.additionalPolicies] })
    };
}
