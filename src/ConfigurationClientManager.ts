// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, AppConfigurationClientOptions } from "@azure/app-configuration";
import { ConfigurationClientWrapper } from "./ConfigurationClientWrapper"
import { TokenCredential } from "@azure/identity";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions";
import { getClientOptions } from "./load";

const TCP_ORIGIN = "_origin._tcp";
const ALT = "_alt";
const EndpointSection = "Endpoint";
const IdSection = "Id";
const SecretSection = "Secret";
const AzConfigDomainLabel = ".azconfig."
const AppConfigDomainLabel = ".appconfig."
const FallbackClientRefreshExpireInterval = 60 * 60 * 1000; // 1 hour in milliseconds
const MinimalClientRefreshInterval = 30 * 1000; // 30 seconds in milliseconds
const MaxBackoffDuration = 10 * 60 * 1000; // 10 minutes in milliseconds
const MinBackoffDuration = 30 * 1000; // 30 seconds in milliseconds
const dns = require('dns').promises;

interface IConfigurationClientManager {
    getClients(): ConfigurationClientWrapper[];
    refreshClients(): Promise<void>;
}

export class ConfigurationClientManager {
    #isFailoverable: boolean;
    #endpoint: string;
    #secret : string;
    #id : string;
    #credential: TokenCredential;
    #clientOptions: AppConfigurationClientOptions | undefined;
    #validDomain: string;
    #staticClients: ConfigurationClientWrapper[];
    #dynamicClients: ConfigurationClientWrapper[];
    #lastFallbackClientRefreshTime: number;
    #lastFallbackClientRefreshAttempt: number;


    constructor (
        connectionStringOrEndpoint?: string | URL,
        credentialOrOptions?: TokenCredential | AzureAppConfigurationOptions,
        appConfigOptions?: AzureAppConfigurationOptions
    ) {
        let staticClient: AppConfigurationClient;
        let options: AzureAppConfigurationOptions;

        if (typeof connectionStringOrEndpoint === "string") {
            const connectionString = connectionStringOrEndpoint;
            options = credentialOrOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(options);
            staticClient = new AppConfigurationClient(connectionString, this.#clientOptions);
            this.#secret = parseConnectionString(connectionString, SecretSection);
            this.#id = parseConnectionString(connectionString, IdSection);
            // TODO: need to check if it's CDN or not
            this.#endpoint = parseConnectionString(connectionString, EndpointSection);
            
        } else if (connectionStringOrEndpoint instanceof URL) {
            const credential = credentialOrOptions as TokenCredential;
            options = appConfigOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(options);
            staticClient = new AppConfigurationClient(connectionStringOrEndpoint.toString(), credential, this.#clientOptions);
            this.#endpoint = connectionStringOrEndpoint.toString();
            this.#credential = credential;
        } else {
            throw new Error("Invalid endpoint URL.");
        }

        this.#staticClients = [new ConfigurationClientWrapper(this.#endpoint, staticClient)];
        this.#validDomain = getValidDomain(this.#endpoint);
        
    }

    async getClients() {
        if (!this.#isFailoverable) {
            return this.#staticClients;
        }

        const currentTime = Date.now();
        if (this.#isFallbackClientDiscoveryDue(currentTime)) {
            this.#lastFallbackClientRefreshAttempt = currentTime;
            await this.#discoverFallbackClients(this.#endpoint);
        }

        // Filter static clients where BackoffEndTime is less than or equal to now
        let availableClients = this.#staticClients.filter(client => client.backoffEndTime <= currentTime);
        // If there are dynamic clients, filter and concatenate them
        if (this.#dynamicClients && this.#dynamicClients.length > 0) {
            availableClients = availableClients.concat(
                this.#dynamicClients
                    .filter(client => client.backoffEndTime <= currentTime));
        }

        return availableClients
    }

    async refreshClients() {
        const currentTime = Date.now();
        if (this.#isFailoverable &&
            currentTime > new Date(this.#lastFallbackClientRefreshAttempt + MinimalClientRefreshInterval).getTime()) {
            this.#lastFallbackClientRefreshAttempt = currentTime;
            const url = new URL(this.#endpoint);
            await this.#discoverFallbackClients(url.hostname);
        }
    }

    async #discoverFallbackClients(host) {
        const timeout = setTimeout(() => {
        }, 10000); // 10 seconds
        const srvResults = querySrvTargetHost(host);

        try {
            const result = await Promise.race([srvResults, timeout]);

            if (result === timeout) {
                throw new Error("SRV record query timed out.");
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
                    if (targetEndpoint.toLowerCase() === this.#endpoint.toLowerCase()) {
                        continue;
                    }
                    const client = this.#newConfigurationClient(targetEndpoint);
                    newDynamicClients.push(new ConfigurationClientWrapper(targetEndpoint, client));
                }
            }

            this.#dynamicClients = newDynamicClients;
            this.#lastFallbackClientRefreshTime = Date.now();
        } catch (err) {
            console.warn(`Fail to build fallback clients, ${err.message}`);
        }
    }

    #newConfigurationClient(endpoint) {
        if (this.#credential) {
            return new AppConfigurationClient(endpoint, this.#credential, this.#clientOptions);
        }

        const connectionStr = buildConnectionString(endpoint, this.#secret, this.#id);
        return new AppConfigurationClient(connectionStr, this.#clientOptions);
    }

    #isFallbackClientDiscoveryDue(dateTime) {
        return dateTime >= this.#lastFallbackClientRefreshAttempt + MinimalClientRefreshInterval
            && (!this.#dynamicClients 
                || this.#dynamicClients.every(client => dateTime < client.backoffEndTime)
                || dateTime >= this.#lastFallbackClientRefreshTime + FallbackClientRefreshExpireInterval);
    }
}

/**
 * Query SRV records and return target hosts.
 * @param {string} host - The host to query.
 * @returns {Promise<string[]>} - A promise that resolves to an array of target hosts.
 */
async function querySrvTargetHost(host) {
    const results: string[] = [];

    try {
        // Look up SRV records for the origin host
        const originRecords = await dns.resolveSrv(`${TCP_ORIGIN}.${host}`);
        if (originRecords.length === 0) {
            return results;
        }

        // Add the first origin record to results
        const originHost = originRecords[0].name
        results.push(originHost);
        
        // Look up SRV records for alternate hosts
        let index = 0;
        while (true) {
            const currentAlt = `${ALT}${index}`;
            try {
                const altRecords = await dns.resolveSrv(`_${currentAlt}._tcp.${originHost}`);
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
            } catch (err) {
                if (err.code === 'ENOTFOUND') {
                    break; // No more alternate records, exit loop
                } else {
                    throw new Error(`Failed to lookup alternate SRV records: ${err.message}`);
                }
            }
        }
    } catch (err) {
        throw new Error(`Failed to lookup origin SRV records: ${err.message}`);
    }

    return results;
}

/**
 * Parses the connection string to extract the value associated with a specific token.
 * 
 * @param {string} connectionString - The connection string containing tokens.
 * @param {string} token - The token whose value needs to be extracted.
 * @returns {string} The value associated with the token, or an empty string if not found.
 * @throws {Error} If the connection string is empty or the token is not found.
 */
function parseConnectionString(connectionString, token) {
    if (!connectionString) {
        throw new Error("connectionString is empty");
    }

    // Token format is "token="
    const searchToken = `${token}=`;
    const startIndex = connectionString.indexOf(searchToken);
    if (startIndex === -1) {
        throw new Error(`Token ${token} not found in connectionString`);
    }

    // Move startIndex to the beginning of the token value
    const valueStartIndex = startIndex + searchToken.length;
    const endIndex = connectionString.indexOf(';', valueStartIndex);
    const valueEndIndex = endIndex === -1 ? connectionString.length : endIndex;

    // Extract and return the token value
    return connectionString.substring(valueStartIndex, valueEndIndex);
}

/**
 * Builds a connection string from the given endpoint, secret, and id.
 * Returns an empty string if either secret or id is empty.
 * 
 * @param {string} endpoint - The endpoint to include in the connection string.
 * @param {string} secret - The secret to include in the connection string.
 * @param {string} id - The ID to include in the connection string.
 * @returns {string} - The formatted connection string or an empty string if invalid input.
 */
function buildConnectionString(endpoint, secret, id) {
    if (!secret || !id) {
        return '';
    }

    return `${EndpointSection}=${endpoint};${IdSection}=${id};${SecretSection}=${secret}`;
}

/**
 * Extracts a valid domain from the given endpoint URL based on trusted domain labels.
 *
 * @param {string} endpoint - The endpoint URL.
 * @returns {string} - The valid domain or an empty string if no valid domain is found.
 */
function getValidDomain(endpoint) {
    try {
        const url = new URL(endpoint);
        const trustedDomainLabels = [AzConfigDomainLabel, AppConfigDomainLabel];
        const host = url.hostname.toLowerCase();
        
        for (const label of trustedDomainLabels) {
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
 * 
 * @param {string} host - The host to be validated.
 * @param {string} validDomain - The valid domain to check against.
 * @returns {boolean} - True if the host ends with the valid domain, false otherwise.
 */
function isValidEndpoint(host, validDomain) {
    if (!validDomain) {
        return false;
    }

    return host.toLowerCase().endsWith(validDomain.toLowerCase());
}



