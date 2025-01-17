// layouts/default.vue
<template>
  <div>
    <header>
      <NavBar />
    </header>
    <main>
      <nuxt />
    </main>
  </div>
</template>

<script>
import NavBar from '@/components/NavBar.vue';

export default {
  components: {
    NavBar
  }
}
</script>

<style scoped>
header {
  background-color: #42b983;
  padding: 1rem;
}

main {
  padding: 2rem;
}
</style>
