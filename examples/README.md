# Examples for Azure App Configuration JavaScript Provider

These examples show how to use the JavaScript Provider for Azure App Configuration in some common scenarios.

## Prerequisites

The examples are compatible with [LTS versions of Node.js](https://github.com/nodejs/release#release-schedule).

You need [an Azure subscription](https://azure.microsoft.com/free/) and the following Azure resources to run the examples:

- [Azure App Configuration store](https://learn.microsoft.com/en-us/azure/azure-app-configuration/quickstart-azure-app-configuration-create?tabs=azure-portal)

The examples retrieve credentials to access your App Configuration store from environment variables.
Alternatively, edit the source code to include the appropriate credentials.
See each individual example for details on which environment variables/credentials it requires to function.

## Add a key-value
Add the following key-value to the App Configuration store and leave **Label** and **Content Type** with their default values. For more information about how to add key-values to a store using the Azure portal or the CLI, go to [Create a key-value](./quickstart-azure-app-configuration-create.md#create-a-key-value).

| Key                    | Value          |
|------------------------|----------------|
| *app.settings.message* | *Hello World!* |

## Setup & Run

To run the examples using the published version of the package:

1. Install the dependencies using `npm`:

    ```bash
    npm install
    ```

2. There are two ways to run the examples using correct credentials:

    - Edit the file `.env.template`, adding the access keys to your App Configuration store. and rename the file from `.env.template` to just `.env`. The examples will read this file automatically.

    - Alternatively, you can set the environment variables to the access keys to your App Configuration store. In this case, setting up the `.env` file is not required. 
        ```bash
        npx cross-env APPCONFIG_CONNECTION_STRING="<appconfig connection string>" 
        ```

3. Run the examples:
    ```bash
    node helloworld.mjs
    ```
    You should see the following output:
    ```Output
    Message from Azure App Configuration: Hello World!
    ```
