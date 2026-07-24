<template>
  <aside class="context-panel">
    <nav class="context-panel__tabs">
      <button type="button" class="is-active">⌘ git</button>
      <button type="button">□ files</button>
      <button type="button">▤ context</button>
    </nav>
    <div class="context-panel__empty">
      <strong>⌘</strong>
      <p>This directory is not a Git repository</p>
      <span>Initialize Git in this directory or open a repository.</span>
    </div>
  </aside>
</template>

<style scoped>
.context-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.context-panel__tabs {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 16px;
  border-bottom: 1px solid #eeeae1;
  color: #666;
  font-size: 17px;
}
.context-panel__tabs button {
  flex: 1;
  padding: 12px 8px;
  border-radius: 12px;
}
.context-panel__tabs .is-active {
  border: 1px solid #dedbd2;
  color: #222;
}
.context-panel__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  text-align: center;
}
.context-panel__empty strong {
  margin-bottom: 22px;
  color: #777;
  font-size: 36px;
}
.context-panel__empty p {
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 600;
}
.context-panel__empty span {
  color: #777;
  font-size: 15px;
}
</style>
