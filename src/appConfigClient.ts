// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
    AppConfigurationClient,
    CheckConfigurationSettingsOptions,
    ConfigurationSettingId,
    FeatureFlagClient,
    GetConfigurationSettingOptions,
    GetSnapshotOptions,
    ListConfigurationSettingsForSnapshotOptions,
    ListConfigurationSettingsOptions,
    ListFeatureFlagsOptions
} from "@azure/app-configuration";
import { RequestTracingOptions, applyRequestTracing } from "./requestTracing/utils.js";

/**
 * A single client abstraction for an Azure App Configuration endpoint that exposes the subset of
 * operations the provider needs from both the @see AppConfigurationClient and the @see FeatureFlagClient.
 */
export interface IAppConfigurationClient {
    /**
     * The endpoint of the Azure App Configuration store this client communicates with.
     */
    readonly endpoint: string;

    listConfigurationSettings(
        listOptions: ListConfigurationSettingsOptions,
        tracingOptions: RequestTracingOptions
    ): ReturnType<AppConfigurationClient["listConfigurationSettings"]>;

    checkConfigurationSettings(
        checkOptions: CheckConfigurationSettingsOptions,
        tracingOptions: RequestTracingOptions
    ): ReturnType<AppConfigurationClient["checkConfigurationSettings"]>;

    getConfigurationSetting(
        configurationSettingId: ConfigurationSettingId,
        getOptions: GetConfigurationSettingOptions | undefined,
        tracingOptions: RequestTracingOptions
    ): ReturnType<AppConfigurationClient["getConfigurationSetting"]>;

    getSnapshot(
        snapshotName: string,
        getOptions: GetSnapshotOptions | undefined,
        tracingOptions: RequestTracingOptions
    ): ReturnType<AppConfigurationClient["getSnapshot"]>;

    listConfigurationSettingsForSnapshot(
        snapshotName: string,
        listOptions: ListConfigurationSettingsForSnapshotOptions | undefined,
        tracingOptions: RequestTracingOptions
    ): ReturnType<AppConfigurationClient["listConfigurationSettingsForSnapshot"]>;

    listFeatureFlags(
        listOptions: ListFeatureFlagsOptions,
        tracingOptions: RequestTracingOptions
    ): ReturnType<FeatureFlagClient["listFeatureFlags"]>;
}

/**
 * The default @see IAppConfigurationClient implementation, backed by the @see AppConfigurationClient
 * and @see FeatureFlagClient SDK clients. Request tracing is applied per call before delegating to the
 * corresponding SDK client.
 */
export class AppConfigClient implements IAppConfigurationClient {
    readonly endpoint: string;
    #configurationClient: AppConfigurationClient;
    #featureFlagClient: FeatureFlagClient;

    constructor(endpoint: string, configurationClient: AppConfigurationClient, featureFlagClient: FeatureFlagClient) {
        this.endpoint = endpoint;
        this.#configurationClient = configurationClient;
        this.#featureFlagClient = featureFlagClient;
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
