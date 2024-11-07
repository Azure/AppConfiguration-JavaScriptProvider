// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, AppConfigurationClientOptions } from "@azure/app-configuration";
import { ConfigurationClientWrapper } from "./ConfigurationClientWrapper.js";
import { TokenCredential } from "@azure/identity";
import { AzureAppConfigurationOptions, MaxRetries, MaxRetryDelayInMs } from "./AzureAppConfigurationOptions.js";
import { isBrowser, isWebWorker } from "./requestTracing/utils.js";
import * as RequestTracing from "./requestTracing/constants.js";

const TCP_ORIGIN_KEY_NAME = "_origin._tcp";
const ALT_KEY_NAME = "_alt";
const TCP_KEY_NAME = "_tcp";
const ENDPOINT_KEY_NAME = "Endpoint";
const ID_KEY_NAME = "Id";
const SECRET_KEY_NAME = "Secret";
const TRUSTED_DOMAIN_LABELS = [".azconfig.", ".appconfig."];
const FALLBACK_CLIENT_REFRESH_EXPIRE_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const MINIMAL_CLIENT_REFRESH_INTERVAL = 30 * 1000; // 30 seconds in milliseconds
const SRV_QUERY_TIMEOUT = 30 * 1000; // 30 seconds in milliseconds

export class ConfigurationClientManager {
    isFailoverable: boolean;
    dns: any;
    endpoint: string;
    #secret : string;
    #id : string;
    #credential: TokenCredential;
    #clientOptions: AppConfigurationClientOptions | undefined;
    #appConfigOptions: AzureAppConfigurationOptions | undefined;
    #validDomain: string;
    #staticClients: ConfigurationClientWrapper[];
    #dynamicClients: ConfigurationClientWrapper[];
    #lastFallbackClientRefreshTime: number = 0;
    #lastFallbackClientRefreshAttempt: number = 0;

    constructor (
        connectionStringOrEndpoint?: string | URL,
        credentialOrOptions?: TokenCredential | AzureAppConfigurationOptions,
        appConfigOptions?: AzureAppConfigurationOptions
    ) {
        let staticClient: AppConfigurationClient;

        if (typeof connectionStringOrEndpoint === "string" && !instanceOfTokenCredential(credentialOrOptions)) {
            const connectionString = connectionStringOrEndpoint;
            this.#appConfigOptions = credentialOrOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(this.#appConfigOptions);
            staticClient = new AppConfigurationClient(connectionString, this.#clientOptions);
            const ConnectionStringRegex = /Endpoint=(.*);Id=(.*);Secret=(.*)/;
            const regexMatch = connectionString.match(ConnectionStringRegex);
            if (regexMatch) {
                this.endpoint = regexMatch[1];
                this.#id = regexMatch[2];
                this.#secret = regexMatch[3];
            } else {
                throw new Error(`Invalid connection string. Valid connection strings should match the regex '${ConnectionStringRegex.source}'.`);
            }
        } else if ((connectionStringOrEndpoint instanceof URL || typeof connectionStringOrEndpoint === "string") && instanceOfTokenCredential(credentialOrOptions)) {
            let endpoint = connectionStringOrEndpoint;
            // ensure string is a valid URL.
            if (typeof endpoint === "string") {
                try {
                    endpoint = new URL(endpoint);
                } catch (error) {
                    if (error.code === "ERR_INVALID_URL") {
                        throw new Error("Invalid endpoint URL.", { cause: error });
                    } else {
                        throw error;
                    }
                }
            }

            const credential = credentialOrOptions as TokenCredential;
            this.#appConfigOptions = appConfigOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(this.#appConfigOptions);
            staticClient = new AppConfigurationClient(connectionStringOrEndpoint.toString(), credential, this.#clientOptions);
            this.endpoint = endpoint.toString();
            this.#credential = credential;
        } else {
            throw new Error("A connection string or an endpoint with credential must be specified to create a client.");
        }

        this.#staticClients = [new ConfigurationClientWrapper(this.endpoint, staticClient)];
        this.#validDomain = getValidDomain(this.endpoint);
    }

    async init() {
        if (this.#appConfigOptions?.replicaDiscoveryEnabled === false || isBrowser() || isWebWorker()) {
            this.isFailoverable = false;
            return;
        }

        try {
            this.dns = await import("dns/promises");
        }catch (error) {
            this.isFailoverable = false;
            console.warn("Failed to load the dns module:", error.message);
            return;
        }

        this.isFailoverable = true;
    }

    async getClients() : Promise<ConfigurationClientWrapper[]> {
        if (!this.isFailoverable) {
            return this.#staticClients;
        }

        const currentTime = Date.now();
        if (this.#isFallbackClientDiscoveryDue(currentTime)) {
            this.#lastFallbackClientRefreshAttempt = currentTime;
            const host = new URL(this.endpoint).hostname;
            await this.#discoverFallbackClients(host);
        }

        // Filter static clients whose backoff time has ended
        let availableClients = this.#staticClients.filter(client => client.backoffEndTime <= currentTime);
        // If there are dynamic clients, filter and concatenate them
        if (this.#dynamicClients && this.#dynamicClients.length > 0) {
            availableClients = availableClients.concat(
                this.#dynamicClients
                    .filter(client => client.backoffEndTime <= currentTime));
        }

        return availableClients;
    }

    async refreshClients() {
        const currentTime = Date.now();
        if (this.isFailoverable &&
            currentTime > new Date(this.#lastFallbackClientRefreshAttempt + MINIMAL_CLIENT_REFRESH_INTERVAL).getTime()) {
            this.#lastFallbackClientRefreshAttempt = currentTime;
            const host = new URL(this.endpoint).hostname;
            await this.#discoverFallbackClients(host);
        }
    }

    async #discoverFallbackClients(host) {
        let result;
        try {
            result = await Promise.race([
                new Promise((_, reject) => setTimeout(() => reject(new Error("SRV record query timed out.")), SRV_QUERY_TIMEOUT)),
                this.#querySrvTargetHost(host)
            ]);
        } catch (error) {
            throw new Error(`Fail to build fallback clients, ${error.message}`);
        }

        const srvTargetHosts = result as string[];
        // Shuffle the list of SRV target hosts
        for (let i = srvTargetHosts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [srvTargetHosts[i], srvTargetHosts[j]] = [srvTargetHosts[j], srvTargetHosts[i]];
        }

        const newDynamicClients: ConfigurationClientWrapper[] = [];
        for (const host of srvTargetHosts) {
            if (isValidEndpoint(host, this.#validDomain)) {
                const targetEndpoint = `https://${host}`;
                if (targetEndpoint.toLowerCase() === this.endpoint.toLowerCase()) {
                    continue;
                }
                const client = this.#credential ? new AppConfigurationClient(targetEndpoint, this.#credential, this.#clientOptions) : new AppConfigurationClient(buildConnectionString(targetEndpoint, this.#secret, this.#id), this.#clientOptions);
                newDynamicClients.push(new ConfigurationClientWrapper(targetEndpoint, client));
            }
        }

        this.#dynamicClients = newDynamicClients;
        this.#lastFallbackClientRefreshTime = Date.now();
    }

    #isFallbackClientDiscoveryDue(dateTime) {
        return dateTime >= this.#lastFallbackClientRefreshAttempt + MINIMAL_CLIENT_REFRESH_INTERVAL
            && (!this.#dynamicClients
                || this.#dynamicClients.every(client => dateTime < client.backoffEndTime)
                || dateTime >= this.#lastFallbackClientRefreshTime + FALLBACK_CLIENT_REFRESH_EXPIRE_INTERVAL);
    }

    /**
 * Query SRV records and return target hosts.
 */
    async #querySrvTargetHost(host: string): Promise<string[]> {
        const results: string[] = [];

        try {
            // Look up SRV records for the origin host
            const originRecords = await this.dns.resolveSrv(`${TCP_ORIGIN_KEY_NAME}.${host}`);
            if (originRecords.length === 0) {
                return results;
            }

            // Add the first origin record to results
            const originHost = originRecords[0].name;
            results.push(originHost);

            // Look up SRV records for alternate hosts
            let index = 0;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const currentAlt = `${ALT_KEY_NAME}${index}`;
                const altRecords = await this.dns.resolveSrv(`${currentAlt}.${TCP_KEY_NAME}.${originHost}`);
                if (altRecords.length === 0) {
                    break; // No more alternate records, exit loop
                }

                altRecords.forEach(record => {
                    const altHost = record.name;
                    if (altHost) {
                        results.push(altHost);
                    }
                });
                index++;
            }
        } catch (err) {
            if (err.code === "ENOTFOUND") {
                return results; // No more SRV records found, return results
            } else {
                throw new Error(`Failed to lookup SRV records: ${err.message}`);
            }
        }

        return results;
    }
}

/**
 * Builds a connection string from the given endpoint, secret, and id.
 * Returns an empty string if either secret or id is empty.
 */
function buildConnectionString(endpoint, secret, id: string): string {
    if (!secret || !id) {
        return "";
    }

    return `${ENDPOINT_KEY_NAME}=${endpoint};${ID_KEY_NAME}=${id};${SECRET_KEY_NAME}=${secret}`;
}

/**
 * Extracts a valid domain from the given endpoint URL based on trusted domain labels.
 */
export function getValidDomain(endpoint: string): string {
    try {
        const url = new URL(endpoint);
        const host = url.hostname.toLowerCase();

        for (const label of TRUSTED_DOMAIN_LABELS) {
            const index = host.lastIndexOf(label);
            if (index !== -1) {
                return host.substring(index);
            }
        }
    } catch (error) {
        console.error("Error parsing URL:", error.message);
    }

    return "";
}

/**
 * Checks if the given host ends with the valid domain.
 */
export function isValidEndpoint(host: string, validDomain: string): boolean {
    if (!validDomain) {
        return false;
    }

    return host.toLowerCase().endsWith(validDomain.toLowerCase());
}

export function getClientOptions(options?: AzureAppConfigurationOptions): AppConfigurationClientOptions | undefined {
    // user-agent
    let userAgentPrefix = RequestTracing.USER_AGENT_PREFIX; // Default UA for JavaScript Provider
    const userAgentOptions = options?.clientOptions?.userAgentOptions;
    if (userAgentOptions?.userAgentPrefix) {
        userAgentPrefix = `${userAgentOptions.userAgentPrefix} ${userAgentPrefix}`; // Prepend if UA prefix specified by user
    }

    // retry options
    const defaultRetryOptions = {
        maxRetries: MaxRetries,
        maxRetryDelayInMs: MaxRetryDelayInMs,
    };
    const retryOptions = Object.assign({}, defaultRetryOptions, options?.clientOptions?.retryOptions);

    return Object.assign({}, options?.clientOptions, {
        retryOptions,
        userAgentOptions: {
            userAgentPrefix
        }
    });
}

export function instanceOfTokenCredential(obj: unknown) {
    return obj && typeof obj === "object" && "getToken" in obj && typeof obj.getToken === "function";
}

