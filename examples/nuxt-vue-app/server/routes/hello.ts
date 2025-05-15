import { load } from "@azure/app-configuration-provider";
const connectionString = "your-connection-string";


export default defineEventHandler(async () => {
    const settings = await load(connectionString, {
        selectors: [{
            keyFilter: "app.settings.*",
        }],
        trimKeyPrefixes: ["app.settings."]
    });
    const message = settings.get("message");
    return {
      hello: message,
    }
  })