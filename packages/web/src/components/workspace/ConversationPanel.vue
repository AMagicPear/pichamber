<template>
  <main class="conversation">
    <h2>What are we working<br />on in amagicpear?</h2>
    <div class="composer">
      <p>Use @ / ! # for helpers</p>
      <div class="composer__footer">
        <span>＋</span>
        <span>⌗</span>
        <span>◉</span>
        <span>◌</span>
        <strong>Ƶ Big Pickle</strong>
        <span>♙</span>
        <span>♩</span>
        <span>▷</span>
      </div>
    </div>
  </main>
</template>

<style scoped>
.conversation {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  padding: 0 42px;
  overflow: auto;
}
.conversation h2 {
  margin: 0 0 100px;
  font-size: 42px;
  line-height: 1.15;
  text-align: center;
}
.composer {
  width: min(100%, 720px);
  padding: 22px;
  border: 1px solid #dedbd2;
  border-radius: 18px;
}
.composer p {
  margin: 0 0 40px;
  color: #747474;
  font-size: 17px;
}
.composer__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  font-size: 20px;
}
.composer__footer strong {
  margin-left: auto;
  font-size: 17px;
}
</style>
