<template>
  <!-- Container -->
  <div id="bottom-section">

    <div class="section-opener-container">
      <button class="section-opener-button clickable" @click="wavesPropsClicked"><span>Menu</span><span
        class="fa">&#xf106;</span></button>
    </div>

  </div>
</template>


<script>

</script>

<style scoped>
#bottom-section {
  position: relative;
  width: 100%;
  background: blue;
  height: 100%;
}

.section-opener-container {
  display: flex;
  justify-content: center;
  margin: -60px;
}

.section-opener-button{

}
</style>