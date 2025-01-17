// components/NavBar.vue
<template>
  <nav>
    <nuxt-link to="/">Home</nuxt-link> |
    <nuxt-link to="/about">About</nuxt-link>
  </nav>
</template>

<script>
export default {
  name: "NavBar"
}
</script>

<style scoped>
nav {
  font-size: 18px;
}

nuxt-link {
  text-decoration: none;
  color: #fff;
  margin-right: 10px;
}

nuxt-link:hover {
  text-decoration: underline;
}
</style>
