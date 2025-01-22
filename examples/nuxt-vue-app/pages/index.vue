<script setup lang="ts">
const { data } = await useFetch('/hello')
</script>

<template>
  <pre>{{ data }}</pre>
</template>

