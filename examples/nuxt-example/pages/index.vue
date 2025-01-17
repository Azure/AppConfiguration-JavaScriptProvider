<template>
  <div>
    <h1>{{ config.app.settings.message }}</h1>
    <nuxt-link to="/about">Go to About</nuxt-link>
  </div>
</template>

<script>
export default {
  async asyncData({ $axios }) {
    const { load } = require("@azure/app-configuration-provider");
    const connectionString = "your_connection_string";
    const settings = await load(connectionString, {
        selectors: [{
            keyFilter: "app.settings.message"
        }],
    });
    const config = settings.constructConfigurationObject();

    return { config };
  }
}
</script>

<style scoped>
h1 {
  color: #42b983;
}
</style>
