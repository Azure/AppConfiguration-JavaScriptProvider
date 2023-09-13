// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// User Agent
export const Version = "0.1.0-preview";
export const UserAgentPrefix = `javascript-appconfiguration-provider/${Version}`;

// Correlation Context
export const CorrelationContextHeaderName = "Correlation-Context";

// Env
export const NodeJSEnvironmentVariable = "NODE_ENV";
export const EnvironmentKey = "Env";
export const DevEnvironmentValue = "Dev";

// Host Type
export const HostTypeKey = "Host";
export enum HostType {
    AzureFunction = "AzureFunction",
    AzureWebApp = "AzureWebApp",
    ContainerApp = "ContainerApp",
    Kubernetes = "Kubernetes",
    ServiceFabric = "ServiceFabric"
}

// Environment vairables to identify Host type.
export const AzureFunctionEnvironmentVariable = "FUNCTIONS_EXTENSION_VERSION";
export const AzureWebAppEnvironmentVariable = "WEBSITE_SITE_NAME";
export const ContainerAppEnvironmentVariable = "CONTAINER_APP_NAME";
export const KubernetesEnvironmentVariable = "KUBERNETES_PORT";
export const AspNetCoreEnvironmentVariable = "ASPNETCORE_ENVIRONMENT";
export const DotNetCoreEnvironmentVariable = "DOTNET_ENVIRONMENT";
export const ServiceFabricEnvironmentVariable = "Fabric_NodeName"; // See: https://docs.microsoft.com/en-us/azure/service-fabric/service-fabric-environment-variables-reference

// Request Type
export const RequestTypeKey = "RequestType";
export enum RequestType {
    Startup = "Startup",
    Watch = "Watch"
}

// Tag names
export const KeyVaultConfiguredTag = "UsesKeyVault";
