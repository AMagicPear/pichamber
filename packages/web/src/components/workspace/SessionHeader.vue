<template>
  <header class="session-header">
    <div>
      <h1>New session</h1>
      <p>amagicpear</p>
    </div>
    <nav class="session-header__tools" aria-label="Session tools">
      <button type="button">◫</button>
      <button type="button">▱</button>
      <button type="button">〉_</button>
      <button type="button">◎</button>
      <button type="button">◧</button>
      <button type="button">◉</button>
    </nav>
  </header>
</template>

<style scoped>
.session-header {
  display: flex;
  flex: 0 0 72px;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px 0 28px;
  border-bottom: 1px solid #e8e6df;
}
.session-header h1,
.session-header p {
  margin: 0;
}
.session-header h1 {
  font-size: 20px;
  font-weight: 600;
}
.session-header p {
  color: #888;
  font-size: 14px;
}
.session-header__tools {
  display: flex;
  align-items: center;
  gap: 20px;
  font-size: 23px;
}
</style>
