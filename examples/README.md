# Examples for Azure App Configuration JavaScript Provider

These examples show how to use the JavaScript Provider for Azure App Configuration in some common scenarios.

## Prerequisites

The sample programs are compatible with [LTS versions of Node.js](https://github.com/nodejs/release#release-schedule).

You need [an Azure subscription][freesub] and the following Azure resources to run these sample programs:

- [Azure App Configuration account][createinstance_azureappconfigurationaccount]

Samples retrieve credentials to access the service endpoint from environment variables. Alternatively, edit the source code to include the appropriate credentials. See each individual sample for details on which environment variables/credentials it requires to function.

## Setup

To run the samples using the published version of the package:

1. Install the dependencies using `npm`:

```bash
npm install
```

2. Edit the file `.env.template`, adding the correct credentials to access the Azure service and run the samples. Then rename the file from `.env.template` to just `.env`. The sample programs will read this file automatically.

3. Run whichever samples you like (note that some samples may require additional setup, see the table above):

```bash
node helloorld.mjs
```

Alternatively, run a single sample with the correct environment variables set (setting up the `.env` file is not required if you do this), for example (cross-platform):

```bash
npx cross-env APPCONFIG_CONNECTION_STRING="<appconfig connection string>" node helloworld.mjs
```

[freesub]: https://azure.microsoft.com/free/
[createinstance_azureappconfigurationaccount]: https://docs.microsoft.com/azure/azure-app-configuration/quickstart-aspnet-core-app?tabs=core5x#create-an-app-configuration-store