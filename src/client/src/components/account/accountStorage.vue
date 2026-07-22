<!----------------------------------------------------------------------------------------------------------------------
  -- Account Storage
  --
  -- The account-page storage summary. Reuses the sidebar quota gauge -- same used-of-limit read from the session
  -- profile -- inside a card so the two never drift.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <QuotaMeter />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Components
    import QuotaMeter from '../quotaMeter.vue';
</script>

<!--------------------------------------------------------------------------------------------------------------------->
